export type ChatTurn = { role: 'user' | 'assistant'; content: string }

export type ChatInputResult =
  | { ok: true; messages: ChatTurn[] }
  | { ok: false; error: 'invalid_messages' | 'invalid_turn' | 'message_too_long' | 'conversation_too_long' | 'last_turn_must_be_user' }

const MAX_INPUT_TURNS = 40
const MAX_CONTEXT_TURNS = 24
const MAX_TURN_CHARACTERS = 6000
const MAX_TOTAL_CHARACTERS = 20_000

type DeletionMarkedMessage = { deletedFor?: string | null; senderId?: string | null }

/**
 * The canonical Message.deletedFor format is "everyone" or a comma-separated
 * list of user IDs. The legacy literal "me" meant hidden from its sender.
 */
export function isMessageDeletedForUser(message: DeletionMarkedMessage, userId: string): boolean {
  const raw = typeof message.deletedFor === 'string' ? message.deletedFor.trim() : ''
  if (!raw) return false
  if (raw === 'everyone') return true
  if (raw === 'me') return message.senderId === userId
  return raw.split(',').map((id) => id.trim()).filter(Boolean).includes(userId)
}

export function filterMessagesVisibleToUser<T>(rows: T[], userId: string): T[] {
  return rows.filter((row) => !isMessageDeletedForUser(row as DeletionMarkedMessage, userId))
}

/** Validate untrusted browser history before it reaches any provider prompt. */
export function normalizeChatInput(value: unknown): ChatInputResult {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_INPUT_TURNS) {
    return { ok: false, error: 'invalid_messages' }
  }

  const turns: ChatTurn[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return { ok: false, error: 'invalid_turn' }
    const turn = item as Record<string, unknown>
    if (turn.role !== 'user' && turn.role !== 'assistant') return { ok: false, error: 'invalid_turn' }
    if (typeof turn.content !== 'string' || !turn.content.trim()) return { ok: false, error: 'invalid_turn' }
    if (turn.content.length > MAX_TURN_CHARACTERS) return { ok: false, error: 'message_too_long' }
    turns.push({ role: turn.role, content: turn.content.trim() })
  }

  const bounded = turns.slice(-MAX_CONTEXT_TURNS)
  if (bounded[bounded.length - 1]?.role !== 'user') return { ok: false, error: 'last_turn_must_be_user' }
  if (bounded.reduce((total, turn) => total + turn.content.length, 0) > MAX_TOTAL_CHARACTERS) {
    return { ok: false, error: 'conversation_too_long' }
  }
  return { ok: true, messages: bounded }
}

/** Build a bounded context from persisted 1:1 Jara messages, never from another user's history. */
export function buildJaraConversationContext(
  rows: Array<{ senderId?: string; receiverId?: string | null; content?: string; deletedFor?: string; expiresAt?: Date | string | null; scheduledFor?: Date | string | null }>,
  userId: string,
  jaraId: string,
  latestUserMessage: string,
  now = Date.now(),
): ChatTurn[] {
  const turns: ChatTurn[] = []
  for (const row of rows) {
    if (isMessageDeletedForUser(row, userId)) continue
    if (row.expiresAt && new Date(row.expiresAt).getTime() <= now) continue
    if (row.scheduledFor && new Date(row.scheduledFor).getTime() > now) continue
    if (typeof row.content !== 'string' || !row.content.trim()) continue

    if (row.senderId === userId && row.receiverId === jaraId) {
      turns.push({ role: 'user', content: row.content.slice(0, MAX_TURN_CHARACTERS) })
    } else if (row.senderId === jaraId && row.receiverId === userId) {
      turns.push({ role: 'assistant', content: row.content.slice(0, MAX_TURN_CHARACTERS) })
    }
  }

  turns.reverse()
  const latest = latestUserMessage.trim().slice(0, MAX_TURN_CHARACTERS)
  const finalTurn = turns[turns.length - 1]
  if (finalTurn?.role !== 'user' || finalTurn.content !== latest) turns.push({ role: 'user', content: latest })

  const bounded = turns.slice(-MAX_CONTEXT_TURNS)
  let total = bounded.reduce((sum, turn) => sum + turn.content.length, 0)
  while (bounded.length > 1 && total > MAX_TOTAL_CHARACTERS) {
    total -= bounded.shift()!.content.length
  }
  return bounded
}

/** Build the exact group-context text sent to Jara after applying per-user visibility. */
export function buildJaraGroupConversationContext(
  rows: Array<{
    senderId?: string | null
    content?: string | null
    deletedFor?: string | null
    expiresAt?: Date | string | null
    scheduledFor?: Date | string | null
  }>,
  userId: string,
  jaraId: string,
  groupName: string,
  latestMessage: string,
  now = Date.now(),
): string {
  const context = filterMessagesVisibleToUser(rows, userId)
    .filter((row) => {
      if (row.expiresAt && new Date(row.expiresAt).getTime() <= now) return false
      if (row.scheduledFor && new Date(row.scheduledFor).getTime() > now) return false
      return typeof row.content === 'string' && !!row.content.trim()
    })
    .map((row) => `${row.senderId === jaraId ? 'Jara' : row.senderId === userId ? 'User' : 'Member'}: ${String(row.content).slice(0, 1200)}`)
    .join('\n')
    .slice(-12000)

  return `Group "${groupName.slice(0, 160)}" context:\n${context}\n\nLatest message: ${latestMessage}\n\nRespond as Jara to the group. Keep it friendly, concise (2-3 sentences), and in the user's language.`
}
