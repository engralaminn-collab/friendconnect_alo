#!/usr/bin/env node
/**
 * Schema drift validation.
 *
 * The repository keeps one canonical Prisma schema and two generated variants.
 * Historically all three were edited by hand and drifted badly enough that
 * production MySQL was missing eleven models the code actively queries, and
 * `User.emailVerified` was a DateTime in the schema but a boolean in every
 * caller. This script is the guard that stops that from happening again.
 *
 * It runs without the Prisma CLI or the Prisma engines (neither is reachable in
 * every build environment), so it parses the `.prisma` files directly.
 *
 * Checks, in order of severity:
 *   1. canonical `prisma/schema.prisma` parses and every relation is paired
 *   2. generated variants declare exactly the canonical models and fields,
 *      except for documented type escapes (`String  <-> String?`)
 *   3. the SQLite fallback runtime (`src/lib/db-runtime.js`) knows every model
 *      the canonical schema declares and parses every scalar `DateTime`
 *   4. every `DateTime`/`Boolean` field is classified correctly by the runtime
 *   5. the checked-in SQL migrations create every table the canonical schema
 *      declares (the MySQL deployment path)
 *
 * Exit code 1 on any drift. `--json` prints machine-readable output.
 *
 * Usage:
 *   node scripts/check-schema-drift.mjs
 *   node scripts/check-schema-drift.mjs --json
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const SCHEMAS = {
  canonical: 'prisma/schema.prisma',
  sqlite: 'prisma/schema.sqlite.prisma',
  mysql: 'prisma/schema.mysql.prisma',
}
const RUNTIME = 'src/lib/db-runtime.js'
const MIGRATIONS = 'prisma/migrations'

/** Scalar Prisma types. Anything else that resolves to a model is a relation. */
const SCALARS = new Set([
  'String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean',
  'DateTime', 'Json', 'Bytes', 'Unsupported',
])

const problems = []
const notes = []

function fail(check, detail) {
  problems.push({ check, detail })
}

function note(check, detail) {
  notes.push({ check, detail })
}

/** Parse a `.prisma` file into `{ modelName: { fields, indexes, tableName } }`. */
function parseSchema(path) {
  const source = readFileSync(path, 'utf8')
  const models = {}
  const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm
  let match
  while ((match = modelRe.exec(source))) {
    const [, name, body] = match
    const fields = {}
    const indexes = []
    let tableName = null

    for (const rawLine of body.split('\n')) {
      const line = rawLine.replace(/\/\/.*$/, '').trim()
      if (!line) continue

      if (line.startsWith('@@map')) {
        tableName = line.match(/@@map\(\s*"([^"]+)"\s*\)/)?.[1] ?? null
        continue
      }
      if (line.startsWith('@@')) {
        indexes.push(line)
        continue
      }

      const fieldMatch = line.match(/^(\w+)\s+([\w.]+)(\[\])?(\?)?\s*(.*)$/)
      if (!fieldMatch) continue
      const [, fieldName, rawType, isList, isOptional, attrs] = fieldMatch
      fields[fieldName] = {
        name: fieldName,
        // Strip any native type suffix, e.g. `String @db.Text`
        type: rawType.split('.')[0],
        isList: Boolean(isList),
        optional: Boolean(isOptional),
        attrs,
      }
    }

    models[name] = { name, fields, indexes, tableName: tableName ?? name }
  }
  return models
}

function isScalarType(type) {
  return SCALARS.has(type)
}

function relationFields(model) {
  return Object.values(model.fields).filter((f) => !isScalarType(f.type))
}

function scalarFields(model) {
  return Object.values(model.fields).filter((f) => isScalarType(f.type))
}

// ---------------------------------------------------------------------------
// 1 + 2. Canonical schema self-consistency and variant parity
// ---------------------------------------------------------------------------

const schemas = {}
for (const [key, rel] of Object.entries(SCHEMAS)) {
  try {
    schemas[key] = parseSchema(join(ROOT, rel))
  } catch (err) {
    fail('parse', `cannot read ${rel}: ${err.message}`)
    schemas[key] = {}
  }
}

const canonical = schemas.canonical
const canonicalNames = Object.keys(canonical)

if (!canonicalNames.length) {
  fail('parse', 'canonical schema declares no models')
}

