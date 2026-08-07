# Task 20-folders-verify — Chat folders + verification badge

## What I did
Two additive frontend features on top of the round-10 backend (no backend changes):

### 1. Chat folders (ChatView.tsx)
- Added `folder?: string | null` to the `Conversation` interface (matches the backend's new field on `GET /api/messages/conversations`).
- ConversationList now groups conversations by folder:
  - "All" (synthetic key for no-folder convs) always sorts first.
  - Other folders sort alphabetically (case-insensitive `localeCompare`).
  - Each folder is a collapsible section header (`Folder`/`FolderOpen` icon + name + count badge + chevron) per the spec's `flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-accent/40` styling.
- Grouping UI only renders when the user has ≥1 folder defined; otherwise the list looks exactly like before (no superfluous "All" header).
- Added "Move to folder" / "Change folder" item to the ConversationRow long-press menu (after Pin/Mute/Archive). Shows current folder name as a small label when set.
- New `MoveToFolderDialog` component (`max-w-sm`): text input (maxLength 50, autoFocus, Enter-to-confirm) + quick-pick chips for existing folders (highlighted when active) + a "Remove from {currentFolder}" destructive button (only when conversation is in a folder). Calls `POST /api/messages/preferences { peerId, folder: name | '' }` on confirm.
- Optimistic local state updates across both `conversations` + `archivedConvs` arrays; on error refetches via `load()`.

### 2. Profile verification badge
- **ui.tsx** — UserAvatar got an optional `verified?: string` prop. When `verified === 'verified'`, renders a 16px emerald badge (`bg-primary text-primary-foreground border-2 border-background`) at `-bottom-0 -right-0` with a white `Check` icon (size 10, strokeWidth 3). When the online dot is also rendered, it shifts to `top-0 right-0` so both indicators are visible.
- **nav.tsx** — TopBar avatar passes `verified={user?.profile?.verified}`.
- **ProfileView.tsx** —
  - `ProfileResult.user` type now includes `verified: string`.
  - MyProfile: shows `BadgeCheck` icon next to name when verified; shows "Get verified" pill (`rounded-full bg-primary/15 text-primary px-3 py-1 text-xs`) opening `VerifyDialog` when unverified; shows amber "Verification pending" pill (`bg-amber-500/15 text-amber-600 rounded-full px-2 py-0.5 text-xs`) when pending. Passes `verified` to the 96px UserAvatar.
  - Other-user profile: shows `BadgeCheck` icon next to name when verified; passes `verified` to the 96px UserAvatar.
  - New `VerifyDialog` (`max-w-md`): Textarea (maxLength 500, char counter) + Cancel/Submit. POSTs `{ reason }` to `/api/verify`, calls `refresh()` so the badge flips to "pending", toasts "Verification request submitted".

## Files edited
- `/home/z/my-project/src/components/fc/ui.tsx`
- `/home/z/my-project/src/components/fc/shell/nav.tsx`
- `/home/z/my-project/src/components/fc/profile/ProfileView.tsx`
- `/home/z/my-project/src/components/fc/chat/ChatView.tsx`

## Decisions / notes
- Verified badge stays emerald (`bg-primary`) per spec — distinct from the online dot via the white Check icon. When both render, online dot moves to top-right; otherwise stays at canonical bottom-right.
- Folder grouping UI is opt-in: only renders when ≥1 folder exists. Existing users see no UI change.
- "All" is the synthetic key for no-folder convs; always sorts first.
- Move-to-folder dialog is owned by ConversationList (not ConversationRow) so it can access the full list of existing folders for quick-pick chips.
- Folder changes are optimistic (matches existing archive/pin/mute pattern).
- Per spec, `verified` prop is only applied where the data exists: current user (useAuth) + profile view (/api/users/[id]). Not threaded through FriendsView/conversation-list/chat-header because those endpoints don't return `verified`.

## Lint + dev server
- `bun run lint` → 0 errors, 0 warnings.
- `GET /` → HTTP 200.
- All existing functionality preserved (chat header, calls, settings dialog, edit profile, crop dialog, filters, privacy, archive, pin, mute, search, etc.) — additive only.
