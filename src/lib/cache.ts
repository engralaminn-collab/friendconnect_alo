import { logger } from '@/lib/logger'

export interface CacheProvider {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>
  del(key: string): Promise<void>
  incr(key: string, ttlSeconds?: number): Promise<number>
  /** Release connections. Optional: the in-process cache has nothing to close. */
  close?(): Promise<void>
}

class MemoryCache implements CacheProvider {
  private store = new Map<string, { value: unknown; expires: number | null }>()
  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key)
    if (!entry) return null
    if (entry.expires && Date.now() > entry.expires) {
      this.store.delete(key)
      return null
    }
    return entry.value as T
  }
  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.store.set(key, { value, expires: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null })
  }
  async del(key: string): Promise<void> {
    this.store.delete(key)
  }
  async incr(key: string, ttlSeconds?: number): Promise<number> {
    const current = (await this.get<number>(key)) || 0
    const next = current + 1
    await this.set(key, next, ttlSeconds)
    return next
  }
}

class RedisCache implements CacheProvider {
  private client: {
    get: (k: string) => Promise<string | null>
    set: (...args: unknown[]) => Promise<unknown>
    del: (k: string) => Promise<unknown>
    incr: (k: string) => Promise<number>
    expire: (k: string, s: number) => Promise<unknown>
    on: (ev: string, cb: (err: Error) => void) => void
  }

  constructor(url: string) {
    // Dynamic import kept server-side; ioredis is a Node runtime dep.
    const Redis = require('ioredis')
    this.client = new Redis(url, {
      retryStrategy: (times: number) => Math.min(times * 500, 2000),
      maxRetriesPerRequest: 1,
      // Without this, commands issued while the connection is down are queued
      // indefinitely and the awaited promise never settles — which is how a Redis
      // outage turned into hanging requests rather than fast failures.
      enableOfflineQueue: false,
      connectTimeout: 2000,
      commandTimeout: 2000,
    })
    // ioredis emits 'error' on every reconnect attempt (every ~2s by default).
    // Logging each one floods the log during an outage; the ResilientCache
    // reports the state change once instead.
    let lastLoggedAt = 0
    this.client.on('error', (err: Error) => {
      const now = Date.now()
      if (now - lastLoggedAt > 60_000) {
        lastLoggedAt = now
        logger.warn('redis error', { error: err.message })
      }
    })
    this.client.on('connect', () => logger.info('redis connected'))
    this.client.on('end', () => logger.warn('redis connection closed'))
  }
  async get<T>(key: string): Promise<T | null> {
    const val = await this.client.get(key)
    return val ? (JSON.parse(val) as T) : null
  }
  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const val = JSON.stringify(value)
    if (ttlSeconds) await this.client.set(key, val, 'EX', ttlSeconds)
    else await this.client.set(key, val)
  }
  async del(key: string): Promise<void> {
    await this.client.del(key)
  }
  async incr(key: string, ttlSeconds?: number): Promise<number> {
    const count = await this.client.incr(key)
    if (count === 1 && ttlSeconds) await this.client.expire(key, ttlSeconds)
    return count
  }

  /** Stop reconnecting. Used on shutdown and by tests. */
  async close(): Promise<void> {
    const client = this.client as unknown as { quit?: () => Promise<unknown>; disconnect?: () => void }
    try {
      await client.quit?.()
    } catch {
      client.disconnect?.()
    }
  }
}

/** Upper bound on any single Redis round-trip in the auth path. */
const REDIS_OPERATION_TIMEOUT_MS = 2000

let _cache: CacheProvider | null = null

/**
 * A Redis-backed cache with a memory fallback that is used only while Redis is
 * unreachable.
 *
 * Finding #11: `rateLimit()` called `cache.incr()` unguarded. With REDIS_URL set
 * but the server down, ioredis rejects, the exception propagates out of the
 * auth route and the user gets a 500 — a Redis outage became a login outage.
 * Moreover `getCache()` chose the provider once, so a Redis instance that died
 * after boot kept the process failing forever.
 *
 * Policy:
 *   - a Redis error never propagates to the caller,
 *   - the request is *not* silently allowed: the in-process limiter still
 *     applies, so throttling degrades to per-instance instead of disappearing,
 *   - failures are logged once per state change, not per request.
 */
