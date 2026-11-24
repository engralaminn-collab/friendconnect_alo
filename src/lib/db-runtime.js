'use strict'

/**
 * Prisma-compatible data layer using Node's built-in SQLite (no Prisma engines).
 * Used when DATABASE_URL is file:… — production MySQL still uses Prisma when generated.
 */
const { randomBytes } = require('crypto')
const { mkdirSync, existsSync } = require('fs')
const { dirname, resolve } = require('path')

function cuid() {
  return 'c' + Date.now().toString(36) + randomBytes(8).toString('hex')
}

function now() {
  return new Date()
}

function toSqlDate(v) {
  if (v == null) return null
  if (v instanceof Date) return v.toISOString()
  return String(v)
}

function parseRow(model, row) {
  if (!row) return null
  const out = { ...row }
  for (const k of model.dates || []) {
    if (out[k] != null && out[k] !== '') {
      const d = new Date(out[k])
      out[k] = isNaN(d.getTime()) ? out[k] : d
    } else if (out[k] === '') out[k] = null
  }
  for (const k of model.bools || []) {
    if (out[k] === 0 || out[k] === 1 || out[k] === '0' || out[k] === '1') out[k] = Boolean(Number(out[k]))
  }
  return out
}

// Model/table/relation metadata is generated from prisma/schema.prisma.
// See scripts/generate-schema-metadata.mjs — do not hand-edit.
const { MODELS, EXPECTED_COLUMNS } = require('./schema-metadata.cjs')
// SQLite DDL is generated from prisma/schema.prisma.
// See scripts/generate-sqlite-ddl.mjs — do not hand-edit.
const { INIT_SQL } = require('./sqlite-ddl.cjs')
// Additive upgrades for databases created by older releases.
const { runAdditiveMigrations, findMissingColumns } = require('./db-migrations.cjs')


/**
 * Project root used to resolve relative paths (DATABASE_URL=file:./db/…, UPLOAD_DIR=./upload).
 * The Next.js standalone server does `process.chdir('.next/standalone')`, so resolving
 * against process.cwd() made Next use `.next/standalone/db/custom.db` while the socket
 * server used `./db/custom.db` — two different databases. Sessions created at login were
 * invisible to the socket server (socket auth failed → no calls, no realtime messages),
 * and every `npm run build` replaced the standalone copy, wiping users and messages.
 */
function appRoot() {
  if (process.env.APP_DIR) return resolve(process.env.APP_DIR)
  const cwd = process.cwd()
  if (/[\\/]\.next[\\/]standalone$/.test(cwd)) return resolve(cwd, '..', '..')
  return cwd
}

