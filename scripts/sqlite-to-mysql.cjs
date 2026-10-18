#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
// One-time copy of an existing FriendConnect SQLite database into MySQL.
//
//   1. Create the MySQL tables first:   npx prisma migrate deploy
//   2. Copy the data:                   node scripts/sqlite-to-mysql.cjs /path/to/custom.db
//
// DATABASE_URL (from .env or the environment) is the TARGET. The SQLite file is opened
// read-only and never changed. The copy runs in ONE transaction: on any error nothing is
// written. Refuses to run when the target already has users (use --force to override).
'use strict'
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
try { require(path.join(ROOT, 'scripts', 'load-env.cjs')) } catch { /* optional */ }

const args = process.argv.slice(2)
const force = args.includes('--force')
const src = args.find((a) => !a.startsWith('--')) || path.join(ROOT, 'db', 'custom.db')

if (!fs.existsSync(src)) {
  console.error(`SQLite file not found: ${src}`)
  console.error('Old builds kept data in .next/standalone/db/custom.db — pass that path if so.')
  process.exit(1)
}
const target = process.env.DATABASE_URL || ''
const isMysql = /^(mysql|mariadb):\/\//i.test(target)
if (!isMysql && process.env.DB_ENGINE !== 'prisma') {
  console.error('DATABASE_URL must be the MySQL target (mysql://user:pass@127.0.0.1:3306/db).')
  process.exit(1)
}
if (!isMysql && path.resolve(target.replace(/^file:/, '')) === path.resolve(src)) {
  console.error('Source and target are the same file.')
  process.exit(1)
}

const Database = require('better-sqlite3')
const { prisma } = require(path.join(ROOT, 'src', 'lib', 'db-runtime.js'))

// Read the models straight from prisma/schema.prisma (the runtime DMMF in Prisma 6 is
// stripped and has no relation / default information). The schema uses no @map.
const SCALARS = new Set(['String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json', 'Bytes'])
function parseSchema(file) {
  const text = fs.readFileSync(file, 'utf8')
  const out = []
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm
  let mm
  while ((mm = re.exec(text))) {
    const model = { name: mm[1], fields: [], deps: new Set() }
    for (const raw of mm[2].split('\n')) {
      const line = raw.replace(/\/\/.*$/, '').trim()
      const fm = /^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/.exec(line)
      if (!fm || line.startsWith('@@')) continue
      const [, name, type, list, opt, rest] = fm
      if (SCALARS.has(type) && !list) {
        model.fields.push({ name, type, isRequired: !opt, hasDefaultValue: /@default\(|@updatedAt/.test(rest) })
      } else if (/@relation\([^)]*fields:\s*\[/.test(rest) && type !== model.name) {
        model.deps.add(type)
      }
    }
    out.push(model)
  }
  return out
}
const models = parseSchema(path.join(ROOT, 'prisma', 'schema.prisma'))
const delegate = (name) => name.charAt(0).toLowerCase() + name.slice(1)

// Parents before children (self-relations such as Message.replyTo are ignored; FK checks
// are also disabled/deferred during the copy, so order is only a safety net).
function orderModels() {
  const byName = new Map(models.map((m) => [m.name, m]))
  const out = []
  const seen = new Set()
  const visit = (n, stack = new Set()) => {
    if (seen.has(n) || stack.has(n) || !byName.has(n)) return
    stack.add(n)
    for (const d of byName.get(n).deps) visit(d, stack)
    stack.delete(n)
    seen.add(n)
    out.push(byName.get(n))
  }
  for (const m of models) visit(m.name)
  return out
}

function convert(field, v) {
  if (v === null || v === undefined) return null
  switch (field.type) {
    case 'Boolean':
      return v === true || v === 1 || v === '1' || v === 'true' || v === 1n
    case 'Int':
      return Number(v)
    case 'DateTime': {
      const d = typeof v === 'number' || typeof v === 'bigint' || /^\d+$/.test(String(v))
        ? new Date(Number(v))
        : new Date(String(v).includes('T') || String(v).endsWith('Z') ? v : String(v).replace(' ', 'T') + 'Z')
      if (Number.isNaN(d.getTime())) throw new Error(`bad date "${v}" in ${field.name}`)
      return d
    }
    default:
      return String(v)
  }
}

async function main() {
  const sqlite = new Database(src, { readonly: true, fileMustExist: true })
  const tables = new Set(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name))

  const existingUsers = await prisma.user.count()
  if (existingUsers > 0 && !force) {
    console.error(`Target already has ${existingUsers} user(s). Refusing to copy (use --force to merge; duplicates are skipped on MySQL).`)
    process.exit(1)
  }

  const plan = []
  for (const m of orderModels()) {
    const table = m.name
    if (!tables.has(table)) { console.log(`- ${table}: not in SQLite file, skipped`); continue }
    const cols = new Set(sqlite.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name))
    const fields = m.fields.filter((f) => cols.has(f.name))
    const missing = m.fields.filter((f) => !cols.has(f.name)).map((f) => f.name)
    const hasCreatedAt = cols.has('createdAt')
    const rows = sqlite.prepare(`SELECT * FROM "${table}"${hasCreatedAt ? ' ORDER BY "createdAt"' : ''}`).all()
    plan.push({ m, table, fields, rows, missing })
  }

  console.log(`Copying from ${src} → ${isMysql ? target.replace(/:[^:@/]*@/, ':****@') : target}`)
  const BATCH = 500
  await prisma.$transaction(async (tx) => {
    if (isMysql) await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=0')
    else await tx.$executeRawUnsafe('PRAGMA defer_foreign_keys = ON')
    for (const { m, table, fields, rows, missing } of plan) {
      const data = rows.map((r) => {
        const o = {}
        for (const f of fields) {
          const v = convert(f, r[f.name])
          if (v === null && f.isRequired && f.hasDefaultValue) continue // let the default apply
          o[f.name] = v
        }
        return o
      })
      for (let i = 0; i < data.length; i += BATCH) {
        const chunk = data.slice(i, i + BATCH)
        await tx[delegate(m.name)].createMany(isMysql ? { data: chunk, skipDuplicates: true } : { data: chunk })
      }
      console.log(`✓ ${table}: ${rows.length} row(s)${missing.length ? `  (defaults used for: ${missing.join(', ')})` : ''}`)
    }
    if (isMysql) await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=1')
  }, { timeout: 30 * 60 * 1000, maxWait: 60 * 1000 })

  let bad = 0
  for (const { m, table, rows } of plan) {
    const n = await prisma[delegate(m.name)].count()
    if (n < rows.length) { bad++; console.error(`✗ ${table}: expected ≥ ${rows.length}, found ${n}`) }
  }
  sqlite.close()
  await prisma.$disconnect()
  if (bad) process.exit(1)
  console.log('Done. Remember to copy the uploaded files too (see docs/DEPLOY_LEARN_ALOEDUCATION.md).')
}

main().catch(async (e) => {
  console.error('Copy failed — nothing was written:', e && e.message ? e.message : e)
  try { await prisma.$disconnect() } catch { /* ignore */ }
  process.exit(1)
})
