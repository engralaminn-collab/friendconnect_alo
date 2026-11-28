#!/usr/bin/env node
/**
 * Publish the failure lines from a Docker/MySQL verification run as GitHub
 * check-run annotations.
 *
 * Same reason as `report-integration-failures.mjs`: the raw job log and the
 * uploaded artifacts are served from storage that is not always reachable (log
 * retrieval from the maintenance sandbox returns an EOF), so a failing container
 * job is otherwise only visible as "Process completed with exit code 1".
 *
 * Annotations come from the checks API and are always readable.
 *
 * Usage:
 *   node scripts/report-verification-failures.mjs <log-file> [label]
 *
 * The verification scripts print one `PASS: …` / `FAIL: …` line per assertion and a
 * `=== n. <stage> ===` header per section, so the annotations are the exact stages
 * and assertions that failed, plus the tail of the log when nothing is parsable
 * (the failure happened before the first assertion — a build error, a missing
 * daemon, a container that never started).
 */
import { readFileSync, existsSync } from 'node:fs'

const [, , logPath, label = 'verification'] = process.argv

if (!logPath || !existsSync(logPath)) {
  annotate('error', `${label}: no log was produced, so the failure happened before the script could run.`, logPath || '(missing path)')
  process.exit(1)
}

const text = readFileSync(logPath, 'utf8')
const lines = text.split(/\r?\n/)

/** Nearest preceding `=== n. stage ===` header for a line index. */
function stageFor(index) {
  for (let i = index; i >= 0; i -= 1) {
    const match = lines[i].match(/^={2,}\s*(.+?)\s*={2,}$/)
    if (match) return match[1]
  }
  return 'startup'
}

const failures = []
for (let i = 0; i < lines.length; i += 1) {
  // `FAIL: …` from the verification scripts, and common tool errors that happen
  // before the first assertion (docker build, prisma, npm).
  if (/^FAIL:/.test(lines[i]) || /^npm error/.test(lines[i]) || /^ERROR:/.test(lines[i])) {
    failures.push({ stage: stageFor(i), message: lines[i].trim() })
  }
}

const summaryLine = lines.find((l) => /VERIFICATION (PASSED|FAILED)/.test(l))

if (!failures.length) {
  // Nothing parsed: annotate the tail, which is where a build or daemon error sits.
  const tail = lines.filter((l) => l.trim()).slice(-25).join('\n')
  annotate(
    'error',
    `${label}: FAILED before any assertion reported. Last output:\n${tail}`,
    logPath,
  )
  process.exit(0)
}

annotate(
  'error',
  `${label}: ${failures.length} assertion(s) failed${summaryLine ? ` — ${summaryLine.trim()}` : ''}`,
  logPath,
)

for (const failure of failures.slice(0, 20)) {
  annotate('error', `[${failure.stage}] ${failure.message}`, logPath)
}

// Include the surrounding context for the first failure: a `FAIL:` line is terse
// by design and the lines before it usually hold the cause.
const firstFailureIndex = lines.findIndex((l) => /^FAIL:/.test(l))
if (firstFailureIndex > 0) {
  const context = lines.slice(Math.max(0, firstFailureIndex - 12), firstFailureIndex + 3).join('\n')
  annotate('notice', `${label}: context around the first failure:\n${context}`, logPath)
}

/** Emit a workflow command. */
function annotate(level, message, file) {
  const kind = level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'notice'
  // Workflow commands are line-oriented; encode newlines so the message survives.
  const encoded = String(message).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
  const title = encodeURIComponent(`${file}`.slice(0, 100))
  console.log(`::${kind} file=${title}::${encoded}`)
}