function resolveDbPath() {
  const url = process.env.DATABASE_URL || 'file:./db/custom.db'
  if (url.startsWith('file:')) {
    let p = url.slice(5)
    if (p.startsWith('./') || !p.startsWith('/')) p = resolve(appRoot(), p.replace(/^\.\//, ''))
    const dir = dirname(p)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return p
  }
  throw new Error('This runtime only supports SQLite DATABASE_URL (file:...). For MySQL run prisma generate on a host that can download Prisma engines.')
}

let sqlite
let jaraSeeded = false
let seedPromise = Promise.resolve()
/**
 * Seed the built-in Jara identity.
 *
 * Runs through the delegate layer rather than raw SQL so column defaults come
 * from the schema. Writing raw INSERTs here is what let the seed drift: it was
 * supplying `Profile.updatedAt` (not a column) and omitting `JaraConfig`
 * governance columns that are NOT NULL.
 */
async function ensureJaraSeed() {
  if (jaraSeeded) return
  jaraSeeded = true
  try {
    const prisma = sqlitePrisma
    const jaraId = 'jara-ai-system-001'

    const existing = await prisma.user.findUnique({ where: { id: jaraId } })
    if (!existing) {
      await prisma.user.create({
        data: {
          id: jaraId,
          email: 'jara@friendconnect.local',
          username: 'jara',
          passwordHash: '__JARA_SYSTEM__', // never a valid bcrypt hash: no password login
          name: 'Jara',
          role: 'jara',
          bio: 'I am Jara — your friendly AI assistant. 🤖 I can chat in English, Bangla, and Banglish!',
          status: 'AI Assistant • Online',
          avatarUrl: '/jara-avatar.svg',
          emailVerified: true,
        },
      })
      await prisma.profile.create({
        data: {
          id: 'profile-jara-001',
          userId: jaraId,
          bio: 'AI Assistant — I am Jara, here to help you!',
          profileVisibility: 'PUBLIC',
          messagePermission: 'EVERYONE',
          callPermission: 'EVERYONE',
          verified: 'verified',
        },
      })
    }

    const live = await prisma.jaraConfig.findFirst({ where: { isLive: true } })
    if (!live) {
      const any = await prisma.jaraConfig.findFirst({})
      if (!any) {
        await prisma.jaraConfig.create({
          data: {
            version: 1,
            colors: JSON.stringify({ primary: '#10b981', accent: '#0ea5e9' }),
            isLive: true,
            createdBy: jaraId,
          },
        })
      } else {
        await prisma.jaraConfig.updateMany({ where: {}, data: { isLive: false } })
        await prisma.jaraConfig.update({ where: { id: any.id }, data: { isLive: true } })
      }
    }
  } catch (e) {
    console.warn('[jara] seed failed:', e.message)
  }
}

function getSqlite() {
  if (sqlite) return sqlite
  const Database = require('better-sqlite3')
  const dbPath = resolveDbPath()
  sqlite = new Database(dbPath)
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('journal_mode = WAL')
  sqlite.exec(INIT_SQL)
  // Migrations are additive patches for databases created by older releases. On
  // a severely damaged database they can themselves fail (a backfill cannot read
  // a column that never existed), so record the failure and let the column check
  // below produce the diagnostic instead of leaking a raw SQLite message.
  let migrationError = null
  try {
    runAdditiveMigrations(sqlite, { log: (m) => console.log(m) })
  } catch (error) {
    migrationError = error
  }

  // Fail loudly rather than serving requests against a half-migrated database.
  // A missing column turns into a 500 on whichever route touches it, which is
  // much harder to diagnose than refusing to boot.
  const missing = findMissingColumns(sqlite, EXPECTED_COLUMNS)
  if (missing.length) {
    const cause = migrationError ? ` Migration could not complete: ${migrationError.message}.` : ''
    throw new Error(
      `[db] SQLite database schema is incomplete (${missing.length} missing column(s)/table(s)). ` +
        `Missing: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ', …' : ''}.${cause} ` +
        `Restore this database from a backup, or point DATABASE_URL at a new file to create a fresh one.`,
    )
  }
  // Seed asynchronously; the promise is stored so tests can await it and so a
  // failure is reported once instead of on every request.
  seedPromise = ensureJaraSeed().catch((e) => {
    console.warn('[jara] seed failed:', e.message)
  })
  return sqlite
}

function encodeVal(model, key, v) {
  if (v === undefined) return undefined
  if (v === null) return null
  if ((model.dates || []).includes(key)) return toSqlDate(v)
  if ((model.bools || []).includes(key)) return v ? 1 : 0
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'boolean') return v ? 1 : 0
  return v
}

function expandWhere(model, where) {
  if (!where || typeof where !== 'object') return where
  const out = { ...where }
  if (model.uniques) {
    for (const [name, fields] of Object.entries(model.uniques)) {
      if (out[name] && typeof out[name] === 'object') {
        const obj = out[name]
        delete out[name]
        for (const f of fields) out[f] = obj[f]
      }
    }
  }
  return out
}

function cond(model, where, alias) {
  const prefix = alias ? `${alias}.` : ''
  const params = []
  if (!where || Object.keys(where).length === 0) return { sql: '1=1', params }

  const parts = []
  const w = expandWhere(model, where)

  const pushFilter = (col, val) => {
    const qcol = `${prefix}"${col}"`
    if (val === null) {
      parts.push(`${qcol} IS NULL`)
      return
    }
    if (val === undefined) return
    if (typeof val !== 'object' || val instanceof Date) {
      parts.push(`${qcol} = ?`)
      params.push(encodeVal(model, col, val))
      return
    }
    if (Array.isArray(val)) {
      parts.push(`${qcol} IN (${val.map(() => '?').join(',')})`)
      val.forEach((x) => params.push(encodeVal(model, col, x)))
      return
    }
    if ('equals' in val) {
      if (val.equals === null) parts.push(`${qcol} IS NULL`)
      else {
        parts.push(`${qcol} = ?`)
        params.push(encodeVal(model, col, val.equals))
      }
    }
    if ('not' in val) {
      if (val.not === null) parts.push(`${qcol} IS NOT NULL`)
      else {
        parts.push(`${qcol} <> ?`)
        params.push(encodeVal(model, col, val.not))
      }
    }
    if ('in' in val && Array.isArray(val.in)) {
      if (val.in.length === 0) parts.push('0=1')
      else {
        parts.push(`${qcol} IN (${val.in.map(() => '?').join(',')})`)
        val.in.forEach((x) => params.push(encodeVal(model, col, x)))
      }
    }
    if ('notIn' in val && Array.isArray(val.notIn)) {
      if (val.notIn.length === 0) {
        /* no-op */
      } else {
        parts.push(`${qcol} NOT IN (${val.notIn.map(() => '?').join(',')})`)
        val.notIn.forEach((x) => params.push(encodeVal(model, col, x)))
      }
    }
    if ('gt' in val) {
      parts.push(`${qcol} > ?`)
      params.push(encodeVal(model, col, val.gt))
    }
    if ('gte' in val) {
      parts.push(`${qcol} >= ?`)
      params.push(encodeVal(model, col, val.gte))
    }
    if ('lt' in val) {
      parts.push(`${qcol} < ?`)
      params.push(encodeVal(model, col, val.lt))
    }
    if ('lte' in val) {
      parts.push(`${qcol} <= ?`)
      params.push(encodeVal(model, col, val.lte))
    }
    if ('contains' in val) {
      parts.push(`LOWER(${qcol}) LIKE ?`)
      params.push(`%${String(val.contains).toLowerCase()}%`)
    }
  }

  for (const [k, v] of Object.entries(w)) {
    if (k === 'OR' && Array.isArray(v)) {
      const orParts = []
      for (const item of v) {
        const c = cond(model, item, alias)
        orParts.push(`(${c.sql})`)
        params.push(...c.params)
      }
      if (orParts.length) parts.push(`(${orParts.join(' OR ')})`)
      continue
    }
    if (k === 'AND' && Array.isArray(v)) {
      for (const item of v) {
        const c = cond(model, item, alias)
        parts.push(`(${c.sql})`)
        params.push(...c.params)
      }
      continue
    }
    if (k === 'NOT') {
      const c = cond(model, v, alias)
      parts.push(`NOT (${c.sql})`)
      params.push(...c.params)
      continue
    }
    pushFilter(k, v)
  }

  return { sql: parts.length ? parts.join(' AND ') : '1=1', params }
}

function splitSelect(model, select) {
  if (!select) return { scalar: null, include: null }
  const scalar = {}
  const include = {}
  for (const [k, v] of Object.entries(select)) {
    if (model.relations?.[k]) include[k] = v === true ? true : v
    else if (v) scalar[k] = v
  }
  return { scalar: Object.keys(scalar).length ? scalar : null, include: Object.keys(include).length ? include : null }
}

function applySelect(row, select) {
  if (!select) return row
  const out = {}
  for (const [k, v] of Object.entries(select)) {
    if (v) out[k] = row[k]
  }
  return out
}

async function loadIncludes(name, rows, include) {
  if (!include || !rows.length) return rows
  const model = MODELS[name]
  for (const row of rows) {
    for (const [relName, relArg] of Object.entries(include)) {
      if (!relArg) continue
      const rel = model.relations?.[relName]
      if (!rel) continue
      const child = MODELS[rel.model]
      const nestedInclude = typeof relArg === 'object' ? relArg.include : undefined
      const nestedSelect = typeof relArg === 'object' ? relArg.select : undefined
      const nestedWhere = typeof relArg === 'object' ? relArg.where : undefined
      const localVal = row[rel.from]
      if (rel.kind === 'one') {
        if (localVal == null) {
          row[relName] = null
          continue
        }
        const found = await delegate(rel.model).findFirst({
          where: { [rel.to]: localVal, ...(nestedWhere || {}) },
          include: nestedInclude,
          select: nestedSelect,
        })
        row[relName] = found
      } else {
        const found = await delegate(rel.model).findMany({
          where: { [rel.to]: localVal, ...(nestedWhere || {}) },
          include: nestedInclude,
          select: nestedSelect,
        })
        row[relName] = found
      }
    }
  }
  return rows
}

function orderSql(orderBy) {
  if (!orderBy) return ''
  const parts = Array.isArray(orderBy) ? orderBy : [orderBy]
  const bits = parts
    .map((o) => {
      const k = Object.keys(o)[0]
      const dir = String(o[k]).toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
      return `"${k}" ${dir}`
    })
    .filter(Boolean)
  return bits.length ? ` ORDER BY ${bits.join(', ')}` : ''
}

/**
 * Build `SET` fragments for an update payload, matching Prisma's operators.
 * `@updatedAt` columns are bumped only when the caller did not set them.
 */
function buildUpdateSets(model, data) {
  const patch = { ...(data || {}) }
  if (model.dates?.includes('updatedAt') && patch.updatedAt === undefined) {
    patch.updatedAt = now()
  }
  const sets = []
  const params = []
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) {
      if ('increment' in v) {
        sets.push(`"${k}" = "${k}" + ?`)
        params.push(Number(v.increment))
        continue
      }
      if ('decrement' in v) {
        sets.push(`"${k}" = "${k}" - ?`)
        params.push(Number(v.decrement))
        continue
      }
      if ('multiply' in v) {
        sets.push(`"${k}" = "${k}" * ?`)
        params.push(Number(v.multiply))
        continue
      }
      if ('set' in v) {
        sets.push(`"${k}" = ?`)
        params.push(encodeVal(model, k, v.set))
        continue
      }
    }
    sets.push(`"${k}" = ?`)
    params.push(encodeVal(model, k, v))
  }
  if (!sets.length) throw new Error('No update values supplied')
  return { sets, params }
}

