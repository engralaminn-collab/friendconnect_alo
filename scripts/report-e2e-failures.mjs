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
 *   node scripts/report-e2e-failures.mjs test-results/report.json
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

if (!existsSync(reportPath)) {
  annotate(`Playwright failed but no JSON report was written at ${reportPath}. The suite probably failed before running any test (server startup, browser install or config).`)
  process.exit(0)
}

let report
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'))
} catch (error) {
  annotate(`Could not parse the Playwright JSON report: ${error.message}`)
  process.exit(0)
}

const failed = []
for (const suite of report.suites ?? []) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      if (test.status === 'unexpected' || test.status === 'flaky' || test.status === 'timedOut') {
        failed.push({ spec, test })
      }
    }
  }
}

if (!failed.length) {
  annotate('Playwright reported a failure but the JSON report contains no failed test. Check the job log for a startup error.')
  process.exit(0)
}

for (const { spec, test } of failed) {
  const title = spec.title || spec.file
  const firstError = test.results?.find((result) => result.error)?.error?.message ?? 'no error message'
  const detailFile = test.results?.[0]?.attachments?.find((a) => a.name === 'error-context')?.path
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
