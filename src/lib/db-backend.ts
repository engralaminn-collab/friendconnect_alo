/**
 * Database client selection.
 *
 * One explicit decision, logged once, with no silent fallback.
 *
 * The old implementation wrapped `new PrismaClient()` in a try/catch and, on
 * *any* throw — a missing generated client, a transient connection error, a typo
 * in DATABASE_URL — quietly swapped in the hand-rolled SQLite runtime. Those two
 * paths do not behave the same: SQLite lacks the Prisma engine's migration
 * history, so an app that silently degraded would read and write a *different
 * database* than the operator intended. That is the worst possible failure mode
 * for a product whose main job is storing messages.
 *
 * Selection rules:
 *   - DATABASE_URL starts with mysql:// or mariadb://  -> Prisma (MySQL)
 *   - DB_ENGINE=prisma                                 -> Prisma (SQLite via adapter)
 *   - DATABASE_URL starts with file:                   -> SQLite fallback runtime
 *
 * If the chosen backend cannot initialise, the process fails. It never switches.
 * `DB_ALLOW_SQLITE_FALLBACK=true` re-enables a *logged* fallback for local
 * development only; it is ignored when NODE_ENV=production.
 */

import { logger } from './logger'

export type BackendKind = 'prisma-mysql' | 'prisma-sqlite' | 'sqlite-runtime'

export interface BackendInfo {
  kind: BackendKind
  /** Human-readable one-liner for the boot log. */
  description: string
  /** True when the fallback runtime is serving requests. */
  usesFallbackRuntime: boolean
}

function describe(url: string, engine: string | undefined): BackendInfo {
  const isMysql = /^(mysql|mariadb):\/\//i.test(url)
  const wantsPrisma = isMysql || engine === 'prisma'

  if (wantsPrisma) {
    return isMysql
      ? {
          kind: 'prisma-mysql',
          description: 'Prisma Client with the MariaDB driver adapter',
          usesFallbackRuntime: false,
        }
      : {
          kind: 'prisma-sqlite',
          description: 'Prisma Client with the better-sqlite3 driver adapter',
          usesFallbackRuntime: false,
        }
  }

  return {
    kind: 'sqlite-runtime',
    description: 'built-in SQLite runtime (better-sqlite3, generated schema)',
    usesFallbackRuntime: true,
  }
}

let cached: { client: unknown; info: BackendInfo } | null = null

/**
 * A client that connects on first use instead of at import time.
 *
 * Next.js imports route modules during `next build` to collect their config, so
 * connecting eagerly made the build require a reachable database — which is not
 * a real dependency of a build. This proxy defers `selectBackend()` until the
 * first query, and throws the same explicit error then.
 */
export function createLazyClient(): unknown {
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (property === 'then' || property === 'toJSON') return undefined
        if (property === Symbol.toStringTag) return 'DatabaseClient'
        const client = selectBackend().client as Record<string | symbol, unknown>
        const value = client[property as string]
        return typeof value === 'function' ? value.bind(client) : value
      },
      has(_target, property) {
        const client = selectBackend().client as object
        return property in client
      },
    },
  )
}

export function selectBackend(): { client: unknown; info: BackendInfo } {
  if (cached) return cached

  const url = process.env.DATABASE_URL ?? ''
  const engine = process.env.DB_ENGINE

  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Set it in .env (see .env.example) — for local ' +
        'development, DATABASE_URL="file:./db/custom.db".',
    )
  }

  const info = describe(url, engine)
  let client: unknown

  if (info.usesFallbackRuntime) {
    const runtime = require('./db-runtime.js')
    client = runtime.prisma
  } else {
    try {
      // db-runtime.js builds the Prisma client with the right driver adapter for
      // the URL, and throws a descriptive error when the client is not generated.
      const runtime = require('./db-runtime.js')
      client = runtime.prisma
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const allowFallback =
        process.env.DB_ALLOW_SQLITE_FALLBACK === 'true' && process.env.NODE_ENV !== 'production'

      if (!allowFallback) {
        throw new Error(
          `Database backend "${info.kind}" failed to initialise: ${message}\n` +
            'Refusing to start rather than silently switching engines. ' +
            'Fix DATABASE_URL / run `npx prisma generate`, or set ' +
            'DB_ALLOW_SQLITE_FALLBACK=true for local development only.',
        )
      }

      logger.warn('database: falling back to the SQLite runtime (DB_ALLOW_SQLITE_FALLBACK=true)', {
        requested: info.kind,
        error: message,
      })
      const runtime = require('./db-runtime.js')
      client = (runtime as { prisma?: unknown }).prisma
      info.kind = 'sqlite-runtime'
      info.usesFallbackRuntime = true
      info.description = 'built-in SQLite runtime (explicit fallback)'
    }
  }

  if (!client) {
    throw new Error(`Database backend "${info.kind}" produced no client.`)
  }

  logger.info('database backend selected', {
    backend: info.kind,
    detail: info.description,
    engine: /^(mysql|mariadb):\/\//i.test(url) ? 'mysql' : 'sqlite',
    // Never log the full URL: it carries credentials.
    target: url.replace(/\/\/[^@]*@/, '//***@').slice(0, 80),
  })

  cached = { client, info }
  return cached
}

/** Metadata about the active backend (for /api/health and diagnostics). */
export function getBackendInfo(): BackendInfo | null {
  return cached?.info ?? null
}

/** Test hook: forget the cached selection. */
export function resetBackendForTests(): void {
  cached = null
}
