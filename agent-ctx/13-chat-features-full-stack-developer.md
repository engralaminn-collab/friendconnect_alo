# Task 13-chat-features — Chat star / disappearing / wallpaper

## What I did
Surgically edited `/home/z/my-project/src/components/fc/chat/ChatView.tsx` to add three new features on top of the existing reactions / pin-mute / search / voice-notes / delete-forward / deleted-placeholder / forwarded-indicator (rounds 1–2). No existing code was removed or rewritten.

## New functionality
1. **Message star/favorite**
   - Added `starred?: boolean` + `expiresAt?: string | null` to the `Message` interface.
   - `normalizeMessage` now maps `starred: !!raw.starred` + `expiresAt: raw.expiresAt ?? null`.
   - New "Star"/"Unstar" item in the long-press action menu (between Forward and Copy), with a Star icon (filled+primary when already starred).
   - `toggleStar` in ChatRoom does optimistic local flip + `POST/DELETE /api/messages/[id]/star` + toast + revert-on-error.
   - Starred bubbles show a small filled-primary Star icon badge at top-right (`absolute -top-1.5 -right-1.5`, `bg-card` ring, `Star size={11} fill-primary text-primary`).

2. **Disappearing messages**
   - `disappearing` state in ChatRoom (`'OFF' | '24H' | '7D'`), loaded from `GET /api/messages/preferences` (filtered by peerId) on peerId change.
   - Chat settings Sheet has a RadioGroup with three options (Off / 24 hours / 7 days), each a styled Label card with Timer icon.
   - `handleDisappearingChange` POSTs to `/api/messages/preferences { peerId, disappearing }` + toast + revert-on-error.
   - Header shows a small primary-tinted ⏱ pill ("24h" / "7d") with `title="Disappearing in 24h"` tooltip when active.

3. **Chat wallpaper**
   - `wallpaper` state in ChatRoom (CSS string or null), loaded from preferences on peerId change.
   - Wallpaper grid in the chat settings Sheet: 4 columns × 2 rows of `aspect-[2/5]` swatches, `rounded-xl`, `ring-2 ring-primary` when selected. 8 presets: None / Emerald / Teal / Sand / Rose / Amber / Slate / Charcoal (NO indigo/blue, all warm/green/neutral).
   - `handleWallpaperChange` POSTs `{ peerId, wallpaper: value || null }` + toast + revert-on-error.
   - Applied directly to the messages scroll area (`div ref={scrollRef}`) via `style={{ background: wallpaper }}` when set. Bubble text remains readable because `fc-bubble-me`/`fc-bubble-them` have their own background colors.

4. **Starred messages viewer**
   - "Starred messages" button in the chat settings Sheet → opens a Dialog.
   - `StarredMessagesDialog` fetches `GET /api/messages/starred` on open, renders each row with `UserAvatar`, sender name, media emoji (📷/🎥/🎤/📄) or content text, and `timeAgo(starredAt)`. Deleted messages render as italic "🚫 This message was deleted". Empty state: "No starred messages". Tapping a row closes the dialog.

5. **Chat header**
   - New `MoreVertical` button in the chat header (always shown, for both direct + group modes) opens the bottom Sheet.
   - Direct mode retains the existing Search / Audio call / Video call buttons.

## Files produced / modified
- `/home/z/my-project/src/components/fc/chat/ChatView.tsx` — surgical edit (+~414 lines, file went from 2005 → 2419 lines).

## Decisions
- **Optimistic updates with revert**: star, disappearing, and wallpaper all update local state immediately, then POST to `/api/messages/preferences` (or `/star`), reverting on failure with a toast. Avoids UI flicker.
- **Preferences loaded on peerId change** (not on sheet open): single source of truth in ChatRoom state, no flicker when opening the sheet, no extra network round-trip per sheet open.
- **Wallpaper is a raw CSS string**: presets use solid hex (`#f0fdf4`) or `linear-gradient(135deg, …)`; the value is stored verbatim in `ChatPreference.wallpaper` and applied via inline `style={{ background: … }}`. Easy to extend with custom values later.
- **Star indicator placement**: top-right of bubble for both mine/them bubbles (per spec), `absolute -top-1.5 -right-1.5`, `bg-card` chip with ring so it's visible on any bubble color. Size 11 px (within the 12–14 spec range — fits the badge).
- **Disappearing indicator**: primary-tinted pill in the header status row (inline with the "online/typing/last seen" text) — small, branded, with `title` tooltip for full text.
- **Action menu order**: Reply → Forward → Star → Copy → Delete. Star sits between Forward and Copy (matches WhatsApp's ordering pattern).
- **No overlay added on top of wallpaper**: bubbles already have their own background colors (`--fc-bubble-me` / `--fc-bubble-them`) so text remains readable on any wallpaper. The "Start of conversation" pill uses `bg-accent/60`. EmptyState is the only edge case (would be low-contrast on dark wallpapers) but acceptable tradeoff.
- **StarredMessagesDialog uses `useAuth()` directly** (rather than receiving `meId` as a prop) to check `isDeletedForMe` for the deleted-placeholder rendering — keeps the dialog self-contained.

## Lint + verification
- `bun run lint` → 0 errors, 0 warnings.
- Dev server returns HTTP 200 on `/`.
- `/api/messages/starred` and `/api/messages/preferences` respond 401 without auth (correct).
- End-to-end browser test (agent-browser, mobile 390×844, gateway :81, logged in as aria):
  1. Opened Bilal chat → header shows new `MoreVertical` button → tap → bottom Sheet with "Chat settings" title, "STARRED" / "DISAPPEARING MESSAGES" / "WALLPAPER" sections rendered correctly.
  2. Tapped "24 hours" radio → toast shown → header now shows `24h` pill with `title="Disappearing in 24h"`.
  3. Tapped "Emerald" wallpaper swatch → toast "Wallpaper updated" → messages area background is `rgb(240, 253, 244)` = `#f0fdf4` (verified via `getComputedStyle`).
  4. Long-pressed a message bubble → action menu shows Reply/Forward/**Star**/Copy/Delete → tapped "Star" → `POST /api/messages/[id]/star 200` in dev.log.
  5. Reloaded → starred bubble now shows filled-primary Star badge at top-right (verified via `aria-label="Starred message"` count = 1).
  6. Opened Sheet → tapped "Starred messages" → Dialog opens, shows "Aria Ahmed · just now · Hey Bilal! Long time no see 🎉".
- All pre-existing features (reactions, pin/mute, search, voice notes, delete/forward, deleted-placeholder, forwarded-indicator, call buttons) preserved — only additive changes.

## Notes for next agent
- The backend (Task 13-backend) already exposed all the contracts this UI consumes — no backend changes were needed.
- The `peerId` passed to preferences works for both 1:1 (userId) and group (groupId) — `ChatPreference` is keyed on `(userId, peerId)` and treats `peerId` as opaque.
- If you want to extend wallpaper with custom upload, the field is a raw CSS string — a future "custom wallpaper" picker could post any valid CSS background value.