/**
 * Transaction support.
 *
 * `better-sqlite3` is synchronous, so the async callback Prisma accepts cannot
 * be wrapped in a plain BEGIN/COMMIT: awaiting inside an open write transaction
 * lets other connections interleave and deadlocks the single writer.
 *
 * Instead the callback runs against a *staging* client that records every
 * write. On success the recorded operations are replayed inside one synchronous
 * `db.transaction(...)`, which is atomic. On throw the staging area is discarded
 * and nothing is committed. Reads inside the callback see the staged state for
 * records the callback itself created, which is what the call sites need
 * (create-then-read-the-id).
 */
function createStagingClient(operations) {
  const client = {}

  function record(method, args) {
    // Flattened so replay reads `operation.data`, `operation.where`, ...
    operations.push({ method, ...args })
  }

  for (const key of Object.keys(MODELS)) {
    const live = delegates[key]
    client[key] = {
      async create(args = {}) {
        // Materialise the whole tree now: the callback must be able to read the
        // ids of rows it just created, and replay must insert exactly these.
        const tree = materialiseTree(key, args.data || {})
        const snapshot = await live.findUnique({ where: { id: tree.row.id } })
        if (snapshot) throw new Error(`Duplicate id ${tree.row.id}`)
        record('create', { key, tree })
        return shapeOfTree(tree)
      },
      async createMany(args = {}) {
        const rows = Array.isArray(args.data) ? args.data : [args.data]
        const prepared = rows.map((row) => ({
          ...(MODELS[key].defaults ? MODELS[key].defaults() : {}),
          ...row,
        }))
        record('createMany', { key, prepared })
        return { count: prepared.length }
      },
      async update(args = {}) {
        const existing = await live.findFirst({ where: args.where })
        if (!existing) throw new Error('Record to update not found')
        const { scalar, nested } = splitNested(MODELS[key], args.data || {})
        // Materialise nested rows up front so replay commits the same ids.
        const trees = materialiseNestedFrom(MODELS[key], key, existing, nested)
        record('update', { key, where: args.where, data: scalar, trees })
        return { ...existing, ...structuredCloneSafe(scalar) }
      },
      async updateMany(args = {}) {
        record('updateMany', { key, where: args.where, data: args.data })
        return { count: 0 }
      },
      async delete(args = {}) {
        record('delete', { key, where: args.where })
        return null
      },
      async deleteMany(args = {}) {
        record('deleteMany', { key, where: args.where })
        return { count: 0 }
      },
      async upsert(args = {}) {
        record('upsert', { key, where: args.where, create: args.create, update: args.update })
        return { ...(MODELS[key].defaults ? MODELS[key].defaults() : {}), ...(args.create || {}) }
      },
      async findUnique(args = {}) {
        return live.findUnique(args)
      },
      async findFirst(args = {}) {
        return live.findFirst(args)
      },
      async findMany(args = {}) {
        return live.findMany(args)
      },
      async count(args = {}) {
        return live.count(args)
      },
    }
  }

  client.$queryRaw = taggedRaw
  return client
}

