#!/usr/bin/env node
/**
 * Generate `src/lib/schema-metadata.cjs` from the canonical Prisma schema.
 *
 * The SQLite fallback runtime (`src/lib/db-runtime.js`) needs to know, per
 * model: the table name, which columns are DateTimes, which are Booleans,
 * compound unique keys, column defaults, and how relations join. That metadata
 * used to be maintained by hand and drifted from the schema — `User.lastSeenAt`
 * was missing from the DateTime list, so `/api/presence` threw
 * "lastSeenAt.getTime is not a function", and eleven models that the API
 * queries had no delegate at all.
 *
 * The metadata is a committed artifact rather than a runtime parse so that the
 * standalone build and the Docker image do not need `prisma/` present at
 * runtime. `scripts/check-schema-drift.mjs` fails CI if it is stale.
 *
 *   node scripts/generate-schema-metadata.mjs           # write
 *   node scripts/generate-schema-metadata.mjs --check   # verify only
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CANONICAL = join(ROOT, 'prisma/schema.prisma')
const OUTPUT = join(ROOT, 'src/lib/schema-metadata.cjs')

const SCALARS = new Set([
  'String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean',
  'DateTime', 'Json', 'Bytes', 'Unsupported',
])

function delegateKey(modelName) {
  return modelName[0].toLowerCase() + modelName.slice(1)
}

function parseSchema(source) {
  const models = {}
  const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm
  let match

  while ((match = modelRe.exec(source))) {
    const [, name, body] = match
    const fields = {}
    const uniques = {}
    let tableName = name

    for (const rawLine of body.split('\n')) {
      const line = rawLine.replace(/\/\/.*$/, '').trim()
      if (!line) continue

      const mapMatch = line.match(/^@@map\(\s*"([^"]+)"\s*\)/)
      if (mapMatch) {
        tableName = mapMatch[1]
        continue
      }

      const uniqueMatch = line.match(/^@@(?:unique|id)\(\[([^\]]+)\]/)
      if (uniqueMatch) {
        const fieldNames = uniqueMatch[1].split(',').map((f) => f.trim().split('(')[0].trim())
        if (fieldNames.length > 1) uniques[fieldNames.join('_')] = fieldNames
        continue
      }
      const namedUnique = line.match(/^@@unique\(\[([^\]]+)\],\s*name:\s*"([^"]+)"\)/)
      if (namedUnique) {
        const fieldNames = namedUnique[1].split(',').map((f) => f.trim())
        uniques[namedUnique[2]] = fieldNames
        continue
      }
      if (line.startsWith('@@')) continue

      const fieldMatch = line.match(/^(\w+)\s+([\w.]+)(\[\])?(\?)?\s*(.*)$/)
      if (!fieldMatch) continue
      const [, fieldName, rawType, isList, isOptional, attrs] = fieldMatch
      const type = rawType.split('.')[0]
      fields[fieldName] = {
        name: fieldName,
        type,
        isList: Boolean(isList),
        optional: Boolean(isOptional),
        // Normalise spacing so downstream regexes are predictable.
        attrs: attrs.replace(/\s+/g, ' ').trim(),
      }
    }

    models[name] = { name, table: tableName, fields, uniques }
  }
  return models
}

/** Escape a value for embedding in generated JS. */
function js(value) {
  return JSON.stringify(value)
}

