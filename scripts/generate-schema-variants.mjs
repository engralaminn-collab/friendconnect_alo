#!/usr/bin/env node
/**
 * Generate prisma/schema.sqlite.prisma and prisma/schema.mysql.prisma from the
 * canonical prisma/schema.prisma.
 *
 *   node scripts/generate-schema-variants.mjs           # write the files
 *   node scripts/generate-schema-variants.mjs --check   # verify, exit 1 on drift
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateVariants } from './lib/schema-codegen.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CANONICAL = join(ROOT, 'prisma/schema.prisma')
const TARGETS = {
  sqlite: join(ROOT, 'prisma/schema.sqlite.prisma'),
  mysql: join(ROOT, 'prisma/schema.mysql.prisma'),
}

const checkOnly = process.argv.includes('--check')
const canonical = readFileSync(CANONICAL, 'utf8')
const variants = generateVariants(canonical)

let drifted = 0
for (const [key, path] of Object.entries(TARGETS)) {
  const next = variants[key].endsWith('\n') ? variants[key] : `${variants[key]}\n`
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null

  if (current === next) {
    console.log(`  up to date  ${path.slice(ROOT.length + 1)}`)
    continue
  }

  if (checkOnly) {
    drifted += 1
    console.error(`  DRIFT       ${path.slice(ROOT.length + 1)} differs from canonical schema`)
  } else {
    writeFileSync(path, next)
    console.log(`  wrote       ${path.slice(ROOT.length + 1)}`)
  }
}

if (checkOnly && drifted) {
  console.error(
    `\n${drifted} schema variant(s) are out of date. Run:\n  node scripts/generate-schema-variants.mjs`,
  )
  process.exit(1)
}

if (checkOnly) console.log('PASS: schema variants match the canonical schema.')
