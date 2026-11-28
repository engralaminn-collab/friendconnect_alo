/**
 * AI identity and permission model.
 *
 * FriendConnect already had a single AI participant (Jara) with a global config
 * and an audit log. That is not an *identity system*: it has no per-user scopes,
 * no revocation, and no way to answer "may this AI read this document for this
 * user right now?".
 *
 * This module is that answer. It is deliberately pure: it takes facts and returns
 * a decision, so every rule is unit-testable without a database and the same rules
 * apply to REST, Socket.IO, and any future tool runner.
 *
 * Core invariants (each has a test):
 *  - An AI identity is always disclosed as AI. There is no code path that returns
 *    a human-looking identity for an AI account.
 *  - Permissions are scoped and default-deny. An unknown scope is not granted.
 *  - An AI can never exceed the permissions of the human it acts for.
 *  - A block beats any grant: a user who blocked a human cannot have an AI relay
 *    messages to or from that person.
 *  - Revocation is immediate: decisions are computed per call, never cached in a
 *    long-lived grant object.
 *  - Sensitive actions require an explicit, recorded approval.
 */

export type AIScope =
  | 'read-messages'
  | 'send-messages'
  | 'read-group-context'
  | 'join-audio-calls'
  | 'join-video-calls'
  | 'transcribe-meetings'
  | 'read-documents'
  | 'share-documents'
  | 'send-sms'
  | 'send-email'
  | 'create-reminders'
  | 'execute-workflows'
  | 'access-external-apis'

/** Every scope the system understands. Anything outside this list is denied. */
export const ALL_SCOPES: readonly AIScope[] = [
  'read-messages',
  'send-messages',
  'read-group-context',
  'join-audio-calls',
  'join-video-calls',
  'transcribe-meetings',
  'read-documents',
  'share-documents',
  'send-sms',
  'send-email',
  'create-reminders',
  'execute-workflows',
  'access-external-apis',
] as const

/**
 * Scopes that may never be granted without a per-action human approval, even when
 * the standing grant includes them. These are the irreversible or externally
 * visible actions.
 */
export const APPROVAL_REQUIRED_SCOPES: readonly AIScope[] = [
  'send-sms',
  'send-email',
  'share-documents',
  'execute-workflows',
  'access-external-apis',
  // Joining a call is one decision; recording and transcribing it is another.
  // Without this, "the assistant may join the meeting" would silently authorise
  // transcription, which is exactly the covert-recording behaviour the policy
  // forbids.
  'transcribe-meetings',
] as const

/** The AI's mode, which sets a conservative default grant. */
export type AIMode =
  | 'personal'
  | 'organization'
  | 'group'
  | 'support'
  | 'meeting'
  | 'document'
  | 'research'
  | 'workflow'

/**
 * Default grants per mode.
 *
 * Restricted by design: a meeting assistant gets call and transcription scopes but
 * not messaging, and nothing gets external actions by default. An operator must
 * widen these deliberately.
 */
export const MODE_DEFAULT_SCOPES: Record<AIMode, readonly AIScope[]> = {
  personal: ['read-messages', 'send-messages', 'read-documents', 'create-reminders'],
  organization: ['read-messages', 'send-messages', 'read-group-context', 'read-documents', 'create-reminders'],
  group: ['read-messages', 'send-messages', 'read-group-context', 'read-documents'],
  support: ['read-messages', 'send-messages', 'read-documents'],
  meeting: ['join-audio-calls', 'join-video-calls', 'transcribe-meetings', 'read-documents', 'create-reminders'],
  document: ['read-documents', 'share-documents'],
  research: ['read-documents'],
  workflow: ['create-reminders', 'execute-workflows'],
}

export interface AIIdentity {
  id: string
  displayName: string
  /** Always true for an AI. Present so a caller cannot forget to check. */
  isAI: true
  mode: AIMode
  ownerUserId: string | null
  organizationId: string | null
  status: 'active' | 'suspended' | 'revoked'
  /** Scopes granted to this identity. */
  scopes: readonly AIScope[]
  /** Provider/model this identity currently uses. */
  providerId: string
  model: string
}

export interface ActionContext {
  identity: AIIdentity
  /** The human on whose behalf the AI is acting. `null` for a system action. */
  actingForUserId: string | null
  /** The human whose content is being accessed, when they differ. */
  subjectUserId?: string | null
  /** Scopes this specific user has granted to this specific identity. */
  userGrantedScopes?: readonly AIScope[]
  /** Scopes the acting human themselves holds. AI may not exceed these. */
  humanScopes?: readonly AIScope[]
  /** True when a documented block exists between actingFor and subject. */
  blocked?: boolean
  /** True when a human approved this specific action already. */
  approved?: boolean
  /** Set for group/call actions: whether the AI was explicitly invited. */
  invitedToContext?: boolean
}

export type DenialReason =
  | 'identity-suspended'
  | 'scope-not-granted'
  | 'scope-not-granted-by-user'
  | 'exceeds-human-permission'
  | 'blocked'
  | 'approval-required'
  | 'not-invited'
  | 'unknown-scope'

