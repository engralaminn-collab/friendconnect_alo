#!/usr/bin/env node
/**
 * Generate the SQLite DDL used by the fallback runtime.
 *
 * `src/lib/db-runtime.js` creates its local schema with `CREATE TABLE IF NOT
 * EXISTS`, which never adds a column to a table that already exists. The
 * hand-written DDL had drifted from `prisma/schema.prisma`, so a freshly created
 * database was missing columns that the API writes on every request, and the
 * code relied on a pile of best-effort `ALTER TABLE` patches at startup to
 * paper over it.
 *
 * This generator derives the DDL from the canonical schema instead. The output
 * (`src/lib/sqlite-ddl.cjs`) is committed so the standalone build does not need
 * `prisma/` at runtime; CI fails if it is stale.
 *
 * Conventions
 *  - String/DateTime/Json -> TEXT, Int/BigInt/Float/Decimal -> INTEGER/REAL,
 *    Boolean -> INTEGER (0/1), Bytes -> BLOB
 *  - `@id`/`@unique` -> PRIMARY KEY / UNIQUE, `@@unique([a,b])` -> UNIQUE(a,b)
 *  - `@default(now())` / `@updatedAt` are applied by the runtime, not the DDL
 *  - relations become FOREIGN KEY ... ON DELETE <action> where Prisma declares one
 *
 *   node scripts/generate-sqlite-ddl.mjs           # write
 *   node scripts/generate-sqlite-ddl.mjs --check   # verify only
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CANONICAL = join(ROOT, 'prisma/schema.prisma')
const OUTPUT = join(ROOT, 'src/lib/sqlite-ddl.cjs')

const SCALARS = new Set([
  'String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean',
  'DateTime', 'Json', 'Bytes', 'Unsupported',
])

const SQL_TYPE = {
  String: 'TEXT',
  DateTime: 'TEXT',
  Json: 'TEXT',
  Bytes: 'BLOB',
  Int: 'INTEGER',
  BigInt: 'INTEGER',
  Float: 'REAL',
  Decimal: 'REAL',
  Boolean: 'INTEGER',
}

function parseSchema(source) {
  const models = {}
  const order = []
  const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm
  let match

  while ((match = modelRe.exec(source))) {
    const [, name, body] = match
    const fields = {}
    const uniques = []
    let table = name

    for (const rawLine of body.split('\n')) {
      const line = rawLine.replace(/\/\/.*$/, '').trim()
      if (!line) continue

      const mapMatch = line.match(/^@@map\(\s*"([^"]+)"\s*\)/)
      if (mapMatch) {
        table = mapMatch[1]
        continue
      }
      const uniqueMatch = line.match(/^@@(?:unique|id)\(\[([^\]]+)\]/)
      if (uniqueMatch) {
        uniques.push(uniqueMatch[1].split(',').map((f) => f.trim().split('(')[0].trim()))
        continue
      }
      if (line.startsWith('@@')) continue

      const fieldMatch = line.match(/^(\w+)\s+([\w.]+)(\[\])?(\?)?\s*(.*)$/)
      if (!fieldMatch) continue
      const [, fieldName, rawType, isList, isOptional, attrs] = fieldMatch
      fields[fieldName] = {
        name: fieldName,
        type: rawType.split('.')[0],
        isList: Boolean(isList),
        optional: Boolean(isOptional),
        attrs: attrs.replace(/\s+/g, ' ').trim(),
      }
    }

    models[name] = { name, table, fields, uniques }
    order.push(name)
  }
  return { models, order }
}

/** SQL literal for a Prisma `@default(...)`, or null when the runtime handles it. */
function sqlDefault(field) {
  const start = field.attrs.indexOf('@default(')
  if (start < 0) return null
  let depth = 0
  let end = -1
  for (let i = start + '@default('.length - 1; i < field.attrs.length; i += 1) {
    if (field.attrs[i] === '(') depth += 1
    else if (field.attrs[i] === ')') {
      depth -= 1
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end < 0) return null
  const raw = field.attrs.slice(start + '@default('.length, end).trim()
  if (/@updatedAt/.test(field.attrs)) return null
  if (/^(cuid|uuid|ulid)\(\)$/.test(raw)) return null
  if (raw === 'now()') return null
  if (raw === 'true') return '1'
  if (raw === 'false') return '0'
  if (/^-?\d+(\.\d+)?$/.test(raw)) return raw
  if (/^"[^"]*"$/.test(raw)) {
    const value = raw.slice(1, -1)
    if (/^[A-Za-z0-9 _.\-/]*$/.test(value)) return `'${value}'`
    return null
  }
  return null
}