// Every relation must resolve to a model that declares a back-relation.
for (const model of Object.values(canonical)) {
  for (const field of relationFields(model)) {
    if (field.isList && field.attrs.includes('@relation') === false) {
      // list relations without @relation are plain back-relations; still check target
    }
    const target = canonical[field.type]
    if (!target) {
      fail('relation', `${model.name}.${field.name} references unknown model ${field.type}`)
      continue
    }
    const backReferences = relationFields(target).filter((f) => f.type === model.name)
    if (!backReferences.length) {
      fail('relation', `${model.name}.${field.name} -> ${field.type} has no back-relation`)
      continue
    }
    // Two relations between the same pair of models must both be named.
    const pairCount = relationFields(model).filter((f) => f.type === field.type).length
    if ((backReferences.length > 1 || pairCount > 1) && !/@relation\(\s*"/.test(field.attrs)) {
      fail('relation', `${model.name}.${field.name} needs an explicit @relation("...") name`)
    }
  }
}

// Variants must declare the same models and the same fields.
//
// The only sanctioned difference is a MySQL native type on a `String` field
// (`@db.Text`), which the generator applies from WIDE_TEXT. It does not change
// the Prisma scalar type, so it is not verified here beyond requiring the
// scalar to still be `String`.
const ALLOWED_TYPE_ESCAPES = new Set()

// The variants are generated; a manual edit is the failure mode we most need to
// catch. Verify the generated files match what the generator would produce.
try {
  const { generateVariants } = await import('./lib/schema-codegen.mjs')
  const canonicalSource = readFileSync(join(ROOT, SCHEMAS.canonical), 'utf8')
  const expected = generateVariants(canonicalSource)
  for (const key of ['sqlite', 'mysql']) {
    const target = join(ROOT, SCHEMAS[key])
    if (!existsSync(target)) {
      fail('generated', `${SCHEMAS[key]} is missing`)
      continue
    }
    const actual = readFileSync(target, 'utf8')
    const want = expected[key].endsWith('\n') ? expected[key] : `${expected[key]}\n`
    if (actual !== want) {
      fail(
        'generated',
        `${SCHEMAS[key]} was edited by hand or is stale — run node scripts/generate-schema-variants.mjs`,
      )
    }
  }
} catch (err) {
  fail('generated', `cannot verify generated variants: ${err.message}`)
}

for (const variantKey of ['sqlite', 'mysql']) {
  const variant = schemas[variantKey]
  const variantNames = Object.keys(variant)
  const label = SCHEMAS[variantKey]

  for (const name of canonicalNames) {
    if (!variant[name]) {
      fail('variant', `${label} is missing model ${name}`)
      continue
    }
    const canonFields = canonical[name].fields
    const varFields = variant[name].fields

    for (const [fieldName, field] of Object.entries(canonFields)) {
      const other = varFields[fieldName]
      if (!other) {
        fail('variant', `${label} ${name}.${fieldName} missing (canonical: ${field.type})`)
        continue
      }
      if (field.type !== other.type) {
        const escapeKey = `${name}.${fieldName}:${field.type}->${other.type}`
        if (ALLOWED_TYPE_ESCAPES.has(escapeKey)) {
          note('variant', `${label} ${name}.${fieldName} uses documented escape ${escapeKey}`)
        } else {
          fail('variant', `${label} ${name}.${fieldName} type ${other.type} != canonical ${field.type}`)
        }
      }
      if (field.isList !== other.isList) {
        fail('variant', `${label} ${name}.${fieldName} list-ness differs (${field.isList} vs ${other.isList})`)
      }
    }

    for (const fieldName of Object.keys(varFields)) {
      if (!canonFields[fieldName]) {
        fail('variant', `${label} ${name}.${fieldName} is not in the canonical schema`)
      }
    }
  }

  for (const name of variantNames) {
    if (!canonical[name]) {
      fail('variant', `${label} declares model ${name} which is not canonical`)
    }
  }
}

// ---------------------------------------------------------------------------
// 3 + 4. SQLite fallback runtime coverage
// ---------------------------------------------------------------------------

let runtimeSource = ''
try {
  runtimeSource = readFileSync(join(ROOT, RUNTIME), 'utf8')
} catch (err) {
  fail('runtime', `cannot read ${RUNTIME}: ${err.message}`)
}

/**
 * The runtime declares `const MODELS = { key: { table, dates: [...], bools: [...] } }`.
 * Pull out each entry's metadata without executing the module.
 */
function parseRuntimeModels(source) {
  const start = source.indexOf('const MODELS = {')
  if (start < 0) return null
  const endMarker = source.indexOf('\nconst INIT_SQL', start)
  const block = source.slice(start, endMarker > 0 ? endMarker : source.length)
  const entries = {}
  const entryRe = /^ {2}(\w+):\s*\{\n {4}table:\s*'([^']+)',([\s\S]*?)^ {2}\},/gm
  let match
  while ((match = entryRe.exec(block))) {
    const [, key, table, body] = match
    const dates = body.match(/dates:\s*\[([^\]]*)\]/)
    const bools = body.match(/bools:\s*\[([^\]]*)\]/)
    const uniques = body.match(/uniques:\s*\{([\s\S]*?)\n {4}\}/)
    entries[key] = {
      key,
      table,
      dates: dates ? [...dates[1].matchAll(/'(\w+)'/g)].map((m) => m[1]) : [],
      bools: bools ? [...bools[1].matchAll(/'(\w+)'/g)].map((m) => m[1]) : [],
      uniques: uniques ? uniques[1] : '',
    }
  }
  return entries
}

