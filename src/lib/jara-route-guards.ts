import { errorJson } from '@/lib/serialize'

/**
 * Guards for the Jara routes that translate an internal exception into a
 * client-safe response.
 *
 * Audit finding: the exception-to-response conversion was ad hoc per route. Some
 * routes were correct (a fixed string keyed off the status); two published
 * `e?.message`, which means a failure caused by anything other than the condition
 * the route expected — a database error while reading a feature switch, say —
 * reached the caller as raw exception text.
 */

type GuardFailure = { status: number; message: string }

/**
 * Publish a feature-gate failure without echoing the internal reason.
 *
 * `assertJaraEnabled()` throws with a `status` and an internal message. Two routes
 * answered `errorJson(e?.message || 'Jara unavailable', ...)`, so a 403 caused by
 * anything other than the feature switch — including a database error raised
 * while reading the switch — reached the client as the raw exception text.
 */
export function featureGateFailure(
  error: unknown,
  fallbackStatus = 403,
): ReturnType<typeof errorJson> {
  const candidate = error as { status?: unknown } | null | undefined
  const status = typeof candidate?.status === 'number' ? candidate.status : fallbackStatus
  if (status === 503) return errorJson(DISABLED_MESSAGE, 503)
  if (status === 401) return errorJson('Unauthorized', 401)
  if (status === 403) return errorJson('Forbidden', 403)
  return errorJson('Jara is temporarily unavailable', status >= 400 && status < 600 ? status : 503)
}

export const DISABLED_MESSAGE = 'Jara AI is currently disabled by a Super Admin.'

/**
 * A user-input validation failure: a message and a 4xx status that the route
 * itself constructed for the caller.
 *
 * Only errors that explicitly carry a 4xx `status` are considered safe to
 * publish. Anything else (a TypeError from a missing field, a driver error) is
 * a bug, and its text must not reach the client.
 */
export function validationFailure(error: unknown, fallback: string): GuardFailure {
  const candidate = error as { message?: unknown; status?: unknown } | null
  const status = typeof candidate?.status === 'number' ? candidate.status : 0
  const message = typeof candidate?.message === 'string' ? candidate.message : ''
  if (status >= 400 && status < 500 && message) {
    return { status, message: message.slice(0, 300) }
  }
  return { status: 400, message: fallback }
}

