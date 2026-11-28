#!/usr/bin/env node
/**
 * Verify the production Dockerfiles ship every module the realtime server needs.
 *
 * Audit findings 2 and 3 were both image-manifest bugs that no existing test
 * could catch: `next build` passed, lint passed, and the container even started —
 * the failure only appeared when `socket-server.js` was launched and
 * `require('./src/lib/socket-security.cjs')` threw MODULE_NOT_FOUND.
 *
 * This check is deliberately static: it parses the Dockerfiles and the
 * `require()` calls in the files that run outside the Next.js build graph. It
 * runs in CI, so a future edit that adds a require without adding a COPY fails
 * here instead of in production.
 *
 * Exit codes: 0 = consistent, 1 = a required file is not copied.
 */
import { readFileSync, existsSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, join, normalize, relative, resolve } from 'node:path'

const ROOT = resolve(process.cwd())

/** Files that are started directly by `node`, outside the bundler. */
const ENTRYPOINTS = ['socket-server.js', 'scripts/turn-server.js']

/** Dockerfiles to check, and whether they are expected to ship the socket server. */
const IMAGES = [
  { file: 'Dockerfile', shipsRealtime: true },
  { file: 'deploy/Dockerfile.app', shipsRealtime: true },
]

const problems = []

/**
 * Collect every relative `require('./x')` reachable from the entrypoints, so the
 * check follows the real dependency chain instead of a hardcoded list that would
 * drift the moment someone adds an import.
 */
function collectLocalRequires(entry, seen = new Set()) {
  const rel = relative(ROOT, join(ROOT, entry)).split('\\').join('/')
  if (seen.has(rel)) return seen
  seen.add(rel)
  const abs = join(ROOT, rel)
  if (!existsSync(abs)) {
    problems.push(`${entry}: required file does not exist in the repository`)
    return seen
  }
  const src = readFileSync(abs, 'utf8')
  const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g
  let match
  while ((match = re.exec(src))) {
    const target = match[1]
    const resolvedBase = normalize(join(dirname(abs), target))
    // Try the literal path, then the usual extensions, mirroring Node's lookup.
    const candidates = [resolvedBase, `${resolvedBase}.js`, `${resolvedBase}.cjs`]
    const hit = candidates.find((c) => existsSync(c))
    if (!hit) {
      problems.push(`${entry}: require('${target}') resolves to nothing`)
      continue
    }
    // Compare and recurse using a repo-relative, forward-slash path so a
    // Windows-style or otherwise non-normalised absolute path cannot slip
    // through the isShipped() comparison.
    collectLocalRequires(relative(ROOT, hit).split('\\').join('/'), seen)
  }
  return seen
}

