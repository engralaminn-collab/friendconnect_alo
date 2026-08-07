# Task 15-chat-edit-typing — Message edit + group typing (sender-aware)

## What I did
Surgically edited `/home/z/my-project/src/components/fc/chat/ChatView.tsx` to add two new features on top of the existing rounds 1-4 (reactions, pin/mute, search, voice notes, delete/forward, deleted-placeholder, forwarded-indicator, star, disappearing, wallpaper, drafts, archive). No existing feature was touched or rewritten — only additive changes.

## Features delivered

### Feature 1: Message edit
- **Message interface**: added `edited?: boolean` and `editedAt?: string | null` to the `Message` interface.
- **normalizeMessage**: maps `edited` (`!!raw.edited`) and `editedAt` (`raw.editedAt ?? null`) so the `GET /api/messages` payload (which now includes these fields per the round-5 backend) flows into the local state.
- **Edit option in action menu**: a new "Edit" button (lucide `Pencil`, already imported) placed between Reply and Forward in the long-press action menu. Only shown when ALL of:
  - `msg.senderId === meId` (mine)
  - `!deleted` (not deleted for me/everyone)
  - `msg.type === 'text'` (only text messages can be edited — media messages have empty content and the backend would reject an empty edit; this avoids confusing UX)
  - `(Date.now() - new Date(msg.createdAt).getTime()) / 60000 < 15` (within 15-min window, matching backend rule)
- **Edit UI** (`EditMessageDialog` component, placed after `DeleteConfirmDialog`): shadcn `Dialog` with sticky header (title "Edit message" + Pencil icon), `Textarea` pre-filled with current content, `maxLength={5000}`, character count "N / 5000", Ctrl/Cmd+Enter to save, Cancel + Save buttons. Save disabled if content empty or unchanged. Spinner during save.
- **handleEditSave callback**: tries realtime first via `socket.emit(RT.MESSAGE_EDIT, { messageId, content }, ack)` wrapped in a Promise with a 10s timeout guard; on ack.ok, optimistic local update + toast "Message edited"; on ack.error, throws to surface server error (e.g. "edit window expired", "forbidden"). Falls back to `POST /api/messages/[id]/edit` REST endpoint if socket unavailable or didn't ack (uses authoritative editedAt from server response). On success, updates local message: `content`, `edited: true`, `editedAt`.
- **Realtime edit subscription**: in the ChatRoom socket effect, registers `RT.MESSAGE_EDITED` (`{ messageId, content, editedAt }`) → updates the matching local message's content + edited=true + editedAt. Idempotent (safe to receive for a message we just edited — same data we set optimistically).
- **Edited indicator**: in MessageBubble's `meta` row (where timestamp + status tick live), if `msg.edited === true`, shows a small `text-[9px] italic text-muted-foreground` "edited" label between the timestamp and the status tick.

### Feature 2: Group typing (sender-aware)
- **State**: `groupTypingUsers: Set<string>` (userIds currently typing, excludes me — server emits to all other members); `groupMembers: Map<string, string>` (userId → name lookup, built once per group chat open). Both reset on peerId change.
- **Emit on text input** (`handleTextInput`): when `mode === 'group'`, emits `socket.emit(RT.GROUP_TYPING, { groupId: peerId, isTyping: true })` and debounces a reset to `isTyping: false` after 1.5s idle (same pattern as the existing 1:1 typing). Shares the same `typingTimerRef` as direct mode (mutually exclusive since mode is fixed per ChatRoom instance).
- **Clear on send** (`sendText`): emits `isTyping: false` for groups after sending so the indicator doesn't linger.
- **Clear on unmount/peerId-change** (socket effect cleanup): emits `isTyping: false` for groups.
- **Subscribe** (`onGroupTyping` handler in socket effect): listens for `RT.GROUP_TYPING_INDICATOR` (`{ groupId, userId, isTyping }`), filters by `groupId === peerId` AND `userId !== meId` (defensive — server already excludes the typer), updates the `groupTypingUsers` Set (add on isTyping:true, delete on isTyping:false).
- **Fetch group members**: new `useEffect` (mode === 'group' + peerId deps) calls `GET /api/groups/:id` and builds the `userId → name` map. Falls back to "Someone" if the name is missing. Non-fatal on error (typing indicator still works with generic label).
- **Typing indicator bubble**: unified with the existing 1:1 typing bubble. For groups, shows a stacked layout: label above (text-xs text-muted-foreground, e.g. "Aria is typing…" or "3 people are typing…") + the animated `.fc-typing-dot` row below. For direct mode, just the dots row (no label). The 7-unit left spacer is preserved for group mode to align with sender avatars.
- **Header status**: for groups, shows the group typing label when anyone is typing (replaces the default "X members"); turns primary-colored to match the 1:1 behavior. Falls back to "X members" when no one is typing.
- **Auto-scroll**: added `groupTypingCount` to the auto-scroll useEffect deps so the view scrolls to bottom when the indicator appears (matches the existing 1:1 behavior triggered by `peerTyping`).

## Files touched
- `/home/z/my-project/src/components/fc/chat/ChatView.tsx` (additive edits only; ~377 new lines, file grew from 2627 → 3004 lines)

## Decisions
- **Text-only edit**: restricted the Edit action to `msg.type === 'text'`. The backend would technically allow editing any message (it just sets `content`), but for media messages `content` is empty — letting the user "edit" a media message would either show an empty dialog (Save disabled) or replace the content with text without changing the file, which is broken UX. The task spec lists necessary conditions (mine, not deleted, within window) — `msg.type === 'text'` is an additional sufficient condition that keeps the UX clean.
- **Realtime-first with REST fallback**: prefer `socket.emit` with ack for instant propagation (the server broadcasts `message:edited` to all participants including us). Fall back to REST only if the socket is unavailable or didn't ack (timeout). The ack-error path surfaces server messages (e.g. "edit window expired") directly to the user via toast.
- **10s ack timeout**: prevents the dialog from hanging forever if the server never acks. On timeout, falls through to the REST fallback.
- **Group typing label inline IIFE**: computed inline (`groupTypingLabel = (() => { ... })()`) instead of `useMemo` to avoid adding a new React import. Cheap computation (only runs when ChatRoom re-renders; the only changing deps are state).
- **Idempotent `onEdited`**: when we edit a message, the server broadcasts `message:edited` to us too. Our `onEdited` handler updates the local message with the same content + editedAt we already set optimistically — no harm, no flicker.
- **Sender-aware filter on client**: the server already excludes the typer from the broadcast, but we filter `userId === meId` again in `onGroupTyping` for defense in depth (e.g. if a future bug causes the server to broadcast to the typer).

## Verification
- `bun run lint` → 0 errors, 0 warnings.
- Dev server (`bun run dev`) returns HTTP 200 on `/` after edits.
- All existing features preserved (reactions, pin/mute, search, voice notes, delete/forward, deleted-placeholder, forwarded-indicator, star, disappearing, wallpaper, drafts, archive, call buttons) — only additive changes, no existing code rewritten.
- Backend (realtime service, API routes, Prisma schema) untouched.