/** Structured clone that tolerates Date instances. */
function structuredCloneSafe(value) {
  const out = {}
  for (const [k, v] of Object.entries(value)) {
    out[k] = v instanceof Date ? new Date(v.getTime()) : v
  }
  return out
}

async function runTransaction(fn, options) {
  // Array form: `$transaction([p1, p2])` — already-executed promises, so the
  // work has happened; just resolve them in order.
  if (Array.isArray(fn)) {
    const results = []
    for (const op of fn) results.push(await op)
    return results
  }
  if (typeof fn !== 'function') {
    throw new Error('$transaction expects a callback or an array of operations')
  }

  const operations = []
  const staging = createStagingClient(operations)
  const result = await fn(staging)

  const db = getSqlite()
  const replay = db.transaction(() => {
    for (const operation of operations) {
      const model = MODELS[operation.key]
      const live = delegates[operation.key]
      if (operation.method === 'create') {
        // Replay the materialised tree so the committed rows are the ones the
        // callback already saw (same ids, same foreign keys).
        insertTree(db, operation.tree)
      } else if (operation.method === 'createMany') {
        for (const row of operation.prepared) insertRow(db, model, row)
      } else if (operation.method === 'update') {
        const w = cond(model, operation.where)
        if (operation.data && Object.keys(operation.data).length) {
          const { sets, params } = buildUpdateSets(model, operation.data)
          db.prepare(`UPDATE "${model.table}" SET ${sets.join(', ')} WHERE ${w.sql}`).run(...params, ...w.params)
        }
        for (const connect of operation.trees?.connects ?? []) {
          const childModel = MODELS[connect.key]
          const where = cond(childModel, connect.where)
          const found = db.prepare(`SELECT id FROM "${childModel.table}" WHERE ${where.sql} LIMIT 1`).get(...where.params)
          if (!found) throw new Error(`Nested connect found no ${connect.key}`)
          const set = buildUpdateSets(childModel, connect.fk)
          db.prepare(`UPDATE "${childModel.table}" SET ${set.sets.join(', ')} WHERE "id" = ?`).run(...set.params, found.id)
        }
        for (const children of Object.values(operation.trees?.children ?? {})) {
          for (const child of children) insertTree(db, child)
        }
      } else if (operation.method === 'updateMany') {
        const w = cond(model, operation.where)
        const { sets, params } = buildUpdateSets(model, operation.data)
        db.prepare(`UPDATE "${model.table}" SET ${sets.join(', ')} WHERE ${w.sql}`).run(...params, ...w.params)
      } else if (operation.method === 'delete') {
        const w = cond(model, operation.where)
        db.prepare(`DELETE FROM "${model.table}" WHERE ${w.sql}`).run(...w.params)
      } else if (operation.method === 'deleteMany') {
        const w = cond(model, operation.where)
        db.prepare(`DELETE FROM "${model.table}" WHERE ${w.sql}`).run(...w.params)
      } else if (operation.method === 'upsert') {
        const existing = db
          .prepare(`SELECT id FROM "${model.table}" WHERE ${cond(model, operation.where).sql} LIMIT 1`)
          .get(...cond(model, operation.where).params)
        if (existing) {
          const w = cond(model, operation.where)
          const { sets, params } = buildUpdateSets(model, operation.update)
          db.prepare(`UPDATE "${model.table}" SET ${sets.join(', ')} WHERE ${w.sql}`).run(...params, ...w.params)
        } else {
          const data = { ...(model.defaults ? model.defaults() : {}), ...(operation.create || {}) }
          insertRow(db, model, data)
        }
      }
      void live
    }
  })
  replay()

  // Return the durable rows so callers get real ids/timestamps.
  if (result && typeof result === 'object') {
    const resolved = {}
    for (const [name, value] of Object.entries(result)) {
      if (value && typeof value === 'object' && typeof value.id === 'string') {
        // The staging shape carries its model key, so this is a direct lookup
        // instead of a search across all 52 tables.
        const modelName = value.__tree?.key
        resolved[name] = modelName && delegates[modelName]
          ? await delegates[modelName].findUnique({ where: { id: value.id } })
          : value
      } else {
        resolved[name] = value
      }
    }
    return resolved
  }
  return result
}