function dockerfileCopies(file) {
  if (!existsSync(join(ROOT, file))) {
    problems.push(`${file}: file is missing`)
    return new Set()
  }
  const src = readFileSync(join(ROOT, file), 'utf8')
  // Only COPY instructions in the final runner stage matter. The previous parser
  // scanned every stage, saw the builder's broad `COPY ... node_modules`, and
  // falsely concluded the runner contained every package. That made the new
  // runtime-module check a no-op.
  const runnerMatch = src.match(/^FROM\s+\S+\s+AS\s+runner\s*$([\s\S]*)/im)
  if (!runnerMatch) {
    problems.push(`${file}: has no final stage named runner`)
    return new Set()
  }
  const runner = runnerMatch[1]
  const copied = new Set()
  const re = /^\s*COPY\s+--from=\S+\s+(\S+)\s+\S+\s*$/gm
  let match
  while ((match = re.exec(runner))) {
    // Strip a leading /app/ so paths compare like-for-like with the repo.
    copied.add(match[1].replace(/^\/app\//, '').replace(/^\.\//, ''))
  }
  // A COPY of a whole directory provides everything inside it.
  return copied
}

/** Does any COPY in the image provide this repo-relative path? */
function isShipped(copied, relPath) {
  if (copied.has(relPath)) return true
  for (const entry of copied) {
    // A copied directory provides all descendants. Dockerfile source paths do
    // not need a trailing slash (`/app/node_modules/@prisma` is a directory), so
    // requiring `entry.endsWith('/')` made directory copies invisible.
    if (relPath.startsWith(`${entry.replace(/\/$/, '')}/`)) return true
    // `COPY --from=builder /app/node_modules ./node_modules` ships all of them.
    if (relPath.startsWith('node_modules/') && entry === 'node_modules') return true
  }
  return false
}

for (const image of IMAGES) {
  const copied = dockerfileCopies(image.file)
  if (!image.shipsRealtime) continue
  for (const entry of ENTRYPOINTS) {
    if (!isShipped(copied, entry)) {
      problems.push(`${image.file}: does not COPY the entrypoint ${entry}`)
      continue
    }
    for (const dep of collectLocalRequires(entry)) {
      if (!isShipped(copied, dep)) {
        problems.push(`${image.file}: ${dep} is required at runtime but never COPY'd into the image`)
      }
    }
  }
}

/**
 * Third-party modules the image must contain.
 *
 * This is the check that was missing, and it is why the container failed twice:
 * the image copied `socket.io` but not `sharp`, `@prisma/client` or the Prisma
 * adapters. The build succeeded and the container threw MODULE_NOT_FOUND the
 * moment the realtime server or the upload path ran.
 *
 * Two sources, because neither alone is sufficient:
 *
 *  - traced: everything plainly `require`d from the entrypoints and the local
 *    modules they reach, so adding an import cannot silently fall out of date.
 *  - lazy: modules required *inside a function body* in files the entrypoints do
 *    not reach (`sharp` in `src/lib/upload-security.cjs`). Nothing can trace those
 *    statically, so they are listed with the reason they are needed.
 */
const LAZY_RUNTIME_MODULES = {
  sharp: 'src/lib/upload-security.cjs requires it lazily, only when processing an image',
}

/** Directories produced by a build step rather than committed. */
const GENERATED_MODULES = new Set(['node_modules/.prisma'])

/** Every non-builtin module required by the entrypoints and their local deps. */
function requiredThirdParty() {
  const names = new Set(Object.keys(LAZY_RUNTIME_MODULES))
  // `turn-server.js` is an optional developer fallback that deliberately exits
  // cleanly when `node-turn` is absent; production Compose uses the maintained
  // coturn image. Only mandatory entrypoints contribute required packages.
  const mandatoryEntrypoints = ['socket-server.js']
  const files = new Set(mandatoryEntrypoints)
  for (const entry of mandatoryEntrypoints) {
    for (const dep of collectLocalRequires(entry)) files.add(dep)
  }
  // Also scan the CommonJS/JS modules the image ships explicitly: the app root
  // server requires them, and they are the other half of the runtime graph.
  for (const extra of ['src/lib/upload-security.cjs']) {
    if (existsSync(join(ROOT, extra))) files.add(extra)
  }
  const re = /require\(\s*['"]([^./][^'"]*)['"]\s*\)/g
  for (const file of files) {
    const abs = join(ROOT, file)
    if (!existsSync(abs)) continue
    let match
    const src = readFileSync(abs, 'utf8')
    while ((match = re.exec(src))) {
      const raw = match[1]
      if (raw.startsWith('node:') || BUILTINS.has(raw)) continue
      // "socket.io/redis-adapter" -> "socket.io"; "@socket.io/x" -> "@socket.io/x"
      names.add(raw.startsWith('@') ? raw.split('/').slice(0, 2).join('/') : raw.split('/')[0])
    }
  }
  return names
}

// Third-party modules required by the realtime server must be real dependencies.
const SOCKET = readFileSync(join(ROOT, 'socket-server.js'), 'utf8')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const declared = new Set([
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.optionalDependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
])
const BUILTINS = new Set(builtinModules)
const pkgRe = /require\(\s*['"]([^./][^'"]*)['"]\s*\)/g
const thirdParty = new Set()
let m
while ((m = pkgRe.exec(SOCKET))) {
  // "socket.io/redis-adapter" -> "socket.io"
  const name = m[1].startsWith('@') ? m[1].split('/').slice(0, 2).join('/') : m[1].split('/')[0]
  if (name.startsWith('node:') || BUILTINS.has(name)) continue
  thirdParty.add(name)
}
for (const name of thirdParty) {
  if (!declared.has(name)) {
    problems.push(`socket-server.js requires "${name}" but package.json does not declare it`)
  }
}

// Runtime modules must be COPY'd into every image that ships the realtime server.
const runtimeModules = requiredThirdParty()
for (const image of IMAGES) {
  if (!image.shipsRealtime) continue
  const copied = dockerfileCopies(image.file)
  for (const name of runtimeModules) {
    if (declared.has(name) && GENERATED_MODULES.has(`node_modules/${name}`)) continue
    if (!isShipped(copied, `node_modules/${name}`)) {
      problems.push(
        `${image.file}: "${name}" is required at runtime but node_modules/${name} is never COPY'd into the image`,
      )
    }
  }
}

if (problems.length) {
  console.error('Docker image manifest check FAILED:')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(`Docker image manifest check PASSED (${IMAGES.length} images checked).`)
