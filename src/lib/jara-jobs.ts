/**
 * Jara durable job registry — Temporal-inspired semantics on FriendConnect's DB.
 *
 * This is NOT Temporal and does not replace it. It deliberately implements the
 * three properties that matter most for Jara's long-running work (avatar video
 * renders, SMS batches, knowledge reindexing):
 *
 *   1. Durability      — the job record survives restarts (PostgreSQL/MySQL/
 *                        SQLite row, not process memory).
 *   2. Idempotency     — `idempotencyKey` is unique; re-enqueueing the same
 *                        logical job returns the existing record.
 *   3. Bounded retries — exponential backoff with a hard ceiling, then a
 *                        terminal `failed` state for human review.
 *
 * There is intentionally no autonomous worker loop here. Claiming a job is an
 * explicit act (renderer dispatch, SMS sender, an operator/system), so nothing
 * executes just because a row exists. If the org approves Temporal later, this
 * table becomes a staging/outbox in front of it.
 *
 * Pure helpers (backoff math, transitions) are exported for unit tests; the
 * database is imported lazily so this module is safe to load anywhere.
 */

export type JaraJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export class JaraJobStoreError extends Error {
  readonly code = 'JARA_JOB_STORE_ERROR'
  constructor(message: string) {
    super(message)
    this.name = 'JaraJobStoreError'
  }
}

export const JARA_JOB_MAX_BACKOFF_MS = 30 * 60 * 1000 // 30 minutes
export const JARA_JOB_MIN_ATTEMPTS = 1
export const JARA_JOB_MAX_ATTEMPTS = 10

export function computeBackoffMs(attempts: number): number {
  const safeAttempts = Math.max(1, Math.floor(Number(attempts) || 1))
  const raw = Math.pow(2, safeAttempts) * 1000
  return Math.min(JARA_JOB_MAX_BACKOFF_MS, raw)
}

export function nextRetryRun(attempts: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + computeBackoffMs(attempts))
}

const ALLOWED_TRANSITIONS: Record<JaraJobStatus, JaraJobStatus[]> = {
  pending: ['running', 'cancelled', 'failed'],
  running: ['completed', 'failed', 'cancelled', 'pending'],
  completed: [],
  failed: ['pending'], // explicit operator retry only
  cancelled: [],
}

export function canTransition(from: JaraJobStatus, to: JaraJobStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] || []).includes(to)
}

export interface EnqueueJobInput {
  type: string
  payload?: unknown
  idempotencyKey?: string
  maxAttempts?: number
  createdBy?: string | null
}

export interface JobRecord {
  id: string
  type: string
  status: string
  payload: string | null
  result: string | null
  error: string | null
  attempts: number
  maxAttempts: number
  idempotencyKey: string | null
  runAfter: Date
  startedAt: Date | null
  completedAt: Date | null
  createdBy: string | null
  createdAt: Date
  updatedAt: Date
}

async function store(): Promise<any> {
  try {
    const { db } = await import('@/lib/db')
    return (db as any).jaraJob
  } catch (e: any) {
    throw new JaraJobStoreError(`Jara job store unavailable: ${e?.message || e}`)
  }
}

async function withStore<T>(fn: (jobs: any) => Promise<T>): Promise<T> {
  const jobs = await store()
  try {
    return await fn(jobs)
  } catch (e: any) {
    if (e instanceof JaraJobStoreError) throw e
    throw new JaraJobStoreError(e?.message || String(e))
  }
}

/** Enqueue (or return the existing record for the same idempotency key). */
export async function enqueueJob(input: EnqueueJobInput): Promise<JobRecord> {
  const type = String(input?.type || '').trim()
  if (!type) throw new JaraJobStoreError('Job type is required')
  const maxAttempts = Math.max(JARA_JOB_MIN_ATTEMPTS, Math.min(JARA_JOB_MAX_ATTEMPTS, Math.floor(Number(input.maxAttempts) || 3)))
  const idempotencyKey = input.idempotencyKey?.trim() || null
  const payload = input.payload === undefined ? null : JSON.stringify(input.payload)

  return withStore(async (jobs) => {
    if (idempotencyKey) {
      const existing = await jobs.findUnique({ where: { idempotencyKey } }).catch(() => null)
      if (existing) return existing as JobRecord
    }
    return (await jobs.create({
      data: {
        type,
        payload,
        idempotencyKey,
        maxAttempts,
        status: 'pending' satisfies JaraJobStatus,
        createdBy: input.createdBy || null,
      },
    })) as JobRecord
  })
}