function insertRow(db, model, data) {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined)
  if (!keys.length) throw new Error(`Refusing to insert an empty row into ${model.table}`)
  const vals = keys.map((k) => encodeVal(model, k, data[k]))
  const sql = `INSERT INTO "${model.table}" (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`
  db.prepare(sql).run(...vals)
}

/**
 * Nested writes.
 *
 * Prisma lets one `create`/`update` write related rows:
 *
 *   db.conversation.create({ data: { type: 'group', members: { create: [...] } } })
 *   db.post.create({ data: { title, comments: { create: { body } } } })
 *
 * The runtime used to pass those relation keys straight into the INSERT, so the
 * statement named a column that does not exist ("table Conversation has no
 * column named members") and every call site relying on nested writes returned
 * 500 on the built-in backend. `POST /api/conversations` — how every
 * conversation and group chat is created — was one of them.
 *
 * Supported operations (the ones the app uses):
 *   - to-many:  `{ create: rowOrRows }`, `{ connect: whereOrArray }`,
 *               `{ createMany: { data } }`
 *   - to-one:   `{ create: row }`, `{ connect: where }`
 *   - updates:  the same shapes under `update: { ... }`
 *
 * The linking column comes from the generated relation metadata, so a relation
 * added to the schema works without touching this code. Anything else throws
 * loudly rather than silently dropping a write.
 *
 * A tree is materialised (ids, foreign keys and defaults filled in) *before* the
 * insert. That is what lets a `$transaction` callback read the ids of the rows it
 * just created and have replay commit exactly those rows instead of minting new
 * ones.
 */

const NESTED_OPS = ['create', 'createMany', 'connect']

/** Split relation-valued keys (nested writes) from scalar columns. */
function splitNested(model, data) {
  const relations = model.relations || {}
  const scalar = {}
  const nested = []
  for (const [field, value] of Object.entries(data || {})) {
    if (relations[field] && value && typeof value === 'object' && !(value instanceof Date)) {
      nested.push([field, relations[field], value])
    } else {
      scalar[field] = value
    }
  }
  return { scalar, nested }
}

/** Reject nested operations this runtime cannot honour, instead of ignoring them. */
function assertNestedSpec(owner, field, spec) {
  const keys = Object.keys(spec || {}).filter((key) => spec[key] !== undefined)
  const unsupported = keys.filter((key) => !NESTED_OPS.includes(key))
  if (unsupported.length) {
    throw new Error(
      `Unsupported nested write ${owner}.${field}: ${unsupported.join(', ')} (supported: ${NESTED_OPS.join(', ')})`,
    )
  }
  if (!keys.length) throw new Error(`Nested write ${owner}.${field} is empty`)
}

/** Rows requested by a `create`/`createMany` operation. */
function rowsToCreate(spec) {
  const payload = spec.create !== undefined ? spec.create : spec.createMany?.data
  if (payload === undefined) return []
  return Array.isArray(payload) ? payload : [payload]
}

/**
 * Materialise the nested writes attached to one parent row.
 *
 * `parentId` is explicit so this serves both `create` (parent is new) and
 * `update` (parent already exists and keeps its id).
 */
function materialiseNested(key, parentId, nested) {
  const children = {}
  const connects = []
  for (const [field, relation, spec] of nested) {
    assertNestedSpec(key, field, spec)
    const childModel = MODELS[relation.model]
    if (!childModel) throw new Error(`Unknown related model ${relation.model}`)
    if (parentId === undefined || parentId === null) {
      throw new Error(`Cannot nest ${key}.${field}: ${relation.from} is unset`)
    }

    const created = rowsToCreate(spec).map((childData) => {
      const childPayload = { ...(childData || {}) }
      // Only fill the foreign key when the caller left it out, so an explicit
      // value is never silently overwritten.
      if (childPayload[relation.to] === undefined) childPayload[relation.to] = parentId
      return materialiseTree(relation.model, childPayload)
    })

    if (relation.kind === 'one' && created.length > 1) {
      throw new Error(`to-one relation ${key}.${field} accepts a single row`)
    }

    if (spec.connect !== undefined) {
      for (const target of Array.isArray(spec.connect) ? spec.connect : [spec.connect]) {
        connects.push({
          field,
          key: relation.model,
          where: expandWhere(childModel, target),
          fk: { [relation.to]: parentId },
        })
      }
    }

    if (created.length) children[field] = created
  }
  return { children, connects }
}

