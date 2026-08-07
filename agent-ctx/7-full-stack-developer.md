# Task 7 — ChatView (full-stack-developer)

## What I did
Replaced the stub `/home/z/my-project/src/components/fc/chat/ChatView.tsx` with a complete WhatsApp-style chat experience (conversation list + 1:1 chat + group chat) in a single self-contained file.

## Work Log
1. Read `/home/z/my-project/worklog.md` to learn architecture, API contracts, socket events, styling rules.
2. Inspected existing stub `ChatView.tsx`, `FriendsView.tsx`, `HomeView.tsx` to match conventions.
3. Read `src/app/api/messages/route.ts`, `src/app/api/messages/conversations/route.ts`, `src/app/api/groups/route.ts`, `src/app/api/users/[id]/route.ts`, `src/app/api/friends/route.ts`, and `mini-services/realtime/index.ts` to confirm exact response shapes and socket event payloads.
4. Confirmed `useApp.setState` is exposed by zustand (used for back navigation).
5. Wrote a single-file component with:
   - `ConversationList` — Tabs (Chats / Groups), search filter, online presence dots, unread badges, last-message preview, group member counts, skeleton loaders, empty states.
   - `ChatRoom` — handles both `direct` and `group` modes.
     - Header with back button, peer/group avatar, online/last-seen or typing status, audio/video call buttons (dispatches `fc:start-call` CustomEvent).
     - Messages area with `fc-scroll`, infinite scroll up via `?before=`, auto-scroll-to-bottom when at bottom.
     - Bubbles using `fc-bubble-me` / `fc-bubble-them`, `fc-rise` animation, group sender avatar + name.
     - Renders text (linkified + emoji), image (thumbnail → dialog), video (inline `<video controls>`), audio (inline `<audio controls>`), document (download card with icon, name, size).
     - Status ticks: `Clock` for SENDING, `Check` for SENT, `CheckCheck` opacity-60 for DELIVERED, `CheckCheck` opacity-100 for SEEN.
     - Realtime: subscribes to `message:new`, `group:message:new`, `message:status`, `typing:indicator`. Marks incoming 1:1 messages as seen via `RT.MESSAGE_SEEN`.
     - Typing indicator bubble with three `.fc-typing-dot` dots. Emits `RT.TYPING` on input, clears after 1.5s idle, clears on send/unmount.
     - Input bar: emoji picker (Popover with 72 hardcoded emojis), attach button (hidden file input accepting image/video/audio/.pdf/.zip/.doc/.docx/.txt with upload spinner), auto-growing Textarea (Enter sends, Shift+Enter newline), send button.
     - Optimistic send with tempId + SENDING status, replaced by `ack.message` on success (matched by tempId). Files: `uploadFile()` first, then message with correct `type` based on mimeType.
6. Ran `bun run lint` — passed (0 errors, 0 warnings after removing an unused eslint-disable directive).
7. Verified dev server returns HTTP 200 on `/`.

## Files produced
- `/home/z/my-project/src/components/fc/chat/ChatView.tsx` — full implementation (~880 lines).

## Key decisions
- Single `ChatRoom` component parameterised by `mode: 'direct' | 'group'` and `peerId` to avoid duplication. Switching between direct/group reuses the same instance via React reconciliation (effect re-runs on `[mode, peerId]`).
- Back button uses `useApp.setState({ activeChatUserId: null, activeChatGroupId: null })` directly (zustand exposes `setState`).
- Peer info (name, photoUrl, lastSeen) is fetched from `/api/friends` (which returns lastSeen) when opening a direct chat; falls back to `/api/messages/conversations` if the peer isn't in the friends list.
- Group info is fetched from `/api/groups`.
- Optimistic messages use a synthetic `tempId` as both `id` and `tempId`; replaced by the real server message on ack. The `message:new` echo of my own outgoing message is de-duplicated by `id`.
- `MESSAGE_SEEN` is emitted only for realtime incoming 1:1 messages (REST GET already marks the historical batch as seen server-side).
- `fc-typing-dot` animation delays staggered 0/150/300ms for the wave effect.
- Infinite scroll-up preserves scroll position via `prevHeight` + `requestAnimationFrame` and uses a `skipAutoScrollRef` flag to prevent the auto-scroll-to-bottom effect from firing while prepending older messages.
- Status tick colour contrast on the primary bubble: SENDING/SENT/DELIVERED use `opacity-60`, SEEN uses `opacity-100` (visually distinct without hardcoding a forbidden blue).
- The eslint rule `react-hooks/set-state-in-effect` is NOT enabled in this project (the disable directive produced an "unused eslint-disable" warning), so it was removed.

## Stage Summary
- `bun run lint` passes with 0 errors and 0 warnings.
- Dev server returns HTTP 200 on `/` after the edit.
- ChatView is feature-complete: conversation list (chats + groups) with search, online dots, unread badges; 1:1 chat with calls, typing, status ticks, mark-seen, file attachments, emoji picker, infinite scroll-up; group chat with sender avatars/names.
- No backend changes were required — all contracts in the worklog matched the actual API/realtime implementations.
