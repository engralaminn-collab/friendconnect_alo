/**
 * The single database handle used by the application.
 *
 * Backend selection (and the refusal to silently degrade) lives in
 * `src/lib/db-backend.ts`. Read that file before changing anything here.
 *
 * The handle is lazy: it connects on the first query, not at import time, so
 * `next build` does not need a reachable database.
 *
 * It is intentionally typed loosely: the runtime delegates are generated from
 * the Prisma schema, so the authoritative shape is `prisma/schema.prisma`.
 */
import { createLazyClient, getBackendInfo } from './db-backend'

export const db = createLazyClient() as any
export { getBackendInfo }