/** Materialise nested writes against a row that already exists. */
function materialiseNestedFrom(model, key, row, nested) {
  if (!nested.length) return { children: {}, connects: [] }
  return materialiseNested(key, row[nested[0][1].from], nested)
}

/**
 * Turn `data` into a fully materialised tree.
 *
 * `tree.row`       the row itself, every scalar and default filled in
 * `tree.children`  `{ field: tree[] }` for owned child rows
 * `tree.connects`  `[{ field, key, where, fk }]` existing rows to link
 */
function materialiseTree(key, data) {
  const model = MODELS[key]
  if (!model) throw new Error(`Unknown model ${key}`)
  const { scalar, nested } = splitNested(model, data)
  const row = { ...(model.defaults ? model.defaults() : {}), ...scalar }
  if (model.dates?.includes('updatedAt')) row.updatedAt = now()
  return { key, row, ...materialiseNestedFrom(model, key, row, nested) }
}

/** Insert a materialised tree inside an already-open transaction. */
function insertTree(db, tree) {
  // `row` is null when the tree only carries nested writes for an existing
  // parent (the update case).
  if (tree.row) insertRow(db, MODELS[tree.key], tree.row)
  for (const connect of tree.connects) {
    const childModel = MODELS[connect.key]
    const where = cond(childModel, connect.where)
    const found = db.prepare(`SELECT id FROM "${childModel.table}" WHERE ${where.sql} LIMIT 1`).get(...where.params)
    if (!found) throw new Error(`Nested connect found no ${connect.key}`)
    const set = buildUpdateSets(childModel, connect.fk)
    db.prepare(`UPDATE "${childModel.table}" SET ${set.sets.join(', ')} WHERE "id" = ?`).run(...set.params, found.id)
  }
  for (const children of Object.values(tree.children)) {
    for (const child of children) insertTree(db, child)
  }
}

/** The Prisma-shaped result of a materialised tree. */
function shapeOfTree(tree) {
  const shape = structuredCloneSafe(tree.row)
  // Non-enumerable: JSON responses must never leak the internal tree.
  Object.defineProperty(shape, '__tree', { value: tree, enumerable: false })
  for (const [field, relation] of Object.entries(MODELS[tree.key].relations || {})) {
    if (relation.kind === 'many' && shape[field] === undefined) shape[field] = []
  }
  for (const [field, children] of Object.entries(tree.children)) {
    const kind = MODELS[tree.key].relations[field].kind
    shape[field] = kind === 'many' ? children.map(shapeOfTree) : shapeOfTree(children[0])
  }
  return shape
}

