/**
 * One page of a conversation's messages, newest first (audit finding 20).
 *
 * Two defects are avoided here:
 *  1. `createdAt` has millisecond resolution, so messages can share a timestamp.
 *     Ordering by `createdAt` alone leaves the page boundary ambiguous, so rows can
 *     be skipped or repeated. `id` breaks ties, which makes the order total.
 *  2. The built-in SQLite runtime (`db-runtime.js`) does not implement Prisma's
 *     `cursor` option; it ignores it and applies `skip` as a fixed OFFSET. Every
 *     "next page" then returned the same rows. Paging therefore uses an explicit
 *     keyset condition, which both the SQLite runtime and Prisma/MySQL evaluate the
 *     same way.
 */
export interface MessagePageArgs {
  conversationId: string
  cursor?: string | null
  limit: number
  include?: Record<string, unknown>
}

export interface MessagePage<T> {
  page: T[]
  hasMore: boolean
  nextCursor: string | null
}

export async function fetchMessagePage(store: any, args: MessagePageArgs): Promise<MessagePage<any>> {
  let keyset: Record<string, unknown> = {}
  if (args.cursor) {
    const anchor = await store.message.findUnique({
      where: { id: args.cursor },
      select: { id: true, createdAt: true },
    })
    // A cursor that no longer names a row ends the walk instead of restarting it.
    if (!anchor) return { page: [], hasMore: false, nextCursor: null }
    keyset = {
      OR: [
        { createdAt: { lt: anchor.createdAt } },
        { createdAt: anchor.createdAt, id: { lt: anchor.id } },
      ],
    }
  }
  const rows = await store.message.findMany({
    where: { conversationId: args.conversationId, ...keyset },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: args.limit + 1,
    ...(args.include ? { include: args.include } : {}),
  })
  const hasMore = rows.length > args.limit
  const page = rows.slice(0, args.limit)
  return { page, hasMore, nextCursor: hasMore ? page[page.length - 1].id : null }
}
