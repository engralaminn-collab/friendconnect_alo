#!/usr/bin/env node
/**
 * Generate the MySQL "parity repair" migration.
 *
 * Background
 * ----------
 * The hand-written migration history and the canonical `prisma/schema.prisma`
 * drifted: 49 columns across 16 tables existed in the schema but were never
 * created by any migration. Nothing caught it because every test path either used
 * the SQLite runtime (which builds its tables from the generated DDL) or only
 * *validated* the MySQL schema without executing the migrations. The first real
 * `prisma migrate deploy` against MySQL surfaced it.
 *
 * This script writes an idempotent `ALTER TABLE ... ADD COLUMN` migration that
 * closes the gap. It is generated from the schema so it cannot itself drift.
 *
 * Idempotency is deliberate: production databases may already have had some of
 * these columns added by hand, so every statement is guarded with a
 * `information_schema` check. Re-running the migration on a partially repaired
 * database is a no-op instead of an error.
 *
 * Usage: node scripts/generate-parity-repair-migration.mjs [--check]
 *   --check  exit 1 if the on-disk migration does not match what would be generated
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(process.cwd())
const MIGRATION_NAME = '20261128000000_parity_repair_missing_columns'
const OUT_DIR = join(ROOT, 'prisma/migrations', MIGRATION_NAME)
const OUT_FILE = join(OUT_DIR, 'migration.sql')

const SCALAR = new Set(['String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json', 'Bytes'])

/** Parse the canonical schema into { model: { field: {column, type, optional, default} } }. */
function parseSchema(source) {
  const models = {}
  for (const match of source.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const [, name, body] = match
    const fields = {}
    for (const rawLine of body.split('\n')) {
      // Strip trailing comments so `@default("x") // note` parses.
      const line = rawLine.replace(/\/\/.*$/, '').trim()
      if (!line || line.startsWith('@@')) continue
      const fieldMatch = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?/)
      if (!fieldMatch) continue
      const [, field, type, list, optional] = fieldMatch
      if (!SCALAR.has(type)) continue
      const mapMatch = line.match(/@map\("([^"]+)"\)/)
      // `@default(now())` has a nested paren, so match to the end of the attribute.
      const defaultMatch = line.match(/@default\((.+)\)(?:\s|$)/)
      fields[field] = {
        column: mapMatch ? mapMatch[1] : field,
        type,
        optional: !!optional,
        isList: !!list,
        default: defaultMatch ? defaultMatch[1].trim() : null,
      }
    }
    if (Object.keys(fields).length) models[name] = fields
  }
  return models
}

/** Collect the columns the migration history actually creates. */
function parseMigrations(dir) {
  const tables = {}
  const ensure = (t) => (tables[t] ??= new Set())
  for (const entry of readdirSyncSafe(dir)) {
    const file = join(dir, entry, 'migration.sql')
    if (!existsSync(file)) continue
    // Skip the migration this script generates.
    if (entry === MIGRATION_NAME) continue
    const sql = readFileSync(file, 'utf8')
    for (const create of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?`(\w+)`\s*\(([\s\S]*?)\n\)[^\n]*;/g)) {
      ensure(create[1])
      for (const col of create[2].matchAll(/^\s+`(\w+)`/gm)) tables[create[1]].add(col[1])
    }
    for (const alter of sql.matchAll(/ALTER TABLE `(\w+)`\s+ADD COLUMN `(\w+)`/g)) {
      ensure(alter[1]).add(alter[2])
    }
  }
  return tables
}