class ResilientCache implements CacheProvider {
  private primary: RedisCache | null
  private local = new MemoryCache()
  private redisHealthy: boolean
  private lastErrorAt = 0

  constructor(redisUrl: string | null) {
    this.primary = redisUrl ? new RedisCache(redisUrl) : null
    this.redisHealthy = Boolean(this.primary)
  }

  private noteFailure(operation: string, error: unknown) {
    this.redisHealthy = false
    const now = Date.now()
    // Log at most once every 30s so a sustained outage cannot flood the log.
    if (now - this.lastErrorAt > 30_000) {
      this.lastErrorAt = now
      logger.error('redis unavailable; using in-process cache', {
        operation,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private noteSuccess() {
    if (!this.redisHealthy && this.primary) {
      this.redisHealthy = true
      logger.info('redis recovered')
    }
  }

  private async attempt<T>(
    operation: string,
    run: (cache: RedisCache) => Promise<T>,
    fallback: () => Promise<T>,
  ): Promise<T> {
    if (!this.primary) return fallback()
    try {
      // Hard ceiling: an auth route must never wait on the cache.
      const result = await Promise.race([
        run(this.primary),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('redis operation timed out')), REDIS_OPERATION_TIMEOUT_MS).unref?.(),
        ),
      ])
      this.noteSuccess()
      return result
    } catch (error) {
      this.noteFailure(operation, error)
      return fallback()
    }
  }

  async get<T>(key: string): Promise<T | null> {
    return this.attempt('get', (cache) => cache.get<T>(key), () => this.local.get<T>(key))
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    // Always write locally too: it is what serves requests during an outage.
    await this.local.set(key, value, ttlSeconds)
    return this.attempt('set', (cache) => cache.set(key, value, ttlSeconds), async () => undefined)
  }

  async del(key: string): Promise<void> {
    await this.local.del(key)
    return this.attempt('del', (cache) => cache.del(key), async () => undefined)
  }

  async close(): Promise<void> {
    await this.primary?.close()
    this.primary = null
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    // Count locally as well, so the local counter keeps rising while Redis is
    // down; otherwise every failed Redis call would report "1" and the limit
    // would never trip.
    const localCount = await this.local.incr(key, ttlSeconds)
    if (!this.primary) return localCount
    try {
      const remote = await this.primary.incr(key, ttlSeconds)
      this.noteSuccess()
      // Use the larger count: after a failover the remote counter may lag.
      return Math.max(remote, localCount)
    } catch (error) {
      this.noteFailure('incr', error)
      return localCount
    }
  }
}

export function getCache(): CacheProvider {
  if (_cache) return _cache
  const redisUrl = process.env.REDIS_URL
  if (redisUrl) {
    try {
      _cache = new ResilientCache(redisUrl)
      logger.info('cache provider: redis (in-process fallback armed)')
    } catch (e: unknown) {
      const err = e as Error
      logger.warn('redis init failed, using in-process cache', { error: err?.message })
      _cache = new MemoryCache()
    }
  } else {
    _cache = new MemoryCache()
    logger.info('cache provider: memory (single-process)')
  }
  return _cache
}

/** True when a Redis URL is configured (not necessarily reachable). */
export function isRedisAvailable(): boolean {
  return !!process.env.REDIS_URL
}

/**
 * Release the cache's connections and forget the singleton.
 *
 * Called by the shutdown path and by tests: an ioredis client with a retry
 * strategy keeps the event loop alive, so a process that only used the cache
 * would never exit on its own.
 */
export async function closeCache(): Promise<void> {
  const cache = _cache
  _cache = null
  await cache?.close?.()
}

export async function rateLimit(
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number }> {
  const cache = getCache()
  const count = await cache.incr(key, windowSeconds)
  return { allowed: count <= maxRequests, remaining: Math.max(0, maxRequests - count) }
}