function buildDdl(models, order) {
  const statements = []

  for (const name of order) {
    const model = models[name]
    const columns = []
    const constraints = []

    for (const field of Object.values(model.fields)) {
      if (!SCALARS.has(field.type)) continue
      const parts = [field.name, SQL_TYPE[field.type] ?? 'TEXT']

      const isId = /@id\b/.test(field.attrs)
      const isUnique = /@unique\b/.test(field.attrs)

      if (isId) {
        parts.push('PRIMARY KEY')
      } else if (!field.optional && !field.isList) {
        parts.push('NOT NULL')
      }

      const def = sqlDefault(field)
      if (def !== null && !isId) parts.push(`DEFAULT ${def}`)

      columns.push(parts.join(' '))
      if (isUnique && !isId) constraints.push(`UNIQUE (${field.name})`)
    }

    for (const fields of model.uniques) {
      constraints.push(`UNIQUE (${fields.join(', ')})`)
    }

    // Foreign keys come from the owning side of each relation.
    for (const field of Object.values(model.fields)) {
      if (SCALARS.has(field.type)) continue
      const join = field.attrs.match(
        /@relation\(\s*(?:"[^"]*"\s*,\s*)?(?:fields:\s*\[([^\]]+)\]\s*,\s*references:\s*\[([^\]]+)\][^)]*)?(?:onDelete:\s*(\w+))?/,
      )
      if (!join || !join[1]) continue
      const localCol = join[1].split(',')[0].trim()
      const target = models[field.type]
      if (!target) continue
      const onDelete = join[3] ?? 'Cascade'
      const action = { Cascade: 'CASCADE', SetNull: 'SET NULL', Restrict: 'RESTRICT', NoAction: 'NO ACTION' }[onDelete]
      if (!action) continue
      constraints.push(
        `FOREIGN KEY (${localCol}) REFERENCES "${target.table}"(${join[2].split(',')[0].trim()}) ON DELETE ${action}`,
      )
    }

    const body = [...columns, ...constraints].map((line) => `  ${line}`).join(',\n')
    statements.push(`CREATE TABLE IF NOT EXISTS "${model.table}" (\n${body}\n);`)
  }

  // Indexes: @@index([a, b]) -> "<Table>_<a>_<b>_idx"
  const indexStatements = []
  for (const name of order) {
    const model = models[name]
    for (const field of Object.values(model.fields).map((f) => f.attrs)) void field
    for (const [fieldName, field] of Object.entries(model.fields)) {
      if (SCALARS.has(field.type)) continue
      void fieldName
      void field
    }
  }

  return { statements, indexStatements }
}

/** Indexes are declared as model-level `@@index` blocks; parse them separately. */
function parseIndexes(source, models) {
  const statements = []
  const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm
  let match
  while ((match = modelRe.exec(source))) {
    const [, modelName, body] = match
    const model = models[modelName]
    if (!model) continue
    for (const line of body.split('\n')) {
      const trimmed = line.replace(/\/\/.*$/, '').trim()
      const indexMatch = trimmed.match(/^@@index\(\[([^\]]+)\](?:,\s*map:\s*"([^"]+)")?\)/)
      if (!indexMatch) continue
      const cols = indexMatch[1].split(',').map((c) => c.trim().split('(')[0].trim())
      const indexName =
        indexMatch[2] ?? `${model.table}_${cols.join('_')}_idx`
      statements.push(
        `CREATE INDEX IF NOT EXISTS "${indexName}" ON "${model.table}"(${cols.map((c) => `"${c}"`).join(', ')});`,
      )
    }
  }
  return statements
}

const canonical = readFileSync(CANONICAL, 'utf8')
const { models, order } = parseSchema(canonical)
const { statements } = buildDdl(models, order)
const indexes = parseIndexes(canonical, models)

const output = `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * SQLite DDL for the fallback runtime, derived from prisma/schema.prisma by
 * scripts/generate-sqlite-ddl.mjs. CI fails if it is stale.
 *
 * \`CREATE TABLE IF NOT EXISTS\` is intentional: it brings a brand-new database
 * up to the current schema and leaves an existing one alone. Additive upgrades
 * for databases created by older releases are handled by
 * \`src/lib/db-migrations.cjs\`, which is tested.
 */

'use strict'

const DDL_STATEMENTS = ${JSON.stringify(statements, null, 2)}

const INDEX_STATEMENTS = ${JSON.stringify(indexes, null, 2)}

const INIT_SQL = [...DDL_STATEMENTS, ...INDEX_STATEMENTS].join('\\n')

module.exports = { INIT_SQL, DDL_STATEMENTS, INDEX_STATEMENTS }
`

const checkOnly = process.argv.includes('--check')
const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : null

if (current === output) {
  console.log('  up to date  src/lib/sqlite-ddl.cjs')
} else if (checkOnly) {
  console.error('  DRIFT       src/lib/sqlite-ddl.cjs differs from the canonical schema')
  console.error('Run: node scripts/generate-sqlite-ddl.mjs')
  process.exit(1)
} else {
  writeFileSync(OUTPUT, output)
  console.log(
    `  wrote       src/lib/sqlite-ddl.cjs (${statements.length} tables, ${indexes.length} indexes)`,
  )
}
