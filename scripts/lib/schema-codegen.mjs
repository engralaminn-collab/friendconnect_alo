/**
 * Canonical Prisma schema -> provider variants.
 *
 * `prisma/schema.prisma` is the single source of truth. The two variants are
 * generated from it and must never be hand-edited:
 *
 *   prisma/schema.sqlite.prisma  — same models, SQLite provider (local dev/test)
 *   prisma/schema.mysql.prisma   — same models, MySQL provider + wide-text types
 *
 * Why generate instead of maintaining three files: the three used to be edited
 * independently and drifted so far apart that the MySQL production database was
 * missing eleven models that the API queries on every request, and
 * `User.emailVerified` was a `DateTime` in the schema while every caller used it
 * as a boolean.
 *
 * The only difference between providers that we encode here is the MySQL
 * `@db.Text` / `@db.VarChar` native types. Canonical keeps plain `String` so it
 * validates under SQLite. Columns that hold unbounded user content are promoted
 * to TEXT on MySQL using WIDE_TEXT below — this list is deliberately explicit so
 * that "this column can hold arbitrary length" is a reviewed decision rather
 * than an accident.
 */

/** `Model.field` pairs that must be TEXT (not VARCHAR(191)) on MySQL. */
export const WIDE_TEXT = new Set([
  // long-form user content
  'User.bio',
  'User.twoFactorBackup',
  'Profile.bio',
  'Profile.location',
  'Profile.education',
  'Profile.work',
  'Message.content',
  'Message.fileName',
  'Message.metadata',
  'Message.deletedFor',
  'Post.content',
  'Post.mediaUrl',
  'PostComment.content',
  'Story.content',
  'Story.mediaUrl',
  'Story.caption',
  'StoryReply.content',
  'Group.description',
  'Call.failureReason',
  'ChatPreference.wallpaper',
  'MessageDraft.content',
  'BroadcastList.description',
  'Notification.body',
  'Notification.data',
  'Report.detail',
  'AuditLog.detail',
  'AuditLog.meta',
  'AuditLog.userAgent',
  'Session.userAgent',
  'PushSubscription.keys',
  'Conversation.avatarUrl',
  'Conversation.description',
  'JaraConfig.colors',
  'JaraConfig.animation',
  'JaraConfig.clothing',
  'JaraConfig.avatarUrl',
  'JaraConfig.backgroundUrl',
  'JaraConfig.aiDisclosure',
  'JaraProposal.configJson',
  'JaraProposal.changeSummary',
  'JaraAuditLog.detail',
  'JaraAuditLog.userAgent',
  'JaraAuditLog.previousValue',
  'JaraAuditLog.newValue',
  'JaraAuditLog.changeReason',
  'JaraMemory.value',
  'JaraAsset.fileUrl',
  'JaraAsset.storageKey',
  'JaraAsset.metadata',
  'JaraKnowledgeSource.content',
  'JaraKnowledgeSource.fileUrl',
  'JaraSmsMessage.body',
  'JaraDonorContribution.message',
  'JaraConsentRecord.detail',
  'JaraMeetingProfile.description',
  'JaraMeetingProfile.referenceImageUrl',
  'JaraMeetingProfile.referenceVideoUrl',
  'JaraMeetingProfile.voiceSampleUrl',
  'JaraCallPresentation.description',
  'JaraAppearanceProfile.description',
  'JaraAppearanceProfile.configJson',
  'JaraAppearanceProfile.previewUrl',
  'JaraMeetingIntegration.configJson',
])

/**
 * `Model.field` pairs that are indexed/compared and must stay bounded
 * (VARCHAR(191)). MySQL cannot use a TEXT column in a unique constraint or a
 * plain index without a prefix length, so anything in a `@@unique`/`@@index`
 * belongs here — never in `WIDE_TEXT`.
 */
const NARROW_STRING = new Set([
  'User.email',
  'User.username',
  'Session.token',
  // Machine-generated identifiers and short display values. They are all
  // bounded by construction (a file URL is `/api/files/<48 hex>`), and they
  // are indexed, so they must not widen to TEXT.
  'File.url',
  'File.thumbUrl',
  'File.filename',
  'FileAccess.fileUrl',
  'Attachment.url',
  'Attachment.thumbUrl',
  'MessageReaction.emoji',
])