function delegate(name) {
  const model = MODELS[name]
  if (!model) throw new Error(`Unknown model ${name}`)

  const runFind = (args = {}, many) => {
    const db = getSqlite()
    const w = cond(model, args.where)
    let sql = `SELECT * FROM "${model.table}" WHERE ${w.sql}${orderSql(args.orderBy)}`
    if (!many) sql += ' LIMIT 1'
    else {
      if (args.take) sql += ` LIMIT ${Number(args.take)}`
      if (args.skip) sql += ` OFFSET ${Number(args.skip)}`
    }
    const stmt = db.prepare(sql)
    const raw = many ? stmt.all(...w.params) : stmt.get(...w.params)
    const rows = (many ? raw : raw ? [raw] : []).map((r) => parseRow(model, { ...r }))
    return { rows, many }
  }

  return {
    async findUnique(args = {}) {
      const split = splitSelect(model, args.select)
      const include = { ...(split.include || {}), ...(args.include || {}) }
      const { rows } = runFind(args, false)
      await loadIncludes(name, rows, include)
      const row = rows[0] || null
      if (!row) return null
      if (split.scalar) {
        const out = applySelect(row, split.scalar)
        for (const k of Object.keys(include)) out[k] = row[k]
        return out
      }
      return row
    },
    async findFirst(args = {}) {
      const split = splitSelect(model, args.select)
      const include = { ...(split.include || {}), ...(args.include || {}) }
      const { rows } = runFind(args, false)
      await loadIncludes(name, rows, include)
      const row = rows[0] || null
      if (!row) return null
      if (split.scalar) {
        const out = applySelect(row, split.scalar)
        for (const k of Object.keys(include)) out[k] = row[k]
        return out
      }
      return row
    },
    async findMany(args = {}) {
      const split = splitSelect(model, args.select)
      const include = { ...(split.include || {}), ...(args.include || {}) }
      const { rows } = runFind(args, true)
      await loadIncludes(name, rows, include)
      if (split.scalar) {
        return rows.map((r) => {
          const out = applySelect(r, split.scalar)
          for (const k of Object.keys(include)) out[k] = r[k]
          return out
        })
      }
      return rows
    },
    async count(args = {}) {
      const db = getSqlite()
      const w = cond(model, args.where)
      const row = db.prepare(`SELECT COUNT(*) AS c FROM "${model.table}" WHERE ${w.sql}`).get(...w.params)
      return Number(row?.c || 0)
    },
    /**
     * Prisma's `groupBy`. Used by poll results
     * (`groupBy({ by: ['optionIdx'], _count: true })`).
     */
    async groupBy(args = {}) {
      const db = getSqlite()
      const by = Array.isArray(args.by) ? args.by : [args.by].filter(Boolean)
      if (!by.length) throw new Error('groupBy requires `by`')
      const w = cond(model, args.where)
      const select = by.map((col) => `"${col}"`).join(', ')
      const aggregates = []
      if (args._count) {
        if (args._count === true) aggregates.push('COUNT(*) AS "_count"')
        else
          for (const col of Object.keys(args._count)) {
            aggregates.push(`COUNT("${col}") AS "_count_${col}"`)
          }
      }
      for (const agg of ['_sum', '_avg', '_min', '_max']) {
        if (!args[agg]) continue
        for (const col of Object.keys(args[agg])) {
          const fn = agg.slice(1).toUpperCase()
          aggregates.push(`${fn}("${col}") AS "${agg}_${col}"`)
        }
      }
      const sql =
        `SELECT ${select}${aggregates.length ? ', ' + aggregates.join(', ') : ''} ` +
        `FROM "${model.table}" WHERE ${w.sql} GROUP BY ${select}${orderSql(args.orderBy)}`
      const rows = db.prepare(sql).all(...w.params)

      return rows.map((row) => {
        const out = {}
        for (const col of by) out[col] = row[col]
        if (args._count) {
          if (args._count === true) out._count = Number(row._count || 0)
          else {
            out._count = {}
            for (const col of Object.keys(args._count)) {
              out._count[col] = Number(row[`_count_${col}`] || 0)
            }
          }
        }
        for (const agg of ['_sum', '_avg', '_min', '_max']) {
          if (!args[agg]) continue
          out[agg] = {}
          for (const col of Object.keys(args[agg])) out[agg][col] = row[`${agg}_${col}`]
        }
        return out
      })
    },

    /** Prisma's `aggregate` — the scalar summary without grouping. */
    async aggregate(args = {}) {
      const db = getSqlite()
      const w = cond(model, args.where)
      const parts = []
      if (args._count) parts.push('COUNT(*) AS "_count"')
      for (const agg of ['_sum', '_avg', '_min', '_max']) {
        if (!args[agg]) continue
        for (const col of Object.keys(args[agg])) {
          parts.push(`${agg.slice(1).toUpperCase()}("${col}") AS "${agg}_${col}"`)
        }
      }
      if (!parts.length) parts.push('COUNT(*) AS "_count"')
      const row = db.prepare(`SELECT ${parts.join(', ')} FROM "${model.table}" WHERE ${w.sql}`).get(...w.params) || {}
      const out = {}
      if (args._count) out._count = Number(row._count || 0)
      for (const agg of ['_sum', '_avg', '_min', '_max']) {
        if (!args[agg]) continue
        out[agg] = {}
        for (const col of Object.keys(args[agg])) out[agg][col] = row[`${agg}_${col}`]
      }
      return out
    },

    /** Prisma's `findMany` + `distinct`. */
    async findFirstOrThrow(args = {}) {
      const found = await this.findFirst(args)
      if (!found) throw new Error(`No ${model.model} found`)
      return found
    },
    async findUniqueOrThrow(args = {}) {
      const found = await this.findUnique(args)
      if (!found) throw new Error(`No ${model.model} found`)
      return found
    },
    async create(args = {}) {
      const db = getSqlite()
      const tree = materialiseTree(name, args.data || {})
      // The whole tree commits or nothing does, so a group can never be created
      // without the members the same call promised.
      db.transaction(() => insertTree(db, tree))()
      const parent = await this.findUnique({ where: { id: tree.row.id }, include: args.include, select: args.select })
      if (!parent) return parent
      for (const [field, children] of Object.entries(tree.children)) {
        if (parent[field] === undefined && (!args.select || args.select[field])) {
          parent[field] = model.relations[field].kind === 'many'
            ? children.map((child) => child.row)
            : children[0].row
        }
      }
      return parent
    },
    async update(args = {}) {
      const db = getSqlite()
      const existing = await this.findFirst({ where: args.where })
      if (!existing) throw new Error('Record to update not found')
      const { scalar, nested } = splitNested(model, args.data || {})
      const w = cond(model, args.where)
      // Anchor nested writes on the existing row's key, which is what Prisma
      // does for `update({ data: { <relation>: { create } } })`.
      const trees = materialiseNestedFrom(model, name, existing, nested)

      db.transaction(() => {
        if (Object.keys(scalar).length) {
          const { sets, params } = buildUpdateSets(model, scalar)
          db.prepare(`UPDATE "${model.table}" SET ${sets.join(', ')} WHERE ${w.sql}`).run(...params, ...w.params)
        }
        insertTree(db, { key: name, row: null, connects: trees.connects, children: trees.children })
      })()
      const reloadWhere = existing.id !== undefined ? { id: existing.id } : args.where
      return this.findFirst({ where: reloadWhere, include: args.include, select: args.select })
    },
    async updateMany(args = {}) {
      const db = getSqlite()
      const w = cond(model, args.where)
      const { sets, params } = buildUpdateSets(model, args.data)
      const res = db.prepare(`UPDATE "${model.table}" SET ${sets.join(', ')} WHERE ${w.sql}`).run(...params, ...w.params)
      return { count: res.changes }
    },
    async delete(args = {}) {
      const existing = await this.findFirst({ where: args.where, include: args.include, select: args.select })
      const db = getSqlite()
      const w = cond(model, args.where)
      db.prepare(`DELETE FROM "${model.table}" WHERE ${w.sql}`).run(...w.params)
      return existing
    },
    async deleteMany(args = {}) {
      const db = getSqlite()
      const w = cond(model, args.where)
      const res = db.prepare(`DELETE FROM "${model.table}" WHERE ${w.sql}`).run(...w.params)
      return { count: res.changes }
    },
    async upsert(args = {}) {
      const existing = await this.findFirst({ where: args.where })
      if (existing) return this.update({ where: args.where, data: args.update, include: args.include, select: args.select })
      return this.create({ data: { ...args.create }, include: args.include, select: args.select })
    },
  }
}

