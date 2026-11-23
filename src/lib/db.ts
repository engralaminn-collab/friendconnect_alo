// PrismaClient requires `prisma generate` which needs network to download engines.
// In this repo the live database path is SQLite via src/lib/db-runtime.js (better-sqlite3).
// Fall back to that runtime when the generated client is not present, so `next build`
// can collect routes without downloading Prisma engines.
let _db: any
try {
  // Try real Prisma client first (MySQL production)
  const { PrismaClient } = require('@prisma/client')
  const globalForPrisma = globalThis as unknown as { prisma: any }
  _db = globalForPrisma.prisma ?? new PrismaClient({ log: ['query'] as any })
  if (process.env.NODE_ENV !== 'production') (globalThis as any).prisma = _db
} catch {
  // Fallback: SQLite runtime (no engine download needed)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const runtime = require('./db-runtime.js')
  _db = runtime.prisma
}
export const db = _db as any