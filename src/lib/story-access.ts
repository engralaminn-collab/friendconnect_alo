/**
 * Story view authorization (audit finding 30).
 *
 * A story view is a write that reveals to the story owner who looked at the
 * story, so it must be authorized before it is recorded:
 *
 *  - an expired, non-highlight story is not viewable by anyone;
 *  - the owner may open their own story, but that is not recorded as a view;
 *  - any block between viewer and owner (either direction) denies access;
 *  - otherwise only an accepted friend may view.
 *
 * Denials are reported to the client as 404 so a caller cannot probe whether a
 * story ID exists.
 */

export interface StoryViewDecisionInput {
  viewerId: string
  storyOwnerId: string
  expiresAt: Date
  isHighlight: boolean
  friendshipAccepted: boolean
  blocked: boolean
  now: Date
}

export interface StoryViewDecision {
  allowed: boolean
  /** Whether the view should be persisted. Owners never inflate their own counts. */
  record: boolean
}

export function decideStoryView(input: StoryViewDecisionInput): StoryViewDecision {
  const deny: StoryViewDecision = { allowed: false, record: false }
  if (!input.isHighlight && input.expiresAt.getTime() <= input.now.getTime()) return deny
  if (input.viewerId === input.storyOwnerId) return { allowed: true, record: false }
  if (input.blocked) return deny
  if (!input.friendshipAccepted) return deny
  return { allowed: true, record: true }
}
