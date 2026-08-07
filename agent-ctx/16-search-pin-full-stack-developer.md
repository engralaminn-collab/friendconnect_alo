# Task 16-search-pin — Global message search + message pin within chat

## What I did
Surgically edited `/home/z/my-project/src/components/fc/chat/ChatView.tsx` to add two new features on top of the existing rounds 1-5 (reactions, pin/mute-chat, search-within-chat, voice notes, delete/forward, star, disappearing, wallpaper, drafts, archive, message edit, group typing, PDF preview). No existing feature was touched or rewritten — only additive changes.

## Features delivered

### Feature 1: Global message search
- **GlobalSearchResult interface**: added after `PeerInfo`, mirrors the `GET /api/messages/search?q=QUERY` payload (`messageId, content, type, createdAt, senderId, senderName, conversationType, peerId?, peerName?, peerUsername?, peerPhoto?, groupId?, groupName?`).
- **State**: `globalResults: GlobalSearchResult[]`, `globalLoading: boolean`, `globalSearchTimerRef: ReturnType<typeof setTimeout> | null` in `ConversationList`.
- **Debounced effect** (400ms): a new `useEffect` in `ConversationList` watching `query` — when the trimmed query is non-empty, sets `globalLoading=true`, clears any pending timer, schedules a `GET /api/messages/search?q=...` call after 400ms, parses the `results` array, and clears loading. On empty query → clears results immediately (no API call). Cleanup clears the timer on every query change so only the latest query triggers a request.
- **Search dropdown UX**: when `query.trim()` is non-empty, the chat/group Tabs are REPLACED with a unified dropdown containing two sections:
  - **Conversations**: local-filtered chats (top 5) + groups (top 5), each rendered as a tappable row (avatar + name + meta). Tapping opens the chat (`openChat`/`openGroupChat`) and clears the query.
  - **Messages**: global search results, each rendered as a tappable row with `MessageSquare` icon + message content (with `<mark>` highlighting via the existing `highlight` helper) + sender name + conversation name (peerName or groupName) + `timeAgo`. Tapping opens the conversation and clears the query.
  - **Loading state**: spinner in the Messages section while `globalLoading` is true.
  - **Empty state**: "No messages found" when global results are empty (and not loading).
  - **Total-empty state**: `EmptyState` component with "No results" + `Nothing matches "QUERY" in your chats or messages.` when nothing matches anywhere.
- **Clear button**: added an `X` button to the search input (top-right) that appears when `query` is non-empty — clears the query and closes the dropdown.
- **Placeholder**: updated from "Search chats and groups" → "Search chats and messages" to reflect the new global message search capability.

### Feature 2: Message pin within chat
- **Message interface**: added `pinnedBy?: string | null` to the `Message` interface.
- **normalizeMessage**: maps `pinnedBy: raw.pinnedBy ?? null` so the `GET /api/messages` payload (which now includes `pinnedBy` per the round-6 backend) flows into local state.
- **`pinnedMessage` derivation** (in `ChatRoom`, defined RIGHT AFTER `groupTypingCount` and BEFORE the auto-scroll useEffect — avoids the temporal-dead-zone bug that bit round 5): finds the first (and only — backend enforces one per 1:1 conversation per user) message where `pinnedBy === meId && !isDeletedForMe(m, meId)`. null in group mode or when nothing is pinned. Excludes deleted messages so a deleted pinned message doesn't surface in the pin bar.
- **`togglePin` callback** (1:1 only, gated by `mode === 'direct'`): optimistic update — clears `pinnedBy` on any message I had pinned in this conversation (mirrors the backend's "unpin previous, pin new" behavior), then sets/clears `pinnedBy` on the target. POSTs `/api/messages/[id]/pin { pinned }`. On error, reverts the target's `pinnedBy` to its prior state. Toasts "Message pinned" / "Message unpinned" / error.
- **`scrollToMessage` callback**: looks up the message element via `scrollRef.current?.querySelector('[data-msg-id="ID"]')` (using `CSS.escape` for safety on the message id) and calls `scrollIntoView({ behavior: 'smooth', block: 'center' })` so the browser handles the nearest scroll container. Used by the pin bar to jump back to the pinned bubble.
- **Pin bar** (rendered ABOVE the messages scroll area, BELOW the header/search bar): when `pinnedMessage && mode === 'direct'`, shows a bar with:
  - `Pin` icon (primary)
  - Truncated message content (single line) — falls back to `📷 Photo` / `🎥 Video` / `🎤 Audio` / `📄 Document` for media messages
  - Sender name ("You" if mine, else senderName)
  - `X` button to unpin (calls `togglePin(pinnedMessage)`)
  - The bar (minus the X) is a `<button>` that calls `scrollToMessage(pinnedMessage.id)` to jump back to the pinned bubble.
  - Styling: `mx-3 mt-2 flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2`.
- **`data-msg-id` wrapper**: wrapped each `<MessageBubble>` in a `<div key={m.id} data-msg-id={m.id}>` so the pin bar's scroll-to-message can find the bubble. The wrapper is a flex child of `flex flex-col gap-1` — visually identical to the previous direct render.
- **Pin option in action menu**: added `onPin?: (msg: Message) => void` prop to `MessageBubble`. In the long-press action menu, added a "Pin"/"Unpin" button (with `Pin`/`PinOff` icon) — placed AFTER Reply, BEFORE Edit. Only shown when `!isGroup && onPin` (i.e. 1:1 chats only). Shows "Unpin" + `PinOff` icon when `msg.pinnedBy === meId`, otherwise "Pin" + `Pin` icon.
- **Pinned indicator on bubble**: added a small `Pin` icon (primary, `size={11}`) at the top-LEFT of the bubble (mirroring the existing Star indicator at top-right) when `msg.pinnedBy === meId`. Same styling as the Star indicator: `absolute -top-1.5 -left-1.5 z-10 grid h-4 w-4 place-items-center rounded-full bg-card shadow-sm ring-1 ring-border`.

## Imports
- Added `PinOff, MessageSquare` to the lucide-react import block. (`Pin` was already imported from earlier rounds.)

## Quality
- `bun run lint` → 0 errors, 0 warnings (exit 0).
- Dev server returns 200 on `/` (verified via `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/`).
- No existing features broken — all rounds 1-5 features preserved.
- Temporal-dead-zone avoided: `pinnedMessage` defined before the auto-scroll useEffect (same pattern as the round-5 `groupTypingCount` fix).
- Did NOT touch the realtime service, API routes, Prisma schema, or any backend files. All work consumed the existing Task 16-backend contracts as documented in worklog.md.
