# Task 17-reply-typing — full-stack-developer

## What
Surgically edited `src/components/fc/chat/ChatView.tsx` to add two round-7 features:
1. **Message reply-with-quote** — long-press Reply sets a `replyTo` state, shows a WhatsApp-style preview bar above the input, includes `replyToId` in the `message:send` / `group:message:send` payload, and renders a tappable quote card at the top of the bubble (looks up the replied-to message from the local `messages` array; falls back to "Original message" placeholder when the original isn't loaded).
2. **Typing status in conversation list** — `ConversationList` subscribes to `typing:indicator` (1:1) + `group:typing:indicator` (groups), tracks a `Set<string>` of who-is-typing keys (`peerId` for 1:1, `group:${groupId}` for groups), with a 3s auto-expiry per entry so a missed `isTyping:false` doesn't leave a stale indicator. `ConversationRow` + `GroupRow` show "typing…" / "Someone is typing…" in primary italic in place of the last-message preview.

## Approach
- Pure additive edits to ChatView.tsx — zero existing code rewritten. All rounds 1-6 features preserved (reactions, pin/mute-chat, search-within-chat, voice notes, delete/forward, deleted-placeholder, forwarded-indicator, star, disappearing, wallpaper + custom wallpaper upload, drafts, archive, message edit, group typing, PDF preview, global search, message pin, last-seen granularity).
- Verified backend contracts (Task 17-backend): `replyToId` is on every message returned by `GET /api/messages` + persisted on `message:send` / `group:message:send` via the realtime service; `typing:indicator` emits `{ userId, isTyping }` to the receiver; `group:typing:indicator` emits `{ groupId, userId, isTyping }` to all other members (excludes the typer). `RT.TYPING_INDICATOR` + `RT.GROUP_TYPING_INDICATOR` constants are already in `src/lib/constants.ts`.
- Reused the existing `scrollToMessage` helper (from round-6 message-pin) for the tap-to-scroll affordance on both the reply preview bar and the in-bubble quote card.
- Reused the existing `isDeletedForMe` helper so a quote of a since-deleted message shows the "🚫 This message was deleted" placeholder.
- Avoided temporal-dead-zone errors (the round-5 + round-6 bugs) by:
  - Declaring `replyTo` state alongside the other ChatRoom state (well before any effect that references it).
  - Keeping the `typingConvs` Set + `typingTimersRef` Map in `ConversationList` near the other state, BEFORE any effect that uses them.

## Files touched
- `src/components/fc/chat/ChatView.tsx` — surgical edits, additive only. File grew from 3454 → 3722 lines (~268 new lines).

## Verification
- `bun run lint` → 0 errors, 0 warnings.
- `curl http://localhost:3000/` → 200. `curl http://localhost:3000/api/auth/me` → 200.
- Dev log shows clean recompiles after edits (`✓ Compiled in 4.3s`), no runtime errors.

## Decisions
1. **Single `normalizeMessage` covers both REST + socket**: added `replyToId: raw.replyToId ?? null` once — both `GET /api/messages` payloads and `message:new` / `group:message:new` socket events now flow `replyToId` through the same path.
2. **Reply state cleared inside `sendMessage`** (not `sendText`): the `sendMessage` helper is the common path used by both `sendText` (text messages) and `sendFile` (file/voice uploads). Clearing `replyTo` there means a reply attached to a file upload also works + clears correctly. Added `replyTo` to `sendMessage`'s deps so the latest target is captured.
3. **Optimistic bubble carries `replyToId`**: the optimistic message includes `replyToId: replyTo?.id ?? null` so the quote card renders immediately on send (before the server ack replaces the temp bubble with the persisted one).
4. **Quote card tap is a no-op when original isn't loaded**: when `replyToMessage` is `null` (e.g. the original is older than the loaded page), the card shows "Original message" placeholder and the click handler bails out — no scroll attempt.
5. **Typing-status auto-expiry = 3s**: each `isTyping:true` schedules a 3s timer that clears the entry if no `isTyping:false` arrives. The timer is reset on every subsequent `isTyping:true`. Covers the case where the typer's socket disconnects mid-typing.
6. **Typing priority in conv row**: typing > draft > last-message. Matches WhatsApp (the most time-sensitive info wins). Unread badge still renders alongside typing.
7. **`rounded-r-md` instead of `rounded-r`**: Tailwind v4 doesn't reliably support the unsized side-radius utility (`rounded-r`), so I used `rounded-r-md` to ensure the right-side corners get rounded (matches the spec's visual intent).
8. **Sender-name resolution for direct chats**: `MessageBubble` accepts an optional `replyPeerName` prop (the peer's display name from `peerInfo?.name` in direct mode). When the replied-to message's `senderName` is null (which happens for direct messages loaded from `/api/messages` since the API doesn't include `senderName` for 1:1), the quote falls back to `replyPeerName` so it shows the peer's name instead of "Unknown".
9. **`isTyping` filter ignores my own id**: defensive — the server already excludes the typer from group broadcasts, and 1:1 `typing:indicator` is emitted to the receiver only, but the client filters `userId === meId` anyway to be safe.
10. **ConversationList unmount/remount**: when the user opens a chat, ConversationList unmounts (ChatRoom replaces it). The typing useEffect cleanup clears all timers. On return to the list, the typing state is empty until the next `isTyping:true` arrives (within 1.5s while the peer is actively typing). This is acceptable — the user is seeing the typing indicator in the open chat header during that window anyway.