/** Translate a Prisma `@default(...)` / `@updatedAt` into runtime behaviour. */
function defaultExpression(field) {
  const attrs = field.attrs
  if (/@updatedAt/.test(attrs)) {
    return { kind: 'now' }
  }
  // Balance parentheses: `@default(now())` nests one level deep.
  const start = attrs.indexOf('@default(')
  if (start < 0) return null
  let depth = 0
  let end = -1
  for (let i = start + '@default('.length - 1; i < attrs.length; i += 1) {
    if (attrs[i] === '(') depth += 1
    else if (attrs[i] === ')') {
      depth -= 1
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end < 0) return null
  const raw = attrs.slice(start + '@default('.length, end).trim()

  if (/^(cuid|uuid|ulid)\(\)$/.test(raw)) return { kind: 'id' }
  if (raw === 'now()') return { kind: 'now' }
  if (raw === 'true') return { kind: 'literal', value: true }
  if (raw === 'false') return { kind: 'literal', value: false }
  if (/^-?\d+(\.\d+)?$/.test(raw)) return { kind: 'literal', value: Number(raw) }
  if (/^"[^"]*"$/.test(raw)) return { kind: 'literal', value: raw.slice(1, -1) }
  if (raw.startsWith('[')) return null // unsupported list default; leave to caller
  if (raw.startsWith('dbgenerated')) return null
  return null
}

function buildMetadata(models) {
  const lines = []
  lines.push('/**')
  lines.push(' * GENERATED FILE — DO NOT EDIT BY HAND.')
  lines.push(' *')
  lines.push(' * Produced from prisma/schema.prisma by scripts/generate-schema-metadata.mjs.')
  lines.push(' * Consumed by src/lib/db-runtime.js (the SQLite fallback data layer).')
  lines.push(' * CI verifies it matches the canonical schema (scripts/check-schema-drift.mjs).')
  lines.push(' */')
  lines.push("'use strict'")
  lines.push('')
  lines.push('const { randomUUID } = require(\'crypto\')')
  lines.push('')
  lines.push('function cuid() {')
  lines.push("  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10) + randomUUID().slice(0, 8)")
  lines.push('}')
  lines.push('')
  lines.push('const MODELS = {')

  for (const model of Object.values(models)) {
    const dates = []
    const bools = []
    const defaults = []

    for (const field of Object.values(model.fields)) {
      if (!SCALARS.has(field.type)) continue
      if (field.type === 'DateTime') dates.push(field.name)
      if (field.type === 'Boolean') bools.push(field.name)

      const def = defaultExpression(field)
      if (def) defaults.push({ field: field.name, ...def })
    }

    lines.push(`  ${js(delegateKey(model.name))}: {`)
    lines.push(`    model: ${js(model.name)},`)
    lines.push(`    table: ${js(model.table)},`)
    lines.push(`    dates: ${js(dates)},`)
    lines.push(`    bools: ${js(bools)},`)
    lines.push(`    uniques: ${js(model.uniques)},`)
    if (defaults.length) {
      lines.push('    defaults: () => ({')
      for (const d of defaults) {
        if (d.kind === 'id') lines.push(`      ${d.field}: cuid(),`)
        else if (d.kind === 'now') lines.push(`      ${d.field}: new Date(),`)
        else lines.push(`      ${d.field}: ${js(d.value)},`)
      }
      lines.push('    }),')
    }
    lines.push('  },')

    // Relations are emitted separately below so the join metadata can reference
    // the opposite side of the relation.
  }

  lines.push('}')
  lines.push('')
  lines.push('/** Flat `{ table, columns[] }` view used to verify a live SQLite schema. */')
  lines.push('const EXPECTED_COLUMNS = {}')
  for (const model of Object.values(models)) {
    const columns = Object.values(model.fields)
      .filter((field) => SCALARS.has(field.type))
      .map((field) => field.name)
    // Keyed by delegate name (`user`), matching MODELS, so callers can look a
    // model up the same way in both maps.
    lines.push(`EXPECTED_COLUMNS[${js(delegateKey(model.name))}] = { table: ${js(model.table)}, columns: ${JSON.stringify(columns)} }`)
  }
  lines.push('')
  lines.push('module.exports = { MODELS, EXPECTED_COLUMNS, cuid }')
  lines.push('')
  return lines.join('\n')
}

/**
 * Derive relation metadata.
 *
 * Runtime shape: `{ [field]: { kind: 'one'|'many', model, from, to } }` where
 * `from` is a column on this model and `to` is a column on the target model.
 *
 * - `one` relations carry `@relation(fields: [a], references: [b])` on this side
 * - `many` (list) relations mirror the opposite scalar owner's join columns
 */
function buildRelations(models) {
  const relations = {}

  for (const model of Object.values(models)) {
    relations[model.name] = {}
    for (const field of Object.values(model.fields)) {
      if (SCALARS.has(field.type)) continue
      const target = models[field.type]
      if (!target) continue

      const relationName = field.attrs.match(/@relation\(\s*"([^"]+)"/)?.[1] ?? null
      relations[model.name][field.name] = {
        model: field.type,
        kind: field.isList ? 'many' : 'one',
        relationName,
        from: null,
        to: null,
      }
    }
  }

  // One-to-one back references: `Profile.userId` is the owning side, so
  // `User.profile` is `{ from: 'id', to: 'userId' }`. An unnamed scalar back
  // reference is unambiguous when the target has exactly one scalar field
  // pointing back at this model.
  for (const model of Object.values(models)) {
    for (const [relName, rel] of Object.entries(relations[model.name])) {
      if (rel.kind !== 'one') continue
      if (rel.from !== null) continue // already the owning side
      if (rel.relationName) continue // handled by name below
      const candidates = Object.values(models[rel.model].fields).filter(
        (field) => SCALARS.has(field.type) && /_id$|[a-z]Id$/.test(field.name) === false && false,
      )
      void candidates
      const backPointers = Object.entries(models[rel.model].fields).filter(
        ([, field]) =>
          SCALARS.has(field.type) &&
          field.name === `${model.name[0].toLowerCase()}${model.name.slice(1)}Id`,
      )
      if (backPointers.length === 1) {
        rel.from = 'id'
        rel.to = backPointers[0][0]
      }
    }
  }

  // Fill join columns from the owning (non-list) side of each relation.
  for (const model of Object.values(models)) {
    for (const field of Object.values(model.fields)) {
      if (SCALARS.has(field.type)) continue
      const join = field.attrs.match(/@relation\(\s*(?:"[^"]*"\s*,\s*)?fields:\s*\[([^\]]+)\]\s*,\s*references:\s*\[([^\]]+)\]/)
      if (!join) continue
      const localCols = join[1].split(',').map((c) => c.trim())
      const foreignCols = join[2].split(',').map((c) => c.trim())
      if (localCols.length !== 1 || foreignCols.length !== 1) continue // composite: unsupported

      const own = relations[model.name][field.name]
      own.from = localCols[0]
      own.to = foreignCols[0]

      // Mirror onto the opposite side. It can be a list (one-to-many) or a
      // scalar (one-to-one, e.g. `User.profile`), and it is identified by the
      // *relation name* when Prisma declares one — matching on "any unvisited
      // opposite field" conflated several relations between the same two models
      // (User -> Group has both `ownedGroups` and `groupMemberships`).
      const relationName = own.relationName
      for (const [backName, backRel] of Object.entries(relations[field.type] ?? {})) {
        if (backRel.model !== model.name) continue
        if (backRel.from !== null || backRel.to !== null) continue
        if (relationName) {
          if (backRel.relationName !== relationName) continue
        } else if (backRel.kind !== 'many') {
          // Without a relation name, only a list can be the unambiguous back
          // reference; a scalar one-to-one needs a declared name.
          continue
        }
        relations[field.type][backName].from = foreignCols[0]
        relations[field.type][backName].to = localCols[0]
      }
    }
  }

  return relations
}

const canonical = readFileSync(CANONICAL, 'utf8')
const models = parseSchema(canonical)
const relations = buildRelations(models)

let output = buildMetadata(models)

// Splice relation metadata into each generated entry.
const relationLines = []
relationLines.push('')
relationLines.push('// Join metadata: { kind, model, from, to } per relation field.')
relationLines.push('const RELATIONS = {')
for (const [modelName, fields] of Object.entries(relations)) {
  const resolved = {}
  for (const [fieldName, rel] of Object.entries(fields)) {
    if (rel.from === null || rel.to === null) continue
    resolved[fieldName] = {
      kind: rel.kind,
      model: delegateKey(rel.model),
      from: rel.from,
      to: rel.to,
    }
  }
  relationLines.push(`  ${js(delegateKey(modelName))}: ${JSON.stringify(resolved, null, 2).replace(/\n/g, '\n  ')},`)
  // Persist the resolution. The loop below used to copy from `RELATIONS`, which
  // is the *filtered* map, so relations whose join columns were resolved by the
  // back-reference pass (one-to-one, e.g. `User.profile`) never reached the
  // runtime and `include` returned nothing for them.
  models[modelName].relations = {}
  for (const [fieldName, rel] of Object.entries(fields)) {
    if (rel.from === null || rel.to === null) continue
    models[modelName].relations[fieldName] = {
      kind: rel.kind,
      model: delegateKey(rel.model),
      from: rel.from,
      to: rel.to,
    }
  }
}
relationLines.push('}')
relationLines.push('')
relationLines.push('for (const [key, rels] of Object.entries(RELATIONS)) {')
relationLines.push('  if (MODELS[key]) MODELS[key].relations = rels')
relationLines.push('}')
relationLines.push('')

// Anchor on the export line the builder actually emits. This previously searched
// for the pre-EXPECTED_COLUMNS spelling, so the replace silently did nothing and
// `MODELS[key].relations` was never populated — every `include:` in the app
// returned nothing, including the socket handshake's user lookup.
const EXPORT_MARKER = 'module.exports = { MODELS, EXPECTED_COLUMNS, cuid }\n'
if (!output.includes(EXPORT_MARKER)) {
  console.error('FAIL: cannot find the module.exports line to splice relations into.')
  process.exit(1)
}
output = output.replace(
  EXPORT_MARKER,
  relationLines.join('\n') + '\nmodule.exports = { MODELS, EXPECTED_COLUMNS, RELATIONS, cuid }\n',
)

const checkOnly = process.argv.includes('--check')
const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : null

if (current === output) {
  console.log('  up to date  src/lib/schema-metadata.cjs')
} else if (checkOnly) {
  console.error('  DRIFT       src/lib/schema-metadata.cjs differs from the canonical schema')
  console.error('Run: node scripts/generate-schema-metadata.mjs')
  process.exit(1)
} else {
  writeFileSync(OUTPUT, output)
  const modelCount = Object.keys(models).length
  const relCount = Object.values(relations).reduce((n, r) => n + Object.keys(r).length, 0)
  console.log(`  wrote       src/lib/schema-metadata.cjs (${modelCount} models, ${relCount} relation fields)`)
}
