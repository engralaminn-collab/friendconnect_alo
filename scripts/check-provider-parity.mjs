#!/usr/bin/env node
/**
 * Provider parity check: does the MySQL migration history create the *same*
 * columns as the canonical Prisma schema?
 *
 * Why this exists
 * ---------------
 * `check-schema-drift.mjs` proves that every canonical model has a table somewhere
 * in the migration history. It does not prove that the table has the right
 * *columns*. A drift there is invisible until something runs against a real MySQL
 * server — which is exactly what happened: the Docker/MySQL verification job was
 * the first thing that ever executed these migrations, and the client generated
 * from `schema.prisma` did not agree with the tables the migrations create.
 *
 * This check is static and runs in the normal quality job, so a mismatch fails
 * fast and locally instead of only in the container job.
 *
 * Compares, for every canonical model:
 *   - each scalar field must appear as a column in the migration DDL
 *   - each `@map`ped field must appear under its mapped name
 *
 * Exit codes: 0 = parity, 1 = mismatch found.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(process.cwd())
const SCHEMA = join(ROOT, 'prisma/schema.prisma')
const MIGRATIONS = join(ROOT, 'prisma/migrations')

/** Scalar Prisma types that become columns. Anything else is a relation. */
const SCALAR_TYPES = new Set([
  'String',
  'Int',
  'BigInt',
  'Float',
  'Decimal',
  'Boolean',
  'DateTime',
  'Json',
  'Bytes',
])

/** Parse the canonical schema into { model: { field: { type, map } } }. */
function parseSchema(source) {
  const models = {}
  const modelRe = /^model (\w+) \{([\s\S]*?)^\}/gm
  let match
  while ((match = modelRe.exec(source))) {
    const [, name, body] = match
    const fields = {}
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('//') || line.startsWith('@@')) continue
      const fieldMatch = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?/)
      if (!fieldMatch) continue
      const [, field, type] = fieldMatch
      if (!SCALAR_TYPES.has(type)) continue
      const mapMatch = line.match(/@map\("([^"]+)"\)/)
      fields[field] = { type, column: mapMatch ? mapMatch[1] : field }
    }
    if (Object.keys(fields).length) models[name] = fields
  }
  return models
}

/**
 * Collect columns per table from the migration history.
 *
 * Handles both `CREATE TABLE` bodies and later `ALTER TABLE ... ADD COLUMN`
 * statements, because a column can legitimately arrive in a follow-up migration.
 */
function parseMigrations(dir) {
  const tables = {}
  const definitions = {}
  const ensure = (t) => (tables[t] ??= new Set())
  const dirs = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()

  for (const name of dirs) {
    const file = join(dir, name, 'migration.sql')
    if (!existsSync(file)) continue
    const sql = readFileSync(file, 'utf8')

    // CREATE TABLE `X` ( ... );
    // The body ends at a line containing only `)` — optionally followed by table
    // options such as `DEFAULT CHARACTER SET ...;`. Matching on `ENGINE|DEFAULT`
    // after the paren was wrong: it missed the `DEFAULT CHARACTER SET` form and
    // over-matched into later statements.
    const createRe = /CREATE TABLE (?:IF NOT EXISTS )?`(\w+)`\s*\(([\s\S]*?)\n\)[^\n]*;/g
    let create
    while ((create = createRe.exec(sql))) {
      const [, table, body] = create
      ensure(table)
      for (const line of body.split('\n')) {
        const column = line.trim().match(/^`(\w+)`\s+(.+?)(?:,)?$/)
        if (column) {
          tables[table].add(column[1])
          definitions[`${table}.${column[1]}`] = column[2].replace(/,$/, '').trim()
        }
        // Named table-level constraints are not columns.
      }
    }

    // ALTER TABLE `X` ADD COLUMN `y` ...
    for (const alter of sql.matchAll(/ALTER TABLE `(\w+)`\s+ADD COLUMN `(\w+)`\s+([^;]+);/g)) {
      ensure(alter[1]).add(alter[2])
      definitions[`${alter[1]}.${alter[2]}`] = alter[3].trim()
    }

    // Track the final shape after compatibility repairs.
    for (const modify of sql.matchAll(/ALTER TABLE `(\w+)`\s+MODIFY COLUMN `(\w+)`\s+([^;]+);/g)) {
      ensure(modify[1]).add(modify[2])
      definitions[`${modify[1]}.${modify[2]}`] = modify[3].trim()
    }
  }
  return { tables, definitions }
}

const problems = []

if (!existsSync(SCHEMA) || !existsSync(MIGRATIONS)) {
  console.error('provider parity: cannot find prisma/schema.prisma or prisma/migrations')
  process.exit(1)
}

const models = parseSchema(readFileSync(SCHEMA, 'utf8'))
const { tables, definitions } = parseMigrations(MIGRATIONS)

let comparedColumns = 0
for (const [model, fields] of Object.entries(models)) {
  const table = tables[model]
  if (!table) {
    problems.push(`model ${model}: no CREATE TABLE in the migration history`)
    continue
  }
  for (const [field, info] of Object.entries(fields)) {
    comparedColumns += 1
    if (!table.has(info.column)) {
      problems.push(
        `model ${model}: schema field "${field}" maps to column "${info.column}" which the migrations never create`,
      )
    }
  }
}

// Extra nullable columns preserve legacy data and do not block canonical writes.
// Extra NOT NULL columns without a database default do: Prisma does not know to
// send them, so every create fails. This caught Profile.updatedAt after the first
// real MySQL CRUD reached profile.create().
for (const [table, columns] of Object.entries(tables)) {
  const canonical = new Set(Object.values(models[table] || {}).map((field) => field.column))
  for (const column of columns) {
    if (canonical.has(column)) continue
    const definition = definitions[`${table}.${column}`] || ''
    if (/\bNOT NULL\b/i.test(definition) && !/\bDEFAULT\b/i.test(definition)) {
      problems.push(
        `table ${table}: migration-only column "${column}" is NOT NULL without a default and blocks canonical Prisma creates`,
      )
    }
  }
}

if (problems.length) {
  console.error(`Provider parity FAILED (${problems.length} problem(s)):`)
  for (const p of problems.slice(0, 40)) console.error(`  - ${p}`)
  if (problems.length > 40) console.error(`  ... and ${problems.length - 40} more`)
  console.error(
    '\nThe canonical schema and the MySQL migration history disagree. Regenerate the migration with',
  )
  console.error('`npm run schema:migration`, or fix the hand-written migration.')
  process.exit(1)
}

console.log(
  `Provider parity PASSED: ${Object.keys(models).length} models, ${comparedColumns} canonical columns, and no blocking migration-only constraints.`,
)
