'use strict'

/**
 * Generated schema validity (finding #9, and the CI failure it caused).
 *
 * `prisma/schema.prisma` is the only editable schema; the provider variants are
 * generated. A generated variant that Prisma rejects is worse than a stale one:
 * the app still builds and the whole test suite still passes, because nothing
 * local validates a schema against a real Prisma engine — CI is the first place
 * it surfaces. That is exactly what happened: `File.url` was widened to
 * `@db.Text` while the canonical schema declares it `@unique`, and MySQL cannot
 * index a TEXT column without a prefix length, so `prisma validate` failed with
 * "Native type `Text` cannot be unique in MySQL".
 *
 * These checks run in the ordinary unit/security suites and cover the MySQL
 * restrictions we can verify textually, plus the invariants every variant must
 * keep (identical model set, identical relation names).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('fs')
const { join, resolve } = require('path')

const repo = resolve(__dirname, '../..')
const read = (file) => readFileSync(join(repo, file), 'utf8')

const VARIANTS = ['prisma/schema.sqlite.prisma', 'prisma/schema.mysql.prisma']

/** Split a schema into `{ modelName: blockText }`. */
function models(source) {
  const out = {}
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm
  let match
  while ((match = re.exec(source))) out[match[1]] = match[2]
  return out
}

/** Field name -> declared type token (e.g. `String?`). */
function fields(block) {
  const out = {}
  for (const line of block.split('\n')) {
    if (!line.trim() || line.trim().startsWith('//') || line.trim().startsWith('@@')) continue
    const match = line.match(/^\s*(\w+)\s+(\w+)(\?|\[\])?/)
    if (match) out[match[1]] = { type: match[2], suffix: match[3] || '', line }
  }
  return out
}

/** Every column named in an `@@unique`/`@@index` of a model. */
function indexedColumns(block) {
  const out = new Set()
  for (const match of block.matchAll(/@@(?:unique|index)\(\[([^\]]+)\]/g)) {
    for (const field of match[1].split(',')) out.add(field.trim())
  }
  return out
}

test('no generated MySQL schema indexes or uniquely constrains a TEXT column', () => {
  const source = read('prisma/schema.mysql.prisma')
  const offenders = []
  for (const [name, block] of Object.entries(models(source))) {
    const fieldMap = fields(block)
    for (const column of indexedColumns(block)) {
      const field = fieldMap[column]
      if (!field) continue
      if (/@db\.(Text|LongText|MediumText)/.test(field.line)) {
        offenders.push(`${name}.${column} (${field.line.trim()})`)
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `MySQL cannot use a TEXT column in a unique constraint or plain index:\n  ${offenders.join('\n  ')}`,
  )
})

test('string columns that are indexed stay at the bounded default width', () => {
  const source = read('prisma/schema.mysql.prisma')
  for (const [name, block] of Object.entries(models(source))) {
    const fieldMap = fields(block)
    for (const column of indexedColumns(block)) {
      const field = fieldMap[column]
      if (!field || field.type !== 'String') continue
      // A plain `String` is VARCHAR(191) on MySQL — bounded and indexable. Only
      // an explicit wide native type is a problem (covered by the previous
      // test), so assert the generator did not widen it.
      assert.doesNotMatch(
        field.line,
        /@db\.(Text|LongText|MediumText)/,
        `${name}.${column} is indexed and must not be widened to TEXT`,
      )
    }
  }
})

test('every generated variant declares the same models as the canonical schema', () => {
  const canonical = Object.keys(models(read('prisma/schema.prisma'))).sort()
  assert.ok(canonical.length > 40, `expected the canonical schema to have many models, got ${canonical.length}`)
  for (const variant of VARIANTS) {
    assert.deepEqual(Object.keys(models(read(variant))).sort(), canonical, `${variant} models drifted from canonical`)
  }
})

test('every generated variant keeps each relation and its @relation name', () => {
  const relationNames = (source) => {
    const out = {}
    for (const [name, block] of Object.entries(models(source))) {
      for (const line of block.split('\n')) {
        const match = line.match(/^\s*(\w+)\s+(\w+)(\?|\[\])?\s+@relation/)
        if (match) out[`${name}.${match[1]}`] = (line.match(/@relation\("([^"]+)"/) || [])[1] || ''
      }
    }
    return out
  }
  const canonical = relationNames(read('prisma/schema.prisma'))
  assert.ok(Object.keys(canonical).length > 20, 'canonical schema should declare many named relations')
  for (const variant of VARIANTS) {
    assert.deepEqual(relationNames(read(variant)), canonical, `${variant} lost or renamed a relation`)
  }
})

test('the MySQL migration only uses bounded VARCHAR for indexed columns', () => {
  const sql = read('prisma/migrations/20261124000000_complete_jara_tables/migration.sql')
  const offenders = []
  // Collect TEXT columns per table, then look for an index touching them.
  const tables = {}
  const tableRe = /CREATE TABLE IF NOT EXISTS `(\w+)` \(([\s\S]*?)\n\)/g
  let tableMatch
  while ((tableMatch = tableRe.exec(sql))) {
    const [, table, body] = tableMatch
    const textColumns = []
    for (const line of body.split('\n')) {
      const column = line.match(/^\s*`(\w+)`\s+(TEXT|LONGTEXT|MEDIUMTEXT)/i)
      if (column) textColumns.push(column[1])
    }
    if (textColumns.length) tables[table] = textColumns
  }
  // Only index *statements* count. A column may mention another table's name in
  // a comment, and a composite index is legal as long as its leading column is
  // bounded — MySQL only needs a prefix length for a TEXT column that starts the
  // index.
  const indexStatements = sql
    .split('\n')
    .filter((line) => /^(CREATE (UNIQUE )?INDEX|\s+UNIQUE INDEX|\s+INDEX|\s+KEY)\b/.test(line.trim()))
  for (const [table, columns] of Object.entries(tables)) {
    for (const column of columns) {
      const indexed = indexStatements.some((line) => {
        // Scope the statement to this table: `CREATE INDEX x ON `T`(...)`.
        // Without this, FileAccess's fileUrl index would be attributed to
        // JaraAsset, which has a fileUrl column of its own.
        const onTable = line.match(/ON\s+`(\w+)`/)
        if (!onTable || onTable[1] !== table) return false
        const columnsPart = line.slice(line.indexOf('(', line.indexOf('ON')) + 1, line.lastIndexOf(')'))
        const leading = columnsPart.split(',')[0].replace(/`/g, '').trim()
        return leading === column
      })
      if (indexed) offenders.push(`${table}.${column}`)
    }
  }
  assert.deepEqual(offenders, [], `indexed TEXT columns in the MySQL migration: ${offenders.join(', ')}`)
})

test('the generator refuses to emit a wide-text column that is indexed', () => {
  // Guard the guard: if someone re-adds an indexed column to WIDE_TEXT, the
  // generator must fail loudly rather than write an invalid variant.
  const codegen = read('scripts/lib/schema-codegen.mjs')
  assert.match(
    codegen,
    /assertWideTextIsNotIndexed\(canonicalSource\)/,
    'generateVariants must run the wide-text/index check',
  )
  const wide = codegen.slice(codegen.indexOf('export const WIDE_TEXT'), codegen.indexOf('const NARROW_STRING'))
  for (const field of ['File.url', 'FileAccess.fileUrl', 'Attachment.url', 'MessageReaction.emoji']) {
    assert.ok(!wide.includes(`'${field}'`), `${field} is indexed and must not be listed as WIDE_TEXT`)
  }
})
