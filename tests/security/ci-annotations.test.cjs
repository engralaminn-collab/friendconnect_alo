'use strict'

/**
 * Regression test for scripts/report-integration-failures.mjs.
 *
 * CI's integration failure is now reported as one annotation per failing test.
 * If that parser silently breaks (reporting "no failed test" while five failed),
 * the job goes back to the single opaque "Process completed with exit code 1"
 * annotation that made the failure in run 45454198174 impossible to investigate:
 * the raw job log and artifacts were not reachable, so the failing test name was
 * not visible anywhere.
 *
 * The script is fed a captured TAP log, so this test does not need a build, a
 * database or a server.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('child_process')
const { mkdtempSync, writeFileSync, rmSync } = require('fs')
const { tmpdir } = require('os')
const { join, resolve } = require('path')

const repo = resolve(__dirname, '../..')
const script = join(repo, 'scripts/report-integration-failures.mjs')

const TAP_FAILURE = `TAP version 13
# Subtest: a deeply useful assertion
not ok 1 - a deeply useful assertion
  ---
  duration_ms: 2.9
  type: 'test'
  location: '${join(repo, 'tests/integration/demo.test.cjs')}:3:1'
  failureType: 'testCodeFailure'
  error: |-
    Expected "actual" to be reference-equal to "expected":
    + actual - expected

      {
    +   a: 1
    -   a: 2
      }

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  stack: |-
    TestContext.<anonymous> (${join(repo, 'tests/integration/demo.test.cjs')}:4:10)
    Test.runInAsyncScope (node:async_hooks:214:14)
  ...
# Subtest: a second failure
not ok 2 - a second failure
  ---
  duration_ms: 1.2
  type: 'test'
  location: '${join(repo, 'tests/integration/demo.test.cjs')}:9:1'
  failureType: 'uncaughtException'
  error: 'listen EADDRINUSE: address already in use 127.0.0.1:3021'
  ...
1..2
# tests 2
# pass 0
# fail 2
`

function run(logContents) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-annotations-'))
  const logPath = join(dir, 'integration-run.log')
  try {
    if (logContents !== null) writeFileSync(logPath, logContents)
    return execFileSync(process.execPath, [script, logPath], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_WORKSPACE: repo },
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function annotations(output) {
  return output.split('\n').filter((line) => line.startsWith('::error'))
}

test('every failing integration test becomes its own annotation', () => {
  const output = run(TAP_FAILURE)
  const errors = annotations(output)

  assert.equal(errors.length, 2, `expected one annotation per failing test, got:\n${output}`)

  // The test name, the failure kind and the assertion message must all be there:
  // they are what identifies the regression.
  assert.match(errors[0], /a deeply useful assertion/)
  assert.match(errors[0], /\[testCodeFailure\]/)
  assert.match(errors[0], /reference-equal to "expected"/)
  // Multi-line messages are flattened into one `%0A`-joined annotation.
  assert.ok(!errors[0].includes('\n'), 'an annotation must stay on a single line')
  assert.match(errors[1], /a second failure/)
  assert.match(errors[1], /EADDRINUSE/)
})

test('annotations point at a repo-relative file the checks API can resolve', () => {
  const errors = annotations(run(TAP_FAILURE))
  for (const error of errors) {
    const match = error.match(/^::error file=([^:]+)::/)
    assert.ok(match, `annotation has no file: ${error}`)
    assert.equal(match[1], 'tests/integration/demo.test.cjs')
    assert.ok(!match[1].startsWith('/'), 'an absolute path does not resolve outside the runner')
  }
})

test('a run that failed before any test result annotates the log tail', () => {
  const errors = annotations(run('Error: listen EADDRINUSE: address already in use 127.0.0.1:3021\n    at Server.setupListenHandle\n'))
  assert.equal(errors.length, 1)
  assert.match(errors[0], /no failed test result/)
  assert.match(errors[0], /EADDRINUSE/)
})

test('a missing log is reported instead of silently passing', () => {
  const errors = annotations(run(null))
  assert.equal(errors.length, 1)
  assert.match(errors[0], /no captured log exists/)
})