export interface Decision {
  allowed: boolean
  reason?: DenialReason
  /** Human-readable explanation safe to show in a UI or audit row. */
  detail?: string
}

const deny = (reason: DenialReason, detail: string): Decision => ({ allowed: false, reason, detail })
const ALLOW: Decision = { allowed: true }

/**
 * May this AI perform `scope` in this context?
 *
 * Evaluation order matters and is deliberate:
 *   status → scope exists → grant → user grant → human ceiling → block → approval.
 * A suspension short-circuits everything, and a block short-circuits approval, so
 * an operator approving "send this SMS" cannot override a user's block.
 */
export function authorize(scope: string, context: ActionContext): Decision {
  const { identity } = context

  if (identity.status !== 'active') {
    return deny('identity-suspended', `AI identity ${identity.displayName} is ${identity.status}.`)
  }

  if (!ALL_SCOPES.includes(scope as AIScope)) {
    // Unknown scope is denied rather than ignored: a typo must not become a grant.
    return deny('unknown-scope', `Unknown scope "${scope}".`)
  }
  const requested = scope as AIScope

  if (!identity.scopes.includes(requested)) {
    return deny('scope-not-granted', `${identity.displayName} does not hold the "${requested}" scope.`)
  }

  if (context.userGrantedScopes && !context.userGrantedScopes.includes(requested)) {
    return deny(
      'scope-not-granted-by-user',
      `The user has not granted "${requested}" to ${identity.displayName}.`,
    )
  }

  // The AI is an agent of a human, never a peer with more rights than them.
  if (context.humanScopes && !context.humanScopes.includes(requested)) {
    return deny(
      'exceeds-human-permission',
      `The acting user does not hold "${requested}", so the assistant cannot either.`,
    )
  }

  if (context.blocked) {
    return deny('blocked', 'A block exists between these participants; the assistant may not relay.')
  }

  // Group and call participation require an actual invitation, not just a scope.
  if (
    (requested === 'join-audio-calls' ||
      requested === 'join-video-calls' ||
      requested === 'transcribe-meetings') &&
    context.invitedToContext !== true
  ) {
    return deny('not-invited', 'The assistant has not been invited to this call.')
  }

  // An approval must be an explicit `true`. `undefined` and `false` are both "not
  // approved": treating a supplied `false` as unset would make "the human declined
  // this action" indistinguishable from "nobody asked", which is how a denied
  // action gets retried and eventually succeeds.
  if (APPROVAL_REQUIRED_SCOPES.includes(requested) && context.approved !== true) {
    return deny(
      'approval-required',
      context.approved === false
        ? `The human declined the "${requested}" action.`
        : `"${requested}" requires explicit human approval for each action.`,
    )
  }

  return ALLOW
}

/** Convenience wrapper for a boolean check. */
export function isAllowed(scope: string, context: ActionContext): boolean {
  return authorize(scope, context).allowed
}

/**
 * The identity record as it must be presented to any client.
 *
 * `isAI: true` and a disclosure string are always present. There is no variant of
 * this function that omits them, which is what makes "every AI identity is
 * disclosed" checkable rather than a policy someone remembers.
 */
export function publicAIIdentity(identity: AIIdentity): {
  id: string
  displayName: string
  isAI: true
  badge: string
  disclosure: string
  mode: AIMode
  status: AIIdentity['status']
  providerId: string
  model: string
} {
  return {
    id: identity.id,
    displayName: identity.displayName,
    isAI: true,
    badge: 'AI Assistant',
    disclosure: `${identity.displayName} is an AI assistant, not a human.`,
    mode: identity.mode,
    status: identity.status,
    // Provider and model are shown because a user is entitled to know which model
    // is reading their messages.
    providerId: identity.providerId,
    model: identity.model,
  }
}

/**
 * The scopes an identity actually holds for a user right now.
 *
 * The intersection of the identity's grant, the user's grant, and the human's own
 * permissions — so a UI can show the real, current capability set instead of
 * repeating what was configured months ago.
 */
export function effectiveScopes(context: ActionContext): AIScope[] {
  const { identity, userGrantedScopes, humanScopes } = context
  if (identity.status !== 'active') return []
  return identity.scopes.filter((scope) => {
    if (userGrantedScopes && !userGrantedScopes.includes(scope)) return false
    if (humanScopes && !humanScopes.includes(scope)) return false
    return true
  })
}

/** Build an identity with the conservative default grant for its mode. */
export function defaultIdentity(input: {
  id: string
  displayName: string
  mode: AIMode
  ownerUserId?: string | null
  organizationId?: string | null
  providerId?: string
  model?: string
}): AIIdentity {
  return {
    id: input.id,
    displayName: input.displayName,
    isAI: true,
    mode: input.mode,
    ownerUserId: input.ownerUserId ?? null,
    organizationId: input.organizationId ?? null,
    status: 'active',
    scopes: MODE_DEFAULT_SCOPES[input.mode],
    providerId: input.providerId ?? 'ollama',
    model: input.model ?? 'llama3.2',
  }
}
