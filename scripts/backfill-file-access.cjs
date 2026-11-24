#!/usr/bin/env node
/**
 * Rebuild `FileAccess` grants for existing data (finding #10).
 *
 * Migration v2 backfills what it can in SQL, but attachments that were stored
 * after the migration, grants lost to a write race, and data imported from a
 * dump all need re-deriving. `backfillFileAccess()` is idempotent, so this is
 * safe to run repeatedly.
 *
 *   npm run backfill:file-access            # up to 5000 files
 *   npm run backfill:file-access -- 50000   # custom limit
 *
 * It only ever *adds* grants derived from data that already exists; it never
 * widens access beyond owners and message/story participants.
 */
'use strict'

const { prisma } = require('../src/lib/db-runtime.js')
const { backfillFileAccess } = require('../src/lib/file-access.cjs')

async function main() {
  const limit = Number(process.argv[2] || 0) || 5000
  const started = Date.now()
  const result = await backfillFileAccess(prisma, { limit })
  console.log(
    `[file-access] backfill complete: ${result.files} file(s) scanned, ${result.grants} grant(s) ensured in ${Date.now() - started}ms`,
  )
}

main()
  .then(async () => {
    await prisma.$disconnect?.()
    process.exit(0)
  })
  .catch(async (error) => {
    console.error('[file-access] backfill failed:', error && error.message ? error.message : error)
    await prisma.$disconnect?.().catch(() => {})
    process.exit(1)
  })