/** `EmailOtp` -> `emailOtp` : the runtime's delegate naming convention. */
function delegateKey(modelName) {
  return modelName[0].toLowerCase() + modelName.slice(1)
}

const runtimeModels = runtimeSource ? parseRuntimeModels(runtimeSource) : null

if (!runtimeModels) {
  fail('runtime', 'could not locate the MODELS map in db-runtime.js')
} else {
  for (const name of canonicalNames) {
    const key = delegateKey(name)
    const entry = runtimeModels[key]
    if (!entry) {
      fail('runtime', `db-runtime.js has no delegate for canonical model ${name} (expected key "${key}")`)
      continue
    }

    const expectedTable = canonical[name].tableName
    if (entry.table !== expectedTable) {
      fail('runtime', `delegate ${key} maps to table "${entry.table}", canonical says "${expectedTable}"`)
    }

    // Every scalar DateTime must be deserialised on read, otherwise callers get
    // a raw string and `.getTime()` throws at runtime (see finding #2).
    for (const field of scalarFields(canonical[name])) {
      if (field.type === 'DateTime' && !entry.dates.includes(field.name)) {
        fail('runtime', `delegate ${key} does not deserialise DateTime ${name}.${field.name}`)
      }
      if (field.type === 'Boolean' && !entry.bools.includes(field.name)) {
        fail('runtime', `delegate ${key} does not coerce Boolean ${name}.${field.name}`)
      }
    }

    // A field the runtime claims to date/bool but the schema does not declare
    // means the metadata is stale.
    for (const fieldName of entry.dates) {
      if (!canonical[name].fields[fieldName]) {
        fail('runtime', `delegate ${key} lists stale DateTime ${fieldName}`)
      }
    }
    for (const fieldName of entry.bools) {
      if (!canonical[name].fields[fieldName]) {
        fail('runtime', `delegate ${key} lists stale Boolean ${fieldName}`)
      }
    }
  }

  for (const key of Object.keys(runtimeModels)) {
    const isCanonical = canonicalNames.some((n) => delegateKey(n) === key)
    if (!isCanonical) {
      fail('runtime', `delegate "${key}" does not correspond to a canonical model`)
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Migration coverage (MySQL deployment path)
// ---------------------------------------------------------------------------

let migrationTables = new Set()
try {
  const dirs = readdirSync(join(ROOT, MIGRATIONS), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  for (const dir of dirs) {
    const sql = readFileSync(join(ROOT, MIGRATIONS, dir, 'migration.sql'), 'utf8')
    for (const match of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?`(\w+)`/g)) {
      migrationTables.add(match[1])
    }
    for (const match of sql.matchAll(/ALTER TABLE `(\w+)`/g)) {
      migrationTables.add(match[1]) // altered tables must already exist
    }
    for (const match of sql.matchAll(/DROP TABLE IF EXISTS `(\w+)`/g)) {
      // commented-out rollbacks must not count as coverage
      const line = sql.slice(0, match.index).split('\n').pop() ?? ''
      if (!line.trim().startsWith('--')) migrationTables.delete(match[1])
    }
  }
} catch (err) {
  fail('migrations', `cannot read ${MIGRATIONS}: ${err.message}`)
}

for (const name of canonicalNames) {
  const table = canonical[name].tableName
  if (!migrationTables.has(table)) {
    fail('migrations', `no checked-in migration creates table "${table}" (model ${name})`)
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const result = {
  ok: problems.length === 0,
  canonicalModels: canonicalNames.length,
  migrationTables: migrationTables.size,
  runtimeDelegates: runtimeModels ? Object.keys(runtimeModels).length : 0,
  problems,
  notes,
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(result, null, 2))
} else {
  console.log(
    `schema drift check — canonical models: ${result.canonicalModels}, ` +
    `runtime delegates: ${result.runtimeDelegates}, migration tables: ${result.migrationTables}`,
  )
  for (const n of notes) console.log(`  note  [${n.check}] ${n.detail}`)
  if (result.ok) {
    console.log('PASS: no schema drift detected.')
  } else {
    for (const p of problems) console.error(`  FAIL  [${p.check}] ${p.detail}`)
    console.error(`\n${problems.length} drift problem(s) found.`)
  }
}

process.exit(result.ok ? 0 : 1)
