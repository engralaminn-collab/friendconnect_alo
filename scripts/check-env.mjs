#!/usr/bin/env node
/**
 * Centralized environment validation for FriendConnect.
 *
 * Validates the *shape* of the environment for a given deployment mode and
 * fails early with clear, secret-free messages. Secret VALUES are never
 * printed — only variable names and what is wrong with them.
 *
 * Usage:
 *   node scripts/check-env.mjs                 # mode from NODE_ENV (default: development)
 *   node scripts/check-env.mjs --mode ci       # what the GitHub CI job needs
 *   node scripts/check-env.mjs --mode production
 *
 * Exit codes: 0 = all required checks pass (warnings allowed), 1 = fix required, 2 = bad usage.
 */
import process from 'node:process'

const argv = process.argv.slice(2)
let mode = (process.env.NODE_ENV || 'development').toLowerCase()
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--mode') { mode = String(argv[i + 1] || '').toLowerCase(); i += 1 }
  else if (argv[i].startsWith('--mode=')) mode = argv[i].slice('--mode='.length).toLowerCase()
  else if (argv[i] === '--help' || argv[i] === '-h') {
    console.log('Usage: node scripts/check-env.mjs [--mode development|test|ci|staging|production]')
    process.exit(0)
  } else {
    console.error(`Unknown argument: ${argv[i]}`)
    process.exit(2)
  }
}
if (!['development', 'test', 'ci', 'staging', 'production'].includes(mode)) {
  console.error(`Unknown mode: ${mode}`)
  process.exit(2)
}
const isProdLike = mode === 'production' || mode === 'staging'
const isCiLike = mode === 'ci'

const get = (name) => {
  const v = process.env[name]
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
}

// Deduplicate the "configured" list (a variable can be noted by more than one check).
const noted = new Set()
const note = (name) => noted.add(name)

const problems = [] // FAIL — blocks in prod/ci
const warnings = [] // WARN — informational everywhere
const notes = []    // OK — shown as configured (name only)

const requireInProd = ['DATABASE_URL', 'NEXTAUTH_SECRET']

for (const name of requireInProd) {
  const value = get(name)
  if (!value) {
    if (isProdLike || isCiLike) problems.push(`${name} is required in mode=${mode} but is not set (or is empty)`)
    else warnings.push(`${name} is not set — required before deploying to production`)
    continue
  }
  note(name)
  if (name === 'NEXTAUTH_SECRET' && value.length < 32) {
    const msg = `NEXTAUTH_SECRET is shorter than 32 characters (got ${value.length})`
    if (isProdLike) problems.push(msg)
    else warnings.push(msg)
  }
}

// ---------- format validation (only when set — never prints the value) ----------

function checkUrlShape(name, { schemes }) {
  const value = get(name)
  if (!value) return
  // DATABASE_URL style strings are not always URL-parsable by the platform in edge cases; be conservative.
  let parsed
  try { parsed = new URL(value) } catch {
    problems.push(`${name} is set but is not a parseable URL/connection string`)
    return
  }
  if (schemes && schemes.length > 0 && !schemes.includes(parsed.protocol.replace(':', ''))) {
    problems.push(`${name} uses an unexpected scheme (expected one of: ${schemes.join(', ')})`)
    return
  }
  note(name)
}

checkUrlShape('DATABASE_URL', { schemes: ['file', 'mysql', 'mariadb', 'postgresql', 'postgres'] })
checkUrlShape('REDIS_URL', { schemes: ['redis', 'rediss'] })
for (const name of ['APP_URL', 'NEXTAUTH_URL', 'NEXT_PUBLIC_APP_URL', 'SOCKET_INTERNAL_URL', 'APP_INTERNAL_URL', 'NEXT_PUBLIC_SOCKET_URL']) {
  checkUrlShape(name, { schemes: ['http', 'https'] })
}
checkUrlShape('JARA_SMS_PUBLIC_WEBHOOK_URL', { schemes: ['https', 'http'] })

function checkPort(name) {
  const value = get(name)
  if (!value) return
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 65535) problems.push(`${name} must be an integer between 1 and 65535`)
  else note(name)
}
for (const name of ['PORT', 'SOCKET_PORT', 'TURN_PORT', 'CHAT_SERVICE_PORT', 'APP_PORT']) checkPort(name)

// ---------- duplicate key detection in env files ----------
//
// Audit finding 13: `.env.example` declared DATABASE_URL twice, and dotenv keeps
// the LAST assignment, so the documented SQLite quick start actually configured
// MySQL. Nothing caught it because every check below reads `process.env`, which
// shows only the winning value. Reading the files directly is the only way to
// see the shadowed definition.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

for (const file of ['.env.example', '.env']) {
  const path = join(process.cwd(), file)
  if (!existsSync(path)) continue
  const seen = new Map()
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue
    const count = (seen.get(key) || 0) + 1
    seen.set(key, count)
    if (count === 2) {
      const target = file === '.env.example' ? problems : warnings
      target.push(
        `${file} declares ${key} more than once — the last definition wins and the earlier one is silently ignored`,
      )
    }
  }
}

// ---------- informational completeness (never blocks) ----------

if (get('DATABASE_URL')?.startsWith('file:')) {
  const value = get('DATABASE_URL')
  if (isProdLike && /file:\.\//.test(value)) {
    warnings.push('DATABASE_URL is a RELATIVE SQLite path in production mode — use an absolute file: path or MySQL/MariaDB')
  }
}

const aiProvider = get('OLLAMA_URL') || get('LITELLM_URL') || get('ZAI_API_KEY') || get('OPENROUTER_API_KEY')
  || get('HUGGINGFACE_API_KEY') || get('OPENAI_API_KEY') || get('AI_API_KEY')
if (!aiProvider) warnings.push('No AI provider configured (OLLAMA_URL / LITELLM_URL / ZAI_API_KEY / OPENROUTER_API_KEY / HUGGINGFACE_API_KEY / OPENAI_API_KEY) — Jara chat will report inference unavailable')

if (!get('SMTP_HOST') && !get('RESEND_API_KEY')) warnings.push('No email provider configured (SMTP_HOST / RESEND_API_KEY) — OTP codes will be logged in non-production only')
if (!get('REDIS_URL')) warnings.push('REDIS_URL is not set — cache/rate-limit falls back to in-memory (single instance only)')

if (isProdLike) {
  if (get('DB_ALLOW_SQLITE_FALLBACK') === 'true') problems.push('DB_ALLOW_SQLITE_FALLBACK=true is ignored in production and must not be relied on')
  if (get('JARA_SMS_PUBLIC_WEBHOOK_URL') && !get('JARA_SMS_PUBLIC_WEBHOOK_URL').startsWith('https://')) {
    warnings.push('JARA_SMS_PUBLIC_WEBHOOK_URL is not https — Twilio signature verification expects the exact public https URL')
  }
}

// ---------- report (names only) ----------

console.log(`FriendConnect environment check — mode=${mode}\n`)
if (noted.size) console.log(`configured: ${[...noted].sort().join(', ')}`)
if (warnings.length) { console.log('\nWARNINGS (non-blocking):'); for (const w of warnings) console.log(`  - ${w}`) }
if (problems.length) {
  console.log('\nERRORS (must fix):')
  for (const p of problems) console.log(`  - ${p}`)
  console.log('\nEnv check FAILED. See .env.example for the required names (values are never printed).')
  process.exit(1)
}
console.log('\nEnv check PASSED.')
