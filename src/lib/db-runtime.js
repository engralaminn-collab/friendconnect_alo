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

const MODELS = {
  user: {
    table: 'User',
    dates: ['createdAt', 'updatedAt', 'otpExpiry'],
    bools: ['emailVerified', 'twoFactorEnabled'],
    defaults: () => ({
      id: cuid(),
      createdAt: now(),
      updatedAt: now(),
      emailVerified: false,
      twoFactorEnabled: false,
      role: 'user',
      fileQuotaBytes: 104857600,
      fileUsedBytes: 0,
    }),
    relations: {
      profile: { kind: 'one', model: 'profile', from: 'id', to: 'userId' },
      sessions: { kind: 'many', model: 'session', from: 'id', to: 'userId' },
    },
  },
  profile: {
    table: 'Profile',
    dates: ['lastSeen', 'updatedAt'],
    bools: ['readReceipts'],
    defaults: () => ({
      id: cuid(),
      profileVisibility: 'PUBLIC',
      messagePermission: 'FRIENDS',
      callPermission: 'FRIENDS',
      readReceipts: true,
      verified: 'unverified',
      lastSeen: now(),
      updatedAt: now(),
    }),
    relations: {
      user: { kind: 'one', model: 'user', from: 'userId', to: 'id' },
    },
  },
  session: {
    table: 'Session',
    dates: ['expiresAt', 'createdAt', 'lastActiveAt'],
    defaults: () => ({ id: cuid(), createdAt: now(), lastActiveAt: now() }),
    relations: {
      user: { kind: 'one', model: 'user', from: 'userId', to: 'id' },
    },
  },
  friendship: {
    table: 'Friendship',
    dates: ['createdAt', 'updatedAt'],
    bools: ['isCloseFriend', 'storiesMuted'],
    uniques: { requesterId_receiverId: ['requesterId', 'receiverId'] },
    defaults: () => ({
      id: cuid(),
      status: 'PENDING',
      isCloseFriend: false,
      storiesMuted: false,
      createdAt: now(),
      updatedAt: now(),
    }),
    relations: {
      requester: { kind: 'one', model: 'user', from: 'requesterId', to: 'id' },
      receiver: { kind: 'one', model: 'user', from: 'receiverId', to: 'id' },
    },
  },
  message: {
    table: 'Message',
    dates: ['createdAt', 'seenAt', 'expiresAt', 'editedAt', 'scheduledFor'],
    bools: ['edited'],
    defaults: () => ({
      id: cuid(),
      type: 'text',
      status: 'SENT',
      createdAt: now(),
      deletedFor: '',
      edited: false,
    }),
    relations: {
      sender: { kind: 'one', model: 'user', from: 'senderId', to: 'id' },
      receiver: { kind: 'one', model: 'user', from: 'receiverId', to: 'id' },
      group: { kind: 'one', model: 'group', from: 'groupId', to: 'id' },
      reactions: { kind: 'many', model: 'messageReaction', from: 'id', to: 'messageId' },
      starredBy: { kind: 'many', model: 'messageStar', from: 'id', to: 'messageId' },
      reminders: { kind: 'many', model: 'messageReminder', from: 'id', to: 'messageId' },
    },
  },
  group: {
    table: 'Group',
    dates: ['createdAt', 'updatedAt'],
    defaults: () => ({ id: cuid(), createdAt: now(), updatedAt: now() }),
    relations: {
      owner: { kind: 'one', model: 'user', from: 'createdBy', to: 'id' },
      members: { kind: 'many', model: 'groupMember', from: 'id', to: 'groupId' },
      messages: { kind: 'many', model: 'message', from: 'id', to: 'groupId' },
    },
  },
  groupMember: {
    table: 'GroupMember',
    dates: ['joinedAt'],
    uniques: { groupId_userId: ['groupId', 'userId'] },
    defaults: () => ({ id: cuid(), role: 'MEMBER', joinedAt: now() }),
    relations: {
      group: { kind: 'one', model: 'group', from: 'groupId', to: 'id' },
      user: { kind: 'one', model: 'user', from: 'userId', to: 'id' },
    },
  },
  call: {
    table: 'Call',
    dates: ['startedAt', 'endedAt', 'answeredAt'],
    defaults: () => ({ id: cuid(), type: 'audio', status: 'ringing', startedAt: now() }),
    relations: {
      caller: { kind: 'one', model: 'user', from: 'callerId', to: 'id' },
      receiver: { kind: 'one', model: 'user', from: 'receiverId', to: 'id' },
    },
  },
  notification: {
    table: 'Notification',
    dates: ['createdAt'],
    bools: ['read'],
    defaults: () => ({ id: cuid(), read: false, createdAt: now() }),
    relations: {
      user: { kind: 'one', model: 'user', from: 'userId', to: 'id' },
    },
  },
  file: {
    table: 'File',
    dates: ['createdAt'],
    defaults: () => ({ id: cuid(), createdAt: now() }),
    relations: {
      owner: { kind: 'one', model: 'user', from: 'ownerId', to: 'id' },
    },
  },
  messageReaction: {
    table: 'MessageReaction',
    dates: ['createdAt'],
    uniques: { messageId_userId_emoji: ['messageId', 'userId', 'emoji'] },
    defaults: () => ({ id: cuid(), createdAt: now() }),
    relations: {
      message: { kind: 'one', model: 'message', from: 'messageId', to: 'id' },
      user: { kind: 'one', model: 'user', from: 'userId', to: 'id' },
    },
  },
  chatPreference: {
    table: 'ChatPreference',
    dates: ['updatedAt'],
    bools: ['pinned', 'muted', 'archived'],
    uniques: { userId_peerId: ['userId', 'peerId'] },
    defaults: () => ({
      id: cuid(),
      pinned: false,
      muted: false,
      disappearing: 'OFF',
      archived: false,
      updatedAt: now(),
    }),
    relations: {
      user: { kind: 'one', model: 'user', from: 'userId', to: 'id' },
    },
  },
  story: {
    table: 'Story',
    dates: ['createdAt', 'expiresAt'],
    bools: ['isHighlight'],
    defaults: () => ({ id: cuid(), type: 'text', createdAt: now(), isHighlight: false }),
    relations: {
      user: { kind: 'one', model: 'user', from: 'userId', to: 'id' },
      views: { kind: 'many', model: 'storyView', from: 'id', to: 'storyId' },
      replies: { kind: 'many', model: 'storyReply', from: 'id', to: 'storyId' },
      reactions: { kind: 'many', model: 'storyReaction', from: 'id', to: 'storyId' },
    },
  },
  storyView: {
    table: 'StoryView',
    dates: ['viewedAt'],
    uniques: { storyId_userId: ['storyId', 'userId'] },
    defaults: () => ({ id: cuid(), viewedAt: now() }),
    relations: {
      story: { kind: 'one', model: 'story', from: 'storyId', to: 'id' },
      user: { kind: 'one', model: 'user', from: 'userId', to: 'id' },
    },
  },
  messageStar: {
    table: 'MessageStar',
    dates: ['createdAt'],
    uniques: { messageId_userId: ['messageId', 'userId'] },
    defaults: () => ({ id: cuid(), createdAt: now() }),
    relations: {
      message: { kind: 'one', model: 'message', from: 'messageId', to: 'id' },
      user: { kind: 'one', model: 'user', from: 'userId', to: 'id' },
    },
  },
  storyReply: {
    table: 'StoryReply',
    dates: ['createdAt'],
    defaults: () => ({ id: cuid(), createdAt: now() }),
    relations: {
      story: { kind: 'one', model: 'story', from: 'storyId', to: 'id' },
      user: { kind: 'one', model: 'user', from: 'userId', to: 'id' },
    },
  },
  messageDraft: {
    table: 'MessageDraft',
    dates: ['updatedAt'],
    bools: ['isGroup'],
    uniques: { userId_peerId_isGroup: ['userId', 'peerId', 'isGroup'] },
    defaults: () => ({ id: cuid(), isGroup: false, updatedAt: now() }),
    relations: {
      user: { kind: 'one', model: 'user', from: 'userId', to: 'id' },
    },
  },
  storyReaction: {
    table: 'StoryReaction',
    dates: ['createdAt'],
    uniques: { storyId_userId: ['storyId', 'userId'] },
    defaults: () => ({ id: cuid(), createdAt: now() }),
    relations: {
      story: { kind: 'one', model: 'story', from: 'storyId', to: 'id' },
      user: { kind: 'one', model: 'user', from: 'userId', to: 'id' },
    },
  },
  broadcastList: {
    table: 'BroadcastList',
    dates: ['createdAt', 'updatedAt'],
    defaults: () => ({ id: cuid(), createdAt: now(), updatedAt: now() }),
    relations: {
      owner: { kind: 'one', model: 'user', from: 'ownerId', to: 'id' },
      members: { kind: 'many', model: 'broadcastMember', from: 'id', to: 'broadcastId' },
    },
  },
  broadcastMember: {
    table: 'BroadcastMember',
    dates: ['createdAt'],
    uniques: { broadcastId_recipientId: ['broadcastId', 'recipientId'] },
    defaults: () => ({ id: cuid(), createdAt: now() }),
    relations: {
      broadcast: { kind: 'one', model: 'broadcastList', from: 'broadcastId', to: 'id' },
      recipient: { kind: 'one', model: 'user', from: 'recipientId', to: 'id' },
    },
  },
  messageReminder: {
    table: 'MessageReminder',
    dates: ['remindAt', 'createdAt'],
    bools: ['notified'],
    defaults: () => ({ id: cuid(), createdAt: now(), notified: false }),
    relations: {
      user: { kind: 'one', model: 'user', from: 'userId', to: 'id' },
      message: { kind: 'one', model: 'message', from: 'messageId', to: 'id' },
    },
  },
  auditLog: {
    table: 'AuditLog',
    dates: ['createdAt'],
    defaults: () => ({ id: cuid(), createdAt: now() }),
    relations: {
      user: { kind: 'one', model: 'user', from: 'userId', to: 'id' },
    },
  },
  pushSubscription: {
    table: 'PushSubscription',
    dates: ['createdAt', 'updatedAt'],
    defaults: () => ({ id: cuid(), createdAt: now(), updatedAt: now() }),
    relations: {
      user: { kind: 'one', model: 'user', from: 'userId', to: 'id' },
    },
  },
}

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS "User" (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, phone TEXT UNIQUE, username TEXT UNIQUE NOT NULL,
  passwordHash TEXT NOT NULL, name TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
  emailVerified INTEGER NOT NULL DEFAULT 0, twoFactorSecret TEXT, twoFactorEnabled INTEGER NOT NULL DEFAULT 0,
  twoFactorBackup TEXT, role TEXT NOT NULL DEFAULT 'user', fileQuotaBytes INTEGER NOT NULL DEFAULT 104857600,
  fileUsedBytes INTEGER NOT NULL DEFAULT 0, otpCode TEXT, otpExpiry TEXT
);
CREATE TABLE IF NOT EXISTS "Profile" (
  id TEXT PRIMARY KEY, userId TEXT UNIQUE NOT NULL, photoUrl TEXT, bio TEXT, phone TEXT, location TEXT,
  birthday TEXT, education TEXT, work TEXT, profileVisibility TEXT NOT NULL DEFAULT 'PUBLIC',
  messagePermission TEXT NOT NULL DEFAULT 'FRIENDS', callPermission TEXT NOT NULL DEFAULT 'FRIENDS',
  readReceipts INTEGER NOT NULL DEFAULT 1, photoFilter TEXT, verified TEXT NOT NULL DEFAULT 'unverified',
  lastSeen TEXT NOT NULL, updatedAt TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES "User"(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS "Session" (
  id TEXT PRIMARY KEY, userId TEXT NOT NULL, token TEXT UNIQUE NOT NULL, expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL, userAgent TEXT, deviceName TEXT, ipAddress TEXT, lastActiveAt TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES "User"(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS "Friendship" (
  id TEXT PRIMARY KEY, requesterId TEXT NOT NULL, receiverId TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING',
  blockerId TEXT, isCloseFriend INTEGER NOT NULL DEFAULT 0, storiesMuted INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
  UNIQUE (requesterId, receiverId),
  FOREIGN KEY (requesterId) REFERENCES "User"(id) ON DELETE CASCADE,
  FOREIGN KEY (receiverId) REFERENCES "User"(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS "Group" (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, photoUrl TEXT, createdBy TEXT NOT NULL,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
  FOREIGN KEY (createdBy) REFERENCES "User"(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS "GroupMember" (
  id TEXT PRIMARY KEY, groupId TEXT NOT NULL, userId TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'MEMBER',
  joinedAt TEXT NOT NULL, UNIQUE (groupId, userId),
  FOREIGN KEY (groupId) REFERENCES "Group"(id) ON DELETE CASCADE,
  FOREIGN KEY (userId) REFERENCES "User"(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS "Message" (
  id TEXT PRIMARY KEY, senderId TEXT NOT NULL, receiverId TEXT, groupId TEXT, content TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text', fileUrl TEXT, fileName TEXT, fileSize INTEGER, mimeType TEXT,
  status TEXT NOT NULL DEFAULT 'SENT', createdAt TEXT NOT NULL, seenAt TEXT, deletedFor TEXT NOT NULL DEFAULT '',
  forwardedFrom TEXT, expiresAt TEXT, editedAt TEXT, edited INTEGER NOT NULL DEFAULT 0, pinnedBy TEXT,
  replyToId TEXT, scheduledFor TEXT,
  FOREIGN KEY (senderId) REFERENCES "User"(id) ON DELETE CASCADE,
  FOREIGN KEY (receiverId) REFERENCES "User"(id) ON DELETE CASCADE,
  FOREIGN KEY (groupId) REFERENCES "Group"(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS "Call" (
  id TEXT PRIMARY KEY, callerId TEXT NOT NULL, receiverId TEXT, groupId TEXT, type TEXT NOT NULL DEFAULT 'audio',
  status TEXT NOT NULL DEFAULT 'ringing', startedAt TEXT NOT NULL, endedAt TEXT, duration INTEGER,
  answeredAt TEXT, failureReason TEXT, connectionType TEXT,
  FOREIGN KEY (callerId) REFERENCES "User"(id) ON DELETE CASCADE,
  FOREIGN KEY (receiverId) REFERENCES "User"(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS "Notification" (
  id TEXT PRIMARY KEY, userId TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  data TEXT, read INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES "User"(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS "File" (
  id TEXT PRIMARY KEY, ownerId TEXT NOT NULL, name TEXT NOT NULL, mimeType TEXT NOT NULL, size INTEGER NOT NULL,
  url TEXT NOT NULL, createdAt TEXT NOT NULL,
  FOREIGN KEY (ownerId) REFERENCES "User"(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS "MessageReaction" (
  id TEXT PRIMARY KEY, messageId TEXT NOT NULL, userId TEXT NOT NULL, emoji TEXT NOT NULL, createdAt TEXT NOT NULL,
  UNIQUE (messageId, userId, emoji),
  FOREIGN KEY (messageId) REFERENCES "Message"(id) ON DELETE CASCADE,
  FOREIGN KEY (userId) REFERENCES "User"(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS "ChatPreference" (
  id TEXT PRIMARY KEY, userId TEXT NOT NULL, peerId TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0,
  muted INTEGER NOT NULL DEFAULT 0, disappearing TEXT NOT NULL DEFAULT 'OFF', wallpaper TEXT,
  archived INTEGER NOT NULL DEFAULT 0, folder TEXT, updatedAt TEXT NOT NULL,
  UNIQUE (userId, peerId),
  FOREIGN KEY (userId) REFERENCES "User"(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS "Story" (
  id TEXT PRIMARY KEY, userId TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'text', content TEXT NOT NULL,
  bg TEXT, createdAt TEXT NOT NULL, expiresAt TEXT NOT NULL, isHighlight INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (userId) REFERENCES "User"(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS "StoryView" (
  id TEXT PRIMARY KEY, storyId TEXT NOT NULL, userId TEXT NOT NULL, viewedAt TEXT NOT NULL,
  UNIQUE (storyId, userId),
  FOREIGN KEY (storyId) REFERENCES "Story"(id) ON DELETE CASCADE,
  FOREIGN KEY (userId) REFERENCES "User"(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS "MessageStar" (
  id TEXT PRIMARY KEY, messageId TEXT NOT NULL, userId TEXT NOT NULL, createdAt TEXT NOT NULL,
  UNIQUE (messageId, userId),
  FOREIGN KEY (messageId) REFERENCES "Message"(id) ON DELETE CASCADE,
  FOREIGN KEY (userId) REFERENCES "User"(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS "StoryReply" (
  id TEXT PRIMARY KEY, storyId TEXT NOT NULL, userId TEXT NOT NULL, content TEXT NOT NULL, createdAt TEXT NOT NULL,
  FOREIGN KEY (storyId) REFERENCES "Story"(id) ON DELETE CASCADE,
  FOREIGN KEY (userId) REFERENCES "User"(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS "MessageDraft" (
  id TEXT PRIMARY KEY, userId TEXT NOT NULL, peerId TEXT NOT NULL, isGroup INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL, updatedAt TEXT NOT NULL, UNIQUE (userId, peerId, isGroup),
  FOREIGN KEY (userId) REFERENCES "User"(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS "StoryReaction" (
  id TEXT PRIMARY KEY, storyId TEXT NOT NULL, userId TEXT NOT NULL, emoji TEXT NOT NULL, createdAt TEXT NOT NULL,
  UNIQUE (storyId, userId),
  FOREIGN KEY (storyId) REFERENCES "Story"(id) ON DELETE CASCADE,
  FOREIGN KEY (userId) REFERENCES "User"(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS "BroadcastList" (
  id TEXT PRIMARY KEY, ownerId TEXT NOT NULL, name TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
  FOREIGN KEY (ownerId) REFERENCES "User"(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS "BroadcastMember" (
  id TEXT PRIMARY KEY, broadcastId TEXT NOT NULL, recipientId TEXT NOT NULL, createdAt TEXT NOT NULL,
  UNIQUE (broadcastId, recipientId),
  FOREIGN KEY (broadcastId) REFERENCES "BroadcastList"(id) ON DELETE CASCADE,
  FOREIGN KEY (recipientId) REFERENCES "User"(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS "MessageReminder" (
  id TEXT PRIMARY KEY, userId TEXT NOT NULL, messageId TEXT NOT NULL, remindAt TEXT NOT NULL,
  createdAt TEXT NOT NULL, notified INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (userId) REFERENCES "User"(id) ON DELETE CASCADE,
  FOREIGN KEY (messageId) REFERENCES "Message"(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS "AuditLog" (
  id TEXT PRIMARY KEY, userId TEXT, action TEXT NOT NULL, resource TEXT, ip TEXT, userAgent TEXT,
  meta TEXT, createdAt TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES "User"(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS "PushSubscription" (
  id TEXT PRIMARY KEY, userId TEXT NOT NULL, endpoint TEXT UNIQUE NOT NULL, p256dh TEXT NOT NULL,
  auth TEXT NOT NULL, userAgent TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES "User"(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS Call_callerId_idx ON "Call"(callerId);
CREATE INDEX IF NOT EXISTS Call_receiverId_idx ON "Call"(receiverId);
CREATE INDEX IF NOT EXISTS Story_userId_idx ON "Story"(userId);
CREATE INDEX IF NOT EXISTS AuditLog_userId_idx ON "AuditLog"(userId);
CREATE INDEX IF NOT EXISTS AuditLog_action_idx ON "AuditLog"(action);
`

function resolveDbPath() {
  const url = process.env.DATABASE_URL || 'file:./db/custom.db'
  if (url.startsWith('file:')) {
    let p = url.slice(5)
    if (p.startsWith('./') || !p.startsWith('/')) p = resolve(process.cwd(), p.replace(/^\.\//, ''))
    const dir = dirname(p)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return p
  }
  throw new Error('This runtime only supports SQLite DATABASE_URL (file:...). For MySQL run prisma generate on a host that can download Prisma engines.')
}

let sqlite
function getSqlite() {
  if (sqlite) return sqlite
  const Database = require('better-sqlite3')
  const dbPath = resolveDbPath()
  sqlite = new Database(dbPath)
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('journal_mode = WAL')
  sqlite.exec(INIT_SQL)
  ensureColumns(sqlite)
  return sqlite
}

function tableCols(db, table) {
  return db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name)
}

function addCol(db, table, def) {
  const [name] = def.split(' ')
  const cols = tableCols(db, table)
  if (!cols.includes(name)) {
    db.exec(`ALTER TABLE "${table}" ADD COLUMN ${def}`)
  }
}

function ensureColumns(db) {
  addCol(db, 'User', 'phone TEXT')
  addCol(db, 'Call', 'answeredAt TEXT')
  addCol(db, 'Call', 'failureReason TEXT')
  addCol(db, 'Call', 'connectionType TEXT')
  addCol(db, 'Friendship', 'isCloseFriend INTEGER NOT NULL DEFAULT 0')
  addCol(db, 'Friendship', 'storiesMuted INTEGER NOT NULL DEFAULT 0')
  addCol(db, 'Message', 'edited INTEGER NOT NULL DEFAULT 0')
  addCol(db, 'Message', 'editedAt TEXT')
  addCol(db, 'Message', 'pinnedBy TEXT')
  addCol(db, 'Message', 'replyToId TEXT')
  addCol(db, 'Message', 'scheduledFor TEXT')
  addCol(db, 'ChatPreference', 'folder TEXT')
  addCol(db, 'Story', 'isHighlight INTEGER NOT NULL DEFAULT 0')
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
    async create(args = {}) {
      const db = getSqlite()
      const data = { ...(model.defaults ? model.defaults() : {}), ...(args.data || {}) }
      if (model.dates?.includes('updatedAt')) data.updatedAt = now()
      const keys = Object.keys(data).filter((k) => data[k] !== undefined)
      const vals = keys.map((k) => encodeVal(model, k, data[k]))
      const sql = `INSERT INTO "${model.table}" (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`
      db.prepare(sql).run(...vals)
      return this.findUnique({ where: { id: data.id }, include: args.include })
    },
    async update(args = {}) {
      const db = getSqlite()
      const existing = await this.findFirst({ where: args.where })
      if (!existing) throw new Error('Record to update not found')
      const patch = { ...(args.data || {}) }
      if (model.dates?.includes('updatedAt')) patch.updatedAt = now()
      const sets = []
      const params = []
      for (const [k, v] of Object.entries(patch)) {
        if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in v) {
          sets.push(`"${k}" = "${k}" + ?`)
          params.push(Number(v.increment))
        } else {
          sets.push(`"${k}" = ?`)
          params.push(encodeVal(model, k, v))
        }
      }
      const w = cond(model, args.where)
      db.prepare(`UPDATE "${model.table}" SET ${sets.join(', ')} WHERE ${w.sql}`).run(...params, ...w.params)
      return this.findFirst({ where: args.where, include: args.include })
    },
    async updateMany(args = {}) {
      const db = getSqlite()
      const patch = { ...(args.data || {}) }
      if (model.dates?.includes('updatedAt')) patch.updatedAt = now()
      const sets = []
      const params = []
      for (const [k, v] of Object.entries(patch)) {
        if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in v) {
          sets.push(`"${k}" = "${k}" + ?`)
          params.push(Number(v.increment))
        } else {
          sets.push(`"${k}" = ?`)
          params.push(encodeVal(model, k, v))
        }
      }
      const w = cond(model, args.where)
      const res = db.prepare(`UPDATE "${model.table}" SET ${sets.join(', ')} WHERE ${w.sql}`).run(...params, ...w.params)
      return { count: res.changes }
    },
    async delete(args = {}) {
      const existing = await this.findFirst({ where: args.where })
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
      if (existing) return this.update({ where: args.where, data: args.update, include: args.include })
      return this.create({ data: { ...args.create }, include: args.include })
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

const prisma = {
  user: delegate('user'),
  profile: delegate('profile'),
  session: delegate('session'),
  friendship: delegate('friendship'),
  message: delegate('message'),
  group: delegate('group'),
  groupMember: delegate('groupMember'),
  call: delegate('call'),
  notification: delegate('notification'),
  file: delegate('file'),
  messageReaction: delegate('messageReaction'),
  chatPreference: delegate('chatPreference'),
  story: delegate('story'),
  storyView: delegate('storyView'),
  messageStar: delegate('messageStar'),
  storyReply: delegate('storyReply'),
  messageDraft: delegate('messageDraft'),
  storyReaction: delegate('storyReaction'),
  broadcastList: delegate('broadcastList'),
  broadcastMember: delegate('broadcastMember'),
  messageReminder: delegate('messageReminder'),
  auditLog: delegate('auditLog'),
  pushSubscription: delegate('pushSubscription'),
  $queryRaw: taggedRaw,
  $disconnect: async () => {},
}

module.exports = { prisma, db: prisma, default: prisma, getSqlite }