/**
 * Claim the oldest due pending job of the given types. Explicit act — callers
 * must be authenticated system components, never Jara chat output.
 */
export async function claimNextPendingJob(types?: string[]): Promise<JobRecord | null> {
  return withStore(async (jobs) => {
    const now = new Date()
    const where: any = { status: 'pending', runAfter: { lte: now } }
    if (types && types.length > 0) where.type = { in: types }
    const candidate = await jobs.findFirst({ where, orderBy: { runAfter: 'asc' } })
    if (!candidate) return null
    const claimed = await jobs.updateMany({
      where: { id: candidate.id, status: 'pending' },
      data: { status: 'running', startedAt: now, attempts: { increment: 1 } },
    })
    if (!claimed?.count) return null // lost the race to another worker
    return (await jobs.findUnique({ where: { id: candidate.id } })) as JobRecord
  })
}

export async function completeJob(id: string, result?: unknown): Promise<JobRecord> {
  return withStore(async (jobs) => {
    const job = await jobs.findUnique({ where: { id } }).catch(() => null)
    if (!job) throw new JaraJobStoreError(`Job ${id} not found`)
    if (!canTransition(job.status, 'completed')) {
      throw new JaraJobStoreError(`Job ${id} cannot move from ${job.status} to completed`)
    }
    return (await jobs.update({
      where: { id },
      data: { status: 'completed', result: result === undefined ? null : JSON.stringify(result), completedAt: new Date(), error: null },
    })) as JobRecord
  })
}

export async function failJob(id: string, error: string): Promise<JobRecord> {
  return withStore(async (jobs) => {
    const job = await jobs.findUnique({ where: { id } }).catch(() => null)
    if (!job) throw new JaraJobStoreError(`Job ${id} not found`)
    const attempts = Number(job.attempts || 0) + (job.status === 'running' ? 0 : 1)
    const exhausted = attempts >= Number(job.maxAttempts || 3)
    if (!canTransition(job.status, exhausted ? 'failed' : 'pending')) {
      throw new JaraJobStoreError(`Job ${id} cannot move from ${job.status}`)
    }
    return (await jobs.update({
      where: { id },
      data: exhausted
        ? { status: 'failed', attempts, error: String(error || 'unknown error').slice(0, 2000), completedAt: new Date() }
        : { status: 'pending', attempts, error: String(error || 'unknown error').slice(0, 2000), runAfter: nextRetryRun(attempts) },
    })) as JobRecord
  })
}

export async function cancelJob(id: string): Promise<JobRecord> {
  return withStore(async (jobs) => {
    const job = await jobs.findUnique({ where: { id } }).catch(() => null)
    if (!job) throw new JaraJobStoreError(`Job ${id} not found`)
    if (!canTransition(job.status, 'cancelled')) {
      throw new JaraJobStoreError(`Job ${id} cannot be cancelled from ${job.status}`)
    }
    return (await jobs.update({ where: { id }, data: { status: 'cancelled', completedAt: new Date() } })) as JobRecord
  })
}

export async function listJobs(options: { status?: string; limit?: number } = {}): Promise<JobRecord[]> {
  return withStore(async (jobs) => {
    const where: any = {}
    if (options.status && ['pending', 'running', 'completed', 'failed', 'cancelled'].includes(options.status)) {
      where.status = options.status
    }
    const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 25)))
    return (await jobs.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit })) as JobRecord[]
  })
}

export async function jobStats(): Promise<Record<JaraJobStatus, number>> {
  const empty: Record<JaraJobStatus, number> = { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0 }
  return withStore(async (jobs) => {
    const rows = await jobs.groupBy({ by: ['status'], _count: { _all: true } })
    const out = { ...empty }
    for (const row of rows || []) {
      const status = String(row?.status) as JaraJobStatus
      if (status in out) out[status] = Number(row?._count?._all || 0)
    }
    return out
  })
}
