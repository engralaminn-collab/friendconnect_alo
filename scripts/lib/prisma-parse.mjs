/**
 * Shared Prisma-schema parsing.
 *
 * The SQLite DDL generator, the metadata generator and the MySQL migration
 * generator all need the same view of `prisma/schema.prisma`. Keeping three
 * copies of this parser is how the original three schemas drifted apart, so it
 * lives here and is imported.
 */

export const SCALARS = new Set([
  'String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean',
  'DateTime', 'Json', 'Bytes', 'Unsupported',
])

export function parseSchema(source) {
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
export function sqlDefault(field) {
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

/** Indexes are declared as model-level `@@index` blocks; parse them separately. */
export function parseIndexes(source, models) {
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