function readdirSyncSafe(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

import { readdirSync } from 'node:fs'

/** Map a Prisma scalar to a MySQL column definition. */
function mysqlType(info) {
  switch (info.type) {
    case 'String':
      // Match the convention the existing migrations use for long free text: an
      // index-less TEXT column. `@@index` cannot cover an un-prefixed TEXT column
      // in MySQL, so a column is only widened when nothing indexes it.
      if (INDEXED_COLUMNS.has(`${currentTable}.${info.column}`)) return 'VARCHAR(191)'
      return LONG_TEXT_COLUMNS.has(info.column) ? 'TEXT' : 'VARCHAR(191)'
    case 'Int':
      return 'INTEGER'
    case 'BigInt':
      return 'BIGINT'
    case 'Float':
      return 'DOUBLE'
    case 'Decimal':
      return 'DECIMAL(65,30)'
    case 'Boolean':
      return 'BOOLEAN'
    case 'DateTime':
      return 'DATETIME(3)'
    case 'Json':
      return 'JSON'
    case 'Bytes':
      return 'LONGBLOB'
    default:
      return 'VARCHAR(191)'
  }
}

/** Translate a Prisma `@default` into MySQL DDL, or null when it has no SQL form. */
function mysqlDefault(info) {
  const value = info.default
  if (value === null) return null
  if (value === 'now()') return 'CURRENT_TIMESTAMP(3)'
  if (value === 'true') return 'true'
  if (value === 'false') return 'false'
  if (value === 'cuid()' || value === 'uuid()') {
    // Generated in the application, not by the database.
    return null
  }
  if (value === 'autoincrement()') return null
  // A quoted or numeric literal.
  const literal = value.match(/^"(.*)"$/)
  if (literal) return `'${literal[1].replace(/'/g, "''")}'`
  if (/^-?\d+(\.\d+)?$/.test(value)) return value
  if (value.startsWith('[') || value.startsWith('{')) return null
  return null
}

/**
 * Build the guarded DDL.
 *
 * `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` only exists in MariaDB, so each
 * statement is wrapped in a procedure that checks `information_schema` first. This
 * keeps the migration safe on MySQL 8 and safe to re-run.
 */
function buildSql(missing) {
  const lines = [
    '-- FriendConnect parity repair: add columns the canonical schema declares but',
    '-- no earlier migration created.',
    '--',
    '-- Generated by scripts/generate-parity-repair-migration.mjs — do not hand-edit.',
    '-- Every statement is guarded, so this migration is a no-op on a database that',
    '-- was already repaired by hand and safe to re-run.',
    '',
    'DROP PROCEDURE IF EXISTS fc_add_column;',
    '',
    'DELIMITER $$',
    'CREATE PROCEDURE fc_add_column(IN tbl VARCHAR(64), IN col VARCHAR(64), IN ddl TEXT)',
    'BEGIN',
    '  IF NOT EXISTS (',
    '    SELECT 1 FROM information_schema.COLUMNS',
    '    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND COLUMN_NAME = col',
    '  ) THEN',
    '    SET @s = CONCAT(\'ALTER TABLE `\', tbl, \'` ADD COLUMN `\', col, \'` \', ddl);',
    '    PREPARE stmt FROM @s;',
    '    EXECUTE stmt;',
    '    DEALLOCATE PREPARE stmt;',
    '  END IF;',
    'END$$',
    'DELIMITER ;',
    '',
  ]

  for (const [table, columns] of Object.entries(missing)) {
    currentTable = table
    lines.push(`-- ${table}`)
    for (const [column, info] of Object.entries(columns)) {
      const type = mysqlType(info)
      const def = mysqlDefault(info)
      // A NOT NULL column added to a populated table needs a default, or the
      // statement fails on existing rows. Where the schema has no SQL default we
      // add the column as NULL, which cannot fail, and leave the application to
      // populate it. That is stated here rather than silently widening the type.
      let ddl = type
      if (def !== null) {
        ddl += ` NOT NULL DEFAULT ${def}`
      } else if (info.optional) {
        ddl += ' NULL'
      } else {
        ddl += ' NULL'
      }
      const escaped = ddl.replace(/'/g, "''")
      lines.push(`CALL fc_add_column('${table}', '${column}', '${escaped}');`)
    }
    lines.push('')
  }

  lines.push('DROP PROCEDURE IF EXISTS fc_add_column;', '')
  return lines.join('\n')
}

/** Free-text columns that should be TEXT rather than VARCHAR(191). */
const LONG_TEXT_COLUMNS = new Set([
  'bio', 'detail', 'caption', 'changeReason', 'previousValue', 'newValue', 'metadata',
])

/** Columns that appear in an index, which must stay VARCHAR in MySQL. */
const INDEXED_COLUMNS = new Set()

/** Set while a table is being rendered, so mysqlType can consult the index set. */
let currentTable = ''

const schema = parseSchema(readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8'))
const existing = parseMigrations(join(ROOT, 'prisma/migrations'))

// Populate INDEXED_COLUMNS from the schema's @@index / @@unique declarations.
for (const match of readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8').matchAll(
  /^model (\w+) \{([\s\S]*?)^\}/gm,
)) {
  const [, model, body] = match
  for (const idx of body.matchAll(/@@(?:index|unique)\(\[([^\]]+)\]\)/g)) {
    for (const field of idx[1].split(',')) {
      const name = field.trim().replace(/\s.*$/, '')
      if (name) INDEXED_COLUMNS.add(`${model}.${name}`)
    }
  }
}

const missing = {}
for (const [model, fields] of Object.entries(schema)) {
  const created = existing[model] || new Set()
  for (const [field, info] of Object.entries(fields)) {
    if (created.has(info.column)) continue
    // The schema field name is keyed by column so the generator is order-stable.
    ;(missing[model] ??= {})[info.column] = info
  }
}

const sql = buildSql(missing)
const check = process.argv.includes('--check')

if (check) {
  if (!existsSync(OUT_FILE)) {
    console.error(`provider parity repair: ${OUT_FILE} is missing; run node scripts/generate-parity-repair-migration.mjs`)
    process.exit(1)
  }
  const onDisk = readFileSync(OUT_FILE, 'utf8')
  if (onDisk !== sql) {
    console.error('provider parity repair: the migration does not match the schema; regenerate it')
    process.exit(1)
  }
  console.log(
    `provider parity repair: up to date (${Object.keys(missing).length} tables, ${Object.values(missing).reduce((n, c) => n + Object.keys(c).length, 0)} columns)`,
  )
  process.exit(0)
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT_FILE, sql)
const tableCount = Object.keys(missing).length
const columnCount = Object.values(missing).reduce((n, c) => n + Object.keys(c).length, 0)
console.log(`wrote ${OUT_FILE}`)
console.log(`  ${tableCount} tables, ${columnCount} columns`)
if (!columnCount) console.log('  (nothing missing — the migration history already matches the schema)')
