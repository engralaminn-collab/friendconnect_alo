/**
 * Compatibility alias.
 *
 * Nothing in the app imports this module (`grep "@/lib/prisma"` is empty); the
 * single entry point is `@/lib/db`. It is kept as a re-export so the two names
 * can never resolve to different clients.
 */
export { db, db as prisma, db as default } from './db'
