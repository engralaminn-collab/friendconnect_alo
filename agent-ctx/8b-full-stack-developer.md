# Task 8b — GroupsView (full-stack-developer)

## Summary
Replaced stub `src/components/fc/groups/GroupsView.tsx` with a complete, production-quality Groups management screen for FriendConnect.

## Files produced / modified
- `src/components/fc/groups/GroupsView.tsx` (OVERWRITTEN — full implementation, ~660 lines, single self-contained file)
- `/home/z/my-project/worklog.md` (appended Task 8b section)

## What it implements
1. **Groups list** (default mode)
   - Sticky header (`border-b border-border bg-background/90 backdrop-blur`) with title "Groups", count subtitle, and a top-right "Create" button (Plus icon, `rounded-full`).
   - `GET /api/groups` → list of `{ id, name, description, photoUrl, role, memberCount, createdAt }`.
   - Each rendered as a premium shadcn `Card` (`rounded-2xl border-border bg-card p-3` + `hover:border-primary/40`). Card shows:
     - Inline `GroupAvatar` helper — rounded-2xl square using shadcn Avatar, shows photo or group initial or Users icon fallback.
     - Name + role badge (OWNER `bg-primary text-primary-foreground` Crown, ADMIN `bg-secondary text-secondary-foreground` Shield, MEMBER `bg-muted text-muted-foreground` Users).
     - Description (`line-clamp-2`) or italic "No description".
     - Member count + `timeAgo(createdAt)`.
   - Tap card → `useApp().openGroupChat(id)`.
   - Long-press (500ms via `useLongPress` hook) OR Settings2 button (top-right) → opens group details dialog.
2. **Create group dialog**
   - Photo upload (label + sr-only input → `uploadFile` from `@/lib/api` → `photoUrl`), with loading spinner overlay on the avatar.
   - Name input (required, maxLength 60, autoFocus), description Textarea (maxLength 240, char counter).
   - Friends list (GET /api/friends) with shadcn Checkbox + UserAvatar + name. "Select all / Clear all" toggle. Selected count in label.
   - Create → `POST /api/groups { name, description, photoUrl, memberIds }` → `toast.success('Group created')`, reset form, close dialog, `loadGroups()` refresh, and `openGroupChat(newGroupId)`.
   - Validation: button disabled when name empty + toast error fallback.
3. **Group details dialog** (controlled by `detailId` state)
   - `GET /api/groups/:id` → renders group header (avatar, name, member count + created-ago), description, and member list with RoleBadge per member and "(you)" marker.
   - Owner-only "Add members" button → sub-flow: GET /api/friends filtered to non-members, checkbox multi-select, POST each to `/api/groups/:id/members` in parallel → toast, refresh details + parent list.
   - "Leave group" button (everyone) → `DELETE /api/groups/:id/members?userId=me` → toast, close dialog, refresh list.
   - "Open chat" ghost button shortcut in footer.

## State handling
- Loading skeletons (4 placeholder cards), error EmptyState with Retry button, empty EmptyState with CTA, dialog loading spinners, per-action loading flags.
- `useLongPress` hook returns `[handlers, wasLongPress]` tuple; click handler short-circuits when long-press already fired to avoid double navigation.

## Quality
- `bun run lint` → **0 errors, 0 warnings**.
- Dev server compiles cleanly; `GET /` returns **200**.
- Mobile-first, `flex h-full flex-col` root, `fc-scroll` for scroll areas, emerald/teal accents only (no indigo/blue).
- All shadcn primitives used as required (Button, Card, Input, Textarea, Label, Dialog set, Checkbox, Avatar set, Badge, Separator). ChevronRight was omitted (unused in final design — kept imports clean); Loader2 added for spinners.

## Contracts honored
- `useApp` → `{ openGroupChat }` (also destructured inside details dialog).
- `useAuth` → `user.id` (used to find myRole + show "(you)" marker).
- `api`, `uploadFile`, `timeAgo` from `@/lib/api`.
- `UserAvatar`, `EmptyState` from `@/components/fc/ui` (SectionTitle imported elsewhere but not needed in this view).
- `'use client'` directive at top.
