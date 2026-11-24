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
  'Attachment.url',
  'Attachment.thumbUrl',
  'File.url',
  'File.thumbUrl',
  'File.filename',
  'FileAccess.fileUrl',
  'Session.userAgent',
  'PushSubscription.keys',
  'Conversation.avatarUrl',
  'Conversation.description',
  'MessageReaction.emoji',
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

/** `Model.field` pairs that are indexed/compared and should stay bounded. */
const NARROW_STRING = new Set(['User.email', 'User.username', 'Session.token'])

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
