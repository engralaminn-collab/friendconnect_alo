/**
 * Point the application database at a throwaway SQLite file for one test process.
 *
 * Must be called BEFORE `@/lib/db` is imported (use dynamic `import()` after it).
 * The file lives in the OS temp directory and is removed by `cleanup()`. It never
 * points at a configured production or staging database.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function openTempDatabase(label: string): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), `friendconnect-${label}-`))
  process.env.DATABASE_URL = `file:${join(dir, 'test.sqlite')}`
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}
