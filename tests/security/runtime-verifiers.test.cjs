'use strict'

/**
 * Source-level regression checks for the real Docker/MySQL verification scripts.
 *
 * These scripts are themselves production gates. A false failure is not harmless:
 * the first MySQL run applied all migrations correctly, then its CRUD fixture lived
 * in `/tmp` and Node could not resolve the repository's generated
 * `@prisma/client`. This test keeps executable fixtures under REPO_ROOT and proves
 * the module-resolution reason with a real child process.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')

const ROOT = resolve(__dirname, '../..')
const mysqlVerify = require('node:fs').readFileSync(join(ROOT, 'scripts/mysql-verify.sh'), 'utf8')
const dockerVerify = require('node:fs').readFileSync(join(ROOT, 'scripts/docker-verify.sh'), 'utf8')

test('MySQL CRUD fixture is created beneath the repository for Node module resolution', () => {
  assert.match(mysqlVerify, /CRUD_SCRIPT="\$REPO_ROOT\/\.mysql-verify-crud\.cjs"/)
  assert.match(mysqlVerify, /node "\$CRUD_SCRIPT"/)
  assert.doesNotMatch(mysqlVerify, /node \/tmp\/mysql-verify-crud\.cjs/)
  assert.match(mysqlVerify, /rm -f "\$CRUD_SCRIPT"/)
})

test('a script resolves node_modules from its own directory, not process.cwd()', () => {
  const temp = mkdtempSync(join(tmpdir(), 'fc-module-resolution-'))
  try {
    // A tiny package available only beneath a fake repository.
    const repo = join(temp, 'repo')
    mkdirSync(join(repo, 'node_modules', 'fixture-module'), { recursive: true })
    writeFileSync(join(repo, 'node_modules', 'fixture-module', 'index.js'), "module.exports = 'resolved'\n")
    const source = "console.log(require('fixture-module'))\n"

    const inRepo = join(repo, '.verify.cjs')
    writeFileSync(inRepo, source)
    const pass = spawnSync(process.execPath, [inRepo], { cwd: repo, encoding: 'utf8' })
    assert.equal(pass.status, 0)
    assert.match(pass.stdout, /resolved/)

    const outsideRepo = join(temp, 'verify.cjs')
    writeFileSync(outsideRepo, source)
    const fail = spawnSync(process.execPath, [outsideRepo], { cwd: repo, encoding: 'utf8' })
    assert.notEqual(fail.status, 0)
    assert.match(fail.stderr, /Cannot find module 'fixture-module'/)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('Docker verifier exercises named-volume writes as the final non-root user', () => {
  assert.match(dockerVerify, /-v "\$VOLUME:\/data" --entrypoint sh/)
  assert.match(dockerVerify, /touch \/data\/\.write-probe/)
  assert.match(dockerVerify, /named \/data volume is writable by the non-root runtime user/)
})