/**
 * Fails the build if a wide column is also indexed.
 *
 * This is the guard for a real CI failure: `File.url` was in `WIDE_TEXT` while
 * the canonical schema declares it `@unique`, so the generated MySQL schema was
 * rejected by `prisma validate` ("Native type `Text` cannot be unique in MySQL")
 * even though every other check passed. Catching it here means the generator
 * refuses to emit an invalid variant instead of CI discovering it later.
 */
function assertWideTextIsNotIndexed(canonicalSource) {
  const { blocks } = modelBlocks(canonicalSource)
  const offenders = []
  for (const block of blocks) {
    const indexed = new Set()
    for (const match of block.text.matchAll(/@@(?:unique|index)\(\[([^\]]+)\]/g)) {
      for (const field of match[1].split(',')) indexed.add(field.trim())
    }
    for (const field of indexed) {
      if (WIDE_TEXT.has(`${block.name}.${field}`)) offenders.push(`${block.name}.${field}`)
    }
  }
  if (offenders.length) {
    throw new Error(
      `WIDE_TEXT contains indexed columns, which MySQL cannot index without a prefix length: ${offenders.join(', ')}. ` +
        'Move them to NARROW_STRING (VARCHAR(191)) instead.',
    )
  }
}

const HEADER = (provider, note) => `// ============================================================================
// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Generated from prisma/schema.prisma by scripts/generate-schema-variants.mjs
// Provider: ${provider}
// ${note}
//
// Edit prisma/schema.prisma instead, then run:
//   node scripts/generate-schema-variants.mjs
// CI runs the same generator in --check mode and fails on any manual edit.
// ============================================================================
`

/**
 * Split the canonical schema into its body and per-model blocks so native types
 * can be injected without rewriting anything the author wrote.
 */
function modelBlocks(source) {
  const blocks = []
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm
  let match
  let lastIndex = 0
  while ((match = re.exec(source))) {
    blocks.push({
      name: match[1],
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
    })
    lastIndex = match.index + match[0].length
  }
  return { blocks, lastIndex }
}

function stripNativeTypes(line) {
  return line.replace(/\s+@db\.\w+(\([^)]*\))?/g, '')
}

function withNativeTypes(modelName, line) {
  if (!/@db\./.test(line)) {
    // Only promote plain scalar String fields; never touch relations.
    const fieldMatch = line.match(/^(\s*)(\w+)(\s+)(String)(\?)?(\s*)(.*)$/)
    if (!fieldMatch) return line
    const [, indent, fieldName, pad, type, optional = '', afterType, rest] = fieldMatch
    const key = `${modelName}.${fieldName}`
    let native = ''
    if (WIDE_TEXT.has(key)) native = ' @db.Text'
    else if (!NARROW_STRING.has(key)) native = ''
    if (!native) return line
    return `${indent}${fieldName}${pad}${type}${optional}${native}${afterType}${rest}`
  }
  return line
}

export function generateVariants(canonicalSource) {
  assertWideTextIsNotIndexed(canonicalSource)
  const { blocks } = modelBlocks(canonicalSource)

  // --- SQLite: identical models, no native types (SQLite rejects them) ------
  let sqlite = canonicalSource
    .split('\n')
    .map((line) => stripNativeTypes(line))
    .join('\n')
  sqlite = sqlite.replace(
    /(\ndatasource db \{\n)([\s\S]*?)(\n\})/,
    (whole, open, body, close) =>
      `${open}${body.replace(/provider\s*=\s*"[^"]+"/, 'provider = "sqlite"')}${close}`,
  )
  sqlite = sqlite.replace(/^\/\/.*\n/, '')
  sqlite = HEADER('sqlite', 'Identical models to canonical; SQLite rejects native type annotations.') +
    '\n' + sqlite.trimStart()

  // --- MySQL: provider swap + explicit wide-text types ----------------------
  let mysql = canonicalSource
  for (const block of blocks) {
    const rewritten = block.text
      .split('\n')
      .map((line) => withNativeTypes(block.name, line))
      .join('\n')
    mysql = mysql.replace(block.text, rewritten)
  }
  mysql = mysql.replace(
    /(\ndatasource db \{\n)([\s\S]*?)(\n\})/,
    (whole, open, body, close) =>
      `${open}${body.replace(/provider\s*=\s*"[^"]+"/, 'provider = "mysql"')}${close}`,
  )
  mysql = mysql.replace(/^\/\/.*\n/, '')
  mysql = HEADER('mysql', 'Wide-text columns are declared in scripts/lib/schema-codegen.mjs (WIDE_TEXT).') +
    '\n' + mysql.trimStart()

  return { sqlite, mysql }
}
