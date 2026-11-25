#!/usr/bin/env node
/**
 * Turn `node --test` integration failures into GitHub check-run annotations.
 *
 * Why this exists: the integration job used to report exactly one annotation,
 * "Process completed with exit code 1", on a step that only ran
 * `npm run test:integration`. The per-test evidence lives in the raw job log,
 * and that log is served from a host that is not always reachable (`gh run view
 * --log-failed` returned an EOF from the sandbox this repository is maintained
 * in, and the uploaded artifacts are on the same storage). A failing suite was
 * therefore not investigable without re-running it locally against a production
 * build.
 *
 * Annotations are returned by the checks API, so the failing test name, its
 * assertion message and the first stack frames are readable from any environment.
 *
 * Usage (in CI, after a failed `npm run test:integration`, with the step's output
 * captured by `| tee integration-run.log`):
 *
 *   node scripts/report-integration-failures.mjs integration-run.log
 *
 * The log is parsed as TAP, which is what `--test-reporter=tap` writes in CI.
 * When nothing parses (the runner died before it could emit a plan, a port was
 * already in use, ...) the tail of the log is annotated instead: that is where
 * the startup error is.
 */
import { readFileSync, existsSync } from 'node:fs'
import { relative as relativeTo } from 'node:path'

const repoRoot = process.env.GITHUB_WORKSPACE || process.cwd()

const logPath = process.argv[2] || 'integration-run.log'

/** GitHub annotations are single lines: escape, collapse and truncate. */
function annotate(message, file) {
  const flat = String(message)
    .replace(/\r/g, '')
    .replace(/%/g, '%25')
    .replace(/\n/g, '%0A')
    .slice(0, 4000)
  const location = file ? ` file=${file}` : ''
  console.log(`::error${location}::${flat}`)
}

if (!existsSync(logPath)) {
  annotate(
    `Integration tests failed and no captured log exists at ${logPath}. ` +
      'The CI step must pipe its output through `tee integration-run.log`.',
  )
  process.exit(0)
}

const text = readFileSync(logPath, 'utf8').replace(/\r/g, '')
const lines = text.split('\n')

/** YAML single-quoted scalars escape `'` by doubling it. */
function unquote(value) {
  const trimmed = value.trim()
  if (!trimmed.startsWith("'")) return trimmed
  const end = trimmed.lastIndexOf("'")
  return trimmed
    .slice(1, end === 0 ? undefined : end)
    .replace(/''/g, "'")
}

/** Reads an indented YAML block (`key: |-`) until the block's indentation ends. */
function readBlock(startIndex, indent) {
  const block = []
  for (let i = startIndex; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.trim() === '') {
      block.push('')
      continue
    }
    const lineIndent = line.length - line.trimStart().length
    if (lineIndent <= indent) break
    block.push(line.trim())
  }
  return block.join('\n').trim()
}

/**
 * Collects the `---` YAML diagnostic node that `node --test` prints under each
 * `not ok`. Returns one entry per failing test, newest last.
 */
function parseTapFailures(source) {
  const failures = []
  for (let i = 0; i < source.length; i += 1) {
    const header = source[i].match(/^not ok \d+ - (.*)$/)
    if (!header) continue

    const failure = { title: header[1].trim(), location: '', failureType: '', error: '', stack: '' }
    for (let j = i + 1; j < source.length; j += 1) {
      const line = source[j]
      // The diagnostic block ends at `...` or at the next test/subtest header.
      if (line.trim() === '...') break
      if (/^not ok \d+ - /.test(line) || /^ok \d+ - /.test(line) || /^# Subtest: /.test(line)) break
      if (/^1\.\.\d+/.test(line)) break

      const indent = line.length - line.trimStart().length
      const field = line.match(/^\s*(location|failureType|error|stack|code):\s*(.*)$/)
      if (!field) continue
      const [, key, rawValue] = field
      if (rawValue === '|-' || rawValue === '|') {
        const block = readBlock(j + 1, indent)
        if (key === 'stack') failure.stack = block
        if (key === 'error') failure.error = block
      } else if (key === 'error') {
        failure.error = unquote(rawValue)
      } else if (key === 'location') {
        failure.location = unquote(rawValue)
      } else if (key === 'failureType') {
        failure.failureType = unquote(rawValue)
      }
    }
    failures.push(failure)
  }
  return failures
}

/**
 * `'/home/runner/work/repo/repo/tests/integration/x.test.cjs:12:3'` ->
 * `'tests/integration/x.test.cjs'`. GitHub only resolves a repo-relative path,
 * and the checkout directory differs between runners, so the absolute prefix is
 * dropped.
 */
function sourceFile(location) {
  if (!location) return undefined
  const match = location.match(/^(.*?)(?::\d+){2}$/)
  if (!match) return undefined
  const absolute = match[1]
  const relative = relativeTo(repoRoot, absolute)
  return relative && !relative.startsWith('..') ? relative : undefined
}

const failures = parseTapFailures(lines)

if (!failures.length) {
  // The runner never reached a per-test result: a startup failure, a port
  // conflict, a missing production build, or an uncaught exception outside a
  // test. The tail of the log is the only evidence.
  const tail = lines.filter((line) => line.trim() !== '').slice(-60).join('\n')
  annotate(
    'Integration tests failed but the output contains no failed test result, so this is not an assertion. ' +
      'Look for a startup error (missing production build, port in use, uncaught exception):\n' +
      '--- last lines of the integration run ---\n' +
      tail,
  )
  process.exit(0)
}

// A single annotation per failing test; GitHub truncates long bodies anyway.
const MAX_ANNOTATIONS = 12

for (const failure of failures.slice(0, MAX_ANNOTATIONS)) {
  const kind = failure.failureType ? ` [${failure.failureType}]` : ''
  const stack = failure.stack
    ? '\n--- stack ---\n' + failure.stack.split('\n').slice(0, 8).join('\n')
    : ''
  annotate(`${failure.title}${kind}\n${failure.error || 'no error message'}${stack}`, sourceFile(failure.location))
}

if (failures.length > MAX_ANNOTATIONS) {
  annotate(
    `${failures.length - MAX_ANNOTATIONS} more integration test(s) failed: ` +
      failures
        .slice(MAX_ANNOTATIONS)
        .map((failure) => failure.title)
        .join('; '),
  )
}

console.log(`Reported ${failures.length} failing integration test(s) as annotations.`)
