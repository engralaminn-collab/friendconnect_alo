/**
 * Typed facade over the grant-based file download authorization introduced for
 * finding #10.
 *
 * The implementation lives in `file-access.cjs` because the standalone Socket.IO
 * server (`socket-server.js`) is plain CommonJS and must issue the *same* grants
 * when a message with an attachment is sent over the socket. Duplicating the
 * logic in two languages is how the REST and socket paths drifted apart before,
 * so the logic exists once and both entry points import it.
 *
 * Download decisions resolve in this order, cheapest first:
 *   1. the caller owns the file                         (one indexed read)
 *   2. an explicit, unexpired grant exists              (one indexed read)
 *   3. the URL is a public profile photo / avatar       (public media only)
 *   4. the URL belongs to an approved Jara asset        (public media only)
 *
 * Steps 3 and 4 never consult message contents, so they cannot widen access to
 * private chat attachments. Grants are written when a file becomes reachable
 * (upload, message send, story post) and removed when sharing stops.
 * `backfillFileAccess()` plus migration v2 cover data written before this model
 * existed.
 */
import { db } from '@/lib/db'
import {
  setStoreProvider,
  grantFileAccess as coreGrantFileAccess,
  revokeFileAccess as coreRevokeFileAccess,
  revokeMessageGrants as coreRevokeMessageGrants,
  grantMessageFileAccess as coreGrantMessageFileAccess,
  grantStoryFileAccess as coreGrantStoryFileAccess,
  grantGroupFileAccess as coreGrantGroupFileAccess,
  canDownloadFile as coreCanDownloadFile,
  backfillFileAccess as coreBackfillFileAccess,
} from './file-access.cjs'

export type FileAccessSource =
  | 'owner'
  | 'message_sender'
  | 'message_recipient'
  | 'group_member'
  | 'story_viewer'
  | 'profile_public'
  | 'jara_asset'

export interface StoredFile {
  ownerId: string
  url: string
}

/** The database handle (or a test double implementing the queries used here). */
type Store = typeof db

/**
 * The CJS core takes its store by injection so tests can pass doubles and the
 * app never has to import the database at module scope. Register the app handle
 * lazily: `db` is a lazy proxy, so wrapping it in a thunk keeps `next build`
 * database-free.
 */
setStoreProvider(() => db)

/** Grant access to a file, ignoring the unique-constraint race on (fileUrl, userId). */
export async function grantFileAccess(
  fileUrl: string,
  userId: string,
  source: FileAccessSource,
  options: { messageId?: string | null; expiresAt?: Date | null } = {},
  store: Store = db,
): Promise<void> {
  await coreGrantFileAccess(fileUrl, userId, source, options, store)
}

/** Remove a grant. Used when a message is deleted or sharing is withdrawn. */
export async function revokeFileAccess(fileUrl: string, userId: string, store: Store = db): Promise<void> {
  await coreRevokeFileAccess(fileUrl, userId, store)
}

/**
 * Revoke only the grants created by one message.
 *
 * Deleting a message for everyone clears its `fileUrl`, but the same upload may
 * be shared in other threads, so revoking by URL would break those. Grants carry
 * the `messageId` that created them, which is the precise key.
 */
export async function revokeMessageGrants(
  message: { id: string } | null | undefined,
  store: Store = db,
): Promise<void> {
  await coreRevokeMessageGrants(message, store)
}

/** Grant access for every participant of a message that carries an attachment. */
export async function grantMessageFileAccess(
  message: {
    id: string
    fileUrl?: string | null
    senderId: string
    receiverId?: string | null
    groupId?: string | null
  },
  store: Store = db,
): Promise<void> {
  await coreGrantMessageFileAccess(message, store)
}

/** Grant story media to accepted, unblocked, unmuted friends. */
export async function grantStoryFileAccess(
  story: { userId: string; content?: string | null; mediaUrl?: string | null; expiresAt?: Date | null },
  store: Store = db,
): Promise<void> {
  await coreGrantStoryFileAccess(story, store)
}

/** Grant access to current members of a group. */
export async function grantGroupFileAccess(fileUrl: string, groupId: string, store: Store = db): Promise<void> {
  await coreGrantGroupFileAccess(fileUrl, groupId, store)
}

/** True when `userId` may download `file`. */
export async function canDownloadFile(userId: string, file: StoredFile, store: Store = db): Promise<boolean> {
  return Boolean(await coreCanDownloadFile(userId, file, store))
}

/** Idempotently rebuild owner/participant grants for existing data. */
export async function backfillFileAccess(
  store: Store = db,
  options: { limit?: number } = {},
): Promise<{ files: number; grants: number }> {
  return coreBackfillFileAccess(store, options)
}
