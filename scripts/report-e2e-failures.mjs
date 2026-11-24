#!/usr/bin/env node
/**
 * Turn Playwright failures into GitHub check-run annotations.
 *
 * Why this exists: the HTML report and traces are uploaded as artifacts, but
 * those live on blob storage that is not always reachable (it is not reachable
 * from the sandbox this repository was remediated in), and the raw job log is
 * served from the same host. Annotations, on the other hand, are returned by the
 * checks API, so a failing end-to-end test becomes readable without downloading
 * anything.
 *
 * Usage (in CI, after a failed `npm run test:e2e`):
 *
 *   node scripts/report-e2e-failures.mjs test-results/report.json e2e-run.log
 *
 * The log must be written outside `test-results/`: Playwright empties its
 * `outputDir` when a run starts, which unlinks a log `tee` is still writing to.
 *
 * Playwright's JSON reporter writes one entry per test; this prints a
 * `::error::` workflow command per failed test with its first error message and
 * the first lines of Playwright's page snapshot (`error-context.md`), which is
 * usually enough to see which selector or assertion broke.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const reportPath = process.argv[2] || 'test-results/report.json'

/** GitHub annotations are single-line; escape and truncate. */
function annotate(message, file) {
  const flat = String(message)
    .replace(/\r/g, '')
    .replace(/%/g, '%25')
    .replace(/\n/g, '%0A')
    .slice(0, 1200)
  const location = file ? ` file=${file}` : ''
  console.log(`::error${location}::${flat}`)
}

/** The step's combined output, captured by CI (`| tee test-results/e2e.log`). */
const logPath = process.argv[3] || 'e2e-run.log'

/** Annotate the tail of the run log — the only way to see a startup failure. */
function annotateLogTail(reason) {
  if (!existsSync(logPath)) {
    annotate(`${reason} No JSON report and no captured log at ${logPath}.`)
    return
  }
  const lines = readFileSync(logPath, 'utf8').replace(/\r/g, '').split('\n').filter(Boolean)
  // The interesting part of a Playwright startup failure is at the end.
  const tail = lines.slice(-60).join('\n')
  annotate(`${reason}\n--- last lines of the end-to-end run ---\n${tail}`)
}

/**
 * `tests/e2e/support.ts` writes console errors, page errors, failed requests and
 * the rendered text of every tracked page when a test fails. That file is the only
 * view into the browser from an environment where one cannot be run.
 */
const diagnosticsPath = 'test-results/diagnostics.txt'
if (existsSync(diagnosticsPath)) {
  const diagnostics = readFileSync(diagnosticsPath, 'utf8')
  // One annotation per attempt, so the retry does not hide the first failure.
  for (const attempt of diagnostics.split(/\n##### /).filter(Boolean)) {
    annotate(`browser diagnostics\n${attempt}`)
  }
}

if (!existsSync(reportPath)) {
  annotateLogTail(
    `Playwright failed but no JSON report was written at ${reportPath}: the suite did not get as far as running a test.`,
  )
  process.exit(0)
}

let report
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'))
} catch (error) {
  annotate(`Could not parse the Playwright JSON report: ${error.message}`)
  process.exit(0)
}

/**
 * Playwright's JSON report nests one suite per file and one more per
 * `test.describe`, so a non-recursive walk finds nothing — which is exactly what
 * made the first version of this script report "no failed test" while two tests
 * were failing.
 */
function collectFailedSuites(suites, out = []) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        if (test.status === 'unexpected' || test.status === 'flaky' || test.status === 'timedOut') {
          out.push({ spec, test })
        }
      }
    }
    collectFailedSuites(suite.suites, out)
  }
  return out
}

const failed = collectFailedSuites(report.suites)

if (!failed.length) {
  // Every test either passed or never ran: this is a webServer/startup failure
  // (or a teardown error), and the process output is the only evidence.
  annotateLogTail(
    'Playwright exited non-zero but the JSON report contains no failed test, so the failure is not an assertion. This is normally the webServer failing to start or exiting early.',
  )
  process.exit(0)
}

for (const { spec, test } of failed) {
  const title = spec.title || spec.file
  const firstError = test.results?.find((result) => result.error)?.error?.message ?? 'no error message'
  const attachments = (test.results ?? []).flatMap((result) => result.attachments ?? [])
  const detailFile = attachments.find((a) => a.name === 'error-context')?.path
  let context = ''
  if (detailFile && existsSync(detailFile)) {
    // Playwright writes an ARIA snapshot of the page at the moment of failure.
    context = `\n--- page snapshot ---\n${readFileSync(detailFile, 'utf8').slice(0, 700)}`
  } else {
    // The attachment path is relative to the report; try the conventional one.
    const conventional = join(dirname(reportPath), '..', 'test-results', spec.file ?? '', 'error-context.md')
    if (existsSync(conventional)) {
      context = `\n--- page snapshot ---\n${readFileSync(conventional, 'utf8').slice(0, 700)}`
    }
  }
  annotate(`${title}: ${firstError}${context}`, spec.file)
}

console.log(`Reported ${failed.length} failing end-to-end test(s) as annotations.`)
