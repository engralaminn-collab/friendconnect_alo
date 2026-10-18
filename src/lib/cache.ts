import { logger } from '@/lib/logger'

export interface CacheProvider {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>
  del(key: string): Promise<void>
  incr(key: string, ttlSeconds?: number): Promise<number>
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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Redis = require('ioredis')
    this.client = new Redis(url, { retryStrategy: (times: number) => Math.min(times * 500, 2000), maxRetriesPerRequest: 2 })
    this.client.on('error', (err: Error) => logger.error('redis error', { error: err.message }))
    this.client.on('connect', () => logger.info('redis connected'))
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
}

let _cache: CacheProvider | null = null

export function getCache(): CacheProvider {
  if (_cache) return _cache
  const redisUrl = process.env.REDIS_URL
  if (redisUrl) {
    try {
      _cache = new RedisCache(redisUrl)
      logger.info('cache provider: redis')
    } catch (e: unknown) {
      const err = e as Error
      logger.warn('redis init failed, falling back to memory', { error: err?.message })
      _cache = new MemoryCache()
    }
  } else {
    _cache = new MemoryCache()
    logger.info('cache provider: memory (single-process)')
  }
  return _cache
}

export function isRedisAvailable(): boolean {
  return !!process.env.REDIS_URL
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