function taggedRaw(strings, ...values) {
  const db = getSqlite()
  const sql = strings.join('?')
  try {
    const stmt = db.prepare(sql)
    if (/^\s*select/i.test(sql)) return stmt.all(...values)
    stmt.run(...values)
    return { ok: true }
  } catch (e) {
    throw e
  }
}

/**
 * Delegate registry, derived from the generated model metadata so a model added
 * to the schema can never again be missing from the runtime (which is how
 * Attachment, FileAccess and the eleven Jara tables ended up as `undefined`).
 */
const delegates = {}
for (const key of Object.keys(MODELS)) {
  delegates[key] = delegate(key)
}

const sqlitePrisma = {
  ...delegates,
  $queryRaw: taggedRaw,
  $executeRaw: taggedRaw,
  $transaction: runTransaction,
  $disconnect: async () => {},
}

/* ------------------------------------------------------------------------- *
 * MySQL / MariaDB: real Prisma Client (Rust-free "client" engine + driver adapter).
 * Needs `npx prisma generate` (schema.prisma, provider mysql) and
 * `npx prisma migrate deploy` once on the server. No engine binaries at runtime.
 *
 * DB_ENGINE=prisma with a file: URL runs the same Prisma path on SQLite
 * (needs @prisma/adapter-better-sqlite3 + a client generated from
 * schema.sqlite.prisma) — used to test the Prisma path without a MySQL server.
 * ------------------------------------------------------------------------- */

function isMysqlUrl(url) {
  return /^(mysql|mariadb):\/\//i.test(url || '')
}

function wantsPrisma() {
  return isMysqlUrl(process.env.DATABASE_URL) || process.env.DB_ENGINE === 'prisma'
}

function mysqlConfigFromUrl(url) {
  const u = new URL(url)
  const q = u.searchParams
  return {
    host: u.hostname || '127.0.0.1',
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
    connectionLimit: Number(q.get('connection_limit') || process.env.DB_POOL_SIZE || 10),
    connectTimeout: Number(q.get('connect_timeout') || 10) * 1000,
    // MySQL 8 default auth (caching_sha2_password) over plain TCP needs the server key.
    allowPublicKeyRetrieval: true,
    // Return DATETIME as JS Date in UTC, like Prisma's own engine.
    timezone: 'Z',
  }
}

function createPrismaClient() {
  const url = process.env.DATABASE_URL || ''
  let PrismaClient
  try {
    ;({ PrismaClient } = require('@prisma/client'))
  } catch (e) {
    throw new Error('Prisma Client is not generated. Run `npx prisma generate` (see docs/DEPLOY_LEARN_ALOEDUCATION.md). ' + e.message)
  }
  let adapter
  if (isMysqlUrl(url)) {
    const { PrismaMariaDb } = require('@prisma/adapter-mariadb')
    adapter = new PrismaMariaDb(mysqlConfigFromUrl(url))
  } else {
    getSqlite() // make sure the SQLite file + tables exist
    const { PrismaBetterSQLite3 } = require('@prisma/adapter-better-sqlite3')
    adapter = new PrismaBetterSQLite3({ url: 'file:' + resolveDbPath() })
  }
  const log = process.env.PRISMA_LOG ? process.env.PRISMA_LOG.split(',') : ['warn', 'error']
  return new PrismaClient({ adapter, log })
}

function getPrismaClient() {
  // One client per process (survives Next.js dev hot reloads).
  const g = globalThis
  if (!g.__fcPrisma) g.__fcPrisma = createPrismaClient()
  return g.__fcPrisma
}

// Lazy: the client is only created on first use, so `next build` and tooling
// can import this module without a database or a generated client.
const prisma = wantsPrisma()
  ? new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') return undefined
          const client = getPrismaClient()
          const v = client[prop]
          return typeof v === 'function' ? v.bind(client) : v
        },
      }
    )
  : sqlitePrisma

module.exports = { prisma, db: prisma, default: prisma, getSqlite, appRoot, wantsPrisma, mysqlConfigFromUrl }
