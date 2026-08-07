# Task 20-reminders-forward — Work Record

**Agent:** full-stack-developer (Reminders + forward-to-multiple)
**File edited:** `src/components/fc/chat/ChatView.tsx` (surgical, additive only — no existing rounds 1-9 features touched).

## Summary
Delivered Round 10 message-reminders UI + forward-to-multiple dialog enhancements on top of the existing ChatView (rounds 1-9) — frontend-only, the backend contracts were already in place per Task 20-backend.

## Feature 1: Message reminders
- **Action menu entry**: added a "Remind" option (BellRing icon) to the MessageBubble long-press action menu, placed AFTER Star and BEFORE Copy. Visible for all messages (mine + theirs, 1:1 + group) — the backend validates participation.
- **Remind dialog** (`RemindMessageDialog`): `max-w-md` Dialog with the target message preview (line-clamp-2 read-only), a `datetime-local` input (future only — `min={now}` + JS-side isFuture guard), an optional note Textarea (maxLength 200, char counter), a destructive-error inline hint when the picked time is in the past, and a primary "Set reminder" button. On confirm: `POST /api/messages/[id]/remind { remindAt }` → toast `Reminder set for {time}` → close. The note is UI-only (the API only accepts `remindAt`); it's reset whenever a new message target is set.
- **Reminders viewer** (`RemindersDialog`): `max-w-md` Dialog opened from the ChatSettingsSheet. Fetches `GET /api/messages/reminders`, renders each row with `rounded-xl p-2 hover:bg-accent/40` — Bell icon + content (line-clamp-2) + peer name ("with {peerName}") + Calendar icon + formatted remind time + Cancel button (destructive). Cancel calls `DELETE /api/messages/[messageId]/remind` and removes the row from the list. Empty state shows a hint pointing the user to the long-press → Remind flow.
- **ChatSettingsSheet wiring**: added a new "Reminders" section (with SectionTitle + BellRing icon button) between "Scheduled" and "Export". Tapping it opens the viewer + closes the sheet.

## Feature 2: Forward-to-multiple enhancement
The existing `ForwardDialog` already supported multi-select + posted to `/api/messages/forward { targets: [...] }`. The polish layer:
- **Search box** at the top of the dialog: `rounded-lg border border-border bg-background px-3 py-2 pl-9` with a Search icon. Filters friends by name/username + groups by name/description. Clear-X button when there's text.
- **Select all / Clear all toggle**: a single button next to the search input. Computes `visibleKeys` (post-filter) and `allVisibleSelected`. Clicking it either adds all visible keys to the selection (additive — preserves hidden selections) or removes them. The button label switches between "Select all" and "Clear all" based on state. Disabled when there are no visible items.
- **Count badge** in the footer: replaced the plain `{count} selected` text with a pill `inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary` containing a Check icon + "N selected". Reverts to "Select recipients" muted text when 0 are selected.
- The "Forward to N" confirm button + Cancel button remain unchanged.
- Search + selection are reset on dialog close.

## Styling (mandatory checks)
- Emerald/teal brand only — `bg-primary/15`, `text-primary`, `border-primary`, etc. NO indigo/blue.
- Remind dialog: `max-w-md`, datetime-local input with `rounded-lg border border-border bg-background px-3 py-2` (+ focus ring `focus:border-primary focus:ring-2 focus:ring-primary/30`), Set-reminder button primary.
- Reminders viewer: rows with `rounded-xl p-2 hover:bg-accent/40`, Bell icon + content (line-clamp-2) + peer name + Calendar icon + formatted time + Cancel button (destructive).
- ForwardDialog search: `rounded-lg border border-border bg-background px-3 py-2 pl-9` with a Search icon.
- ForwardDialog footer: count badge `bg-primary/15 text-primary rounded-full px-2 py-0.5 text-xs`.

## Quality bar
- No placeholders/TODOs — every control wired (POST/DELETE/GET + toasts + optimistic UI).
- Existing rounds 1-9 features preserved (no behavioral changes to existing buttons, menus, or dialogs).
- No temporal-dead-zone errors: in `ForwardDialog`, all derived vars (`q`, `filteredFriends`, `filteredGroups`, `visibleKeys`, `allVisibleSelected`, `count`) are computed AFTER the `search` state declaration and AFTER the `useEffect([message])`. In `RemindMessageDialog`, `remindDate`, `isFuture`, `canSubmit` are declared AFTER the `useEffect([message])`. In `ChatRoom`, the two new state vars (`remindTarget`, `remindersDialogOpen`) are declared alongside the other dialog states with no derived deps.
- `bun run lint` → 0 errors, 0 warnings (after clearing the eslint cache — initial run reported a stale-cache error in `ProfileView.tsx` from a sibling agent's task; clearing `.eslintcache` resolved it).
- Dev server returns HTTP 200 on `/`.

## Files produced / modified
- Modified: `src/components/fc/chat/ChatView.tsx` (single file — ~350 new lines added surgically).
- No backend, realtime, or API route files touched.

## Decisions
- **Note field in RemindMessageDialog is UI-only**: the API contract is `{ remindAt }` only; the backend schema has no `note` column. Kept the field because the task spec explicitly mentioned it ("datetime-local input + optional note"), but we don't POST it. The note is reset on each open + has a 200-char counter for clear feedback.
- **Remind option available for ALL messages** (not just mine) — matches the task spec ("shown for all messages, not just mine"). The backend's participation check covers access control.
- **Reminders viewer shows ALL active reminders across chats** (not just the current chat) — the backend returns them globally, and it's more useful for the user to see every upcoming reminder in one place. Each row shows the peer name so context is preserved.
- **Select all / Clear all toggle is additive**: when filtering by search, "Select all" only adds visible items (preserves hidden selections); "Clear all" only removes visible items. This is the standard Gmail/Notion pattern.
- **Reminders viewer is opened from ChatSettingsSheet** (per spec) — placed between Scheduled and Export for visual grouping with other per-conversation viewer entries. The viewer itself shows cross-chat reminders since that's what the API returns.
