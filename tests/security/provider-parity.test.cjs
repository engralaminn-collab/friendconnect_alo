'use strict'

/**
 * Regression test for the MySQL provider-parity check.
 *
 * Real defect this covers: the hand-written MySQL migration history and
 * `prisma/schema.prisma` had drifted by 49 columns across 16 tables (User was
 * missing `avatarUrl`, `bio`, `status`, `lastSeenAt`, …). Nothing caught it because
 * `check-schema-drift.mjs` only proves a table *exists*, and every test path used
 * either the SQLite runtime or schema validation without executing the migrations.
 * The first real `prisma migrate deploy` against MySQL discovered it.
 *
 * A checker that cannot fail is worthless, so this test removes the repair
 * migration in a temp copy and asserts the check reports the drift.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')

const ROOT = resolve(__dirname, '../..')
const CHECKER = join(ROOT, 'scripts/check-provider-parity.mjs')
const REPAIR = '20261128000000_parity_repair_missing_columns'

function runChecker(cwd) {
  const result = spawnSync(process.execPath, [join(cwd, 'scripts/check-provider-parity.mjs')], {
    cwd,
    encoding: 'utf8',
  })
  return { code: result.status, out: `${result.stdout || ''}${result.stderr || ''}` }
}

/** Copy just what the checker reads into a scratch tree. */
function scratchTree() {
  const tmp = mkdtempSync(join(tmpdir(), 'fc-parity-'))
  mkdirSync(join(tmp, 'scripts'), { recursive: true })
  mkdirSync(join(tmp, 'prisma'), { recursive: true })
  cpSync(join(ROOT, 'scripts/check-provider-parity.mjs'), join(tmp, 'scripts/check-provider-parity.mjs'))
  cpSync(join(ROOT, 'prisma/schema.prisma'), join(tmp, 'prisma/schema.prisma'))
  cpSync(join(ROOT, 'prisma/migrations'), join(tmp, 'prisma/migrations'), { recursive: true })
  return tmp
}

let failures = 0
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok  ${name}`)
  } else {
    failures += 1
    console.error(`  FAIL ${name}${detail ? `\n        ${detail}` : ''}`)
  }
}

// --- 1. the repository as it stands passes ---------------------------------
{
  const result = runChecker(ROOT)
  check('repository parity check passes', result.code === 0, result.out.trim())
  check('parity reports the full model count', /53 models/.test(result.out), result.out.trim())
}

// --- 2. without the repair migration, the check fails ----------------------
{
  const tmp = scratchTree()
  try {
    rmSync(join(tmp, 'prisma/migrations', REPAIR), { recursive: true, force: true })
    const result = runChecker(tmp)
    check('removing the repair migration makes the check fail', result.code === 1, result.out.trim())
    // It must name a real column, not fail for an unrelated reason.
    check(
      'the failure names a specific drifted column',
      /User.*avatarUrl|User.*lastSeenAt|Session.*sessionToken/.test(result.out),
      result.out.trim(),
    )
    check(
      'the failure reports the scale of the drift',
      /problem\(s\)/.test(result.out),
      result.out.trim(),
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

// --- 3. the generated migration is reproducible ----------------------------
{
  const onDisk = readFileSync(join(ROOT, 'prisma/migrations', REPAIR, 'migration.sql'), 'utf8')
  check('the repair migration is idempotent by construction', onDisk.includes('information_schema.COLUMNS'))
  check('the repair migration is generated, not hand-written', onDisk.includes('do not hand-edit'))
  // Every added column is wrapped in the guard; a bare ALTER would not be re-runnable.
  const bareAlters = onDisk.split('\n').filter((line) => /^ALTER TABLE .* ADD COLUMN/.test(line.trim()))
  check('no bare ALTER statements outside the guard', bareAlters.length === 0, bareAlters.join('\n'))
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll provider-parity checks passed.')
