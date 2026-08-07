# Task 19-broadcast-storyviews — Work Notes

## What was built
1. **Broadcast lists** — new `BroadcastsView.tsx` component + wired into the avatar dropdown in `nav.tsx` (TopBar).
2. **Story views list** — surgical edit to `StoryViewer.tsx` to add a tappable views popover for own stories.

## Files produced / modified
- **New**: `src/components/fc/broadcasts/BroadcastsView.tsx` (~470 lines, self-contained `'use client'` component).
- **Modified**: `src/components/fc/shell/nav.tsx` — added `useState` + `Megaphone` import + a `Broadcasts` DropdownMenuItem + the `<BroadcastsView>` dialog mounted in the header.
- **Modified**: `src/components/fc/stories/StoryViewer.tsx` — added `StoryViewEntry` interface, `views`/`viewsOpen`/`loadingViews` state, fetch effect for `GET /api/stories/[id]/views` (owner only), `headerViewsCount` derived variable declared BEFORE the JSX (no TDZ), and replaced the static views `<span>` in the header with a tappable button + AnimatePresence popover.

## Approach / decisions
- **Wiring**: chose the avatar-dropdown approach (cleanest, doesn't break the 5-tab bottom nav and doesn't require editing the `View` union in `store.ts`). The TopBar holds local `broadcastsOpen` state and renders `<BroadcastsView>` at the end of `<header>` so the Dialog portal can mount anywhere. The DialogContent is `max-w-md` / `max-h-[92vh]` to act like a full-screen sheet on mobile.
- **Nested dialogs**: `BroadcastsView` manages two child dialogs internally (`CreateBroadcastDialog`, `ListDetailDialog`). When the outer dialog closes, both children are dismissed via a `useEffect` so a stale sub-dialog never lingers.
- **Create dialog**: name input + scrollable friend list (`max-h-60 overflow-y-auto`) with `Checkbox` + `UserAvatar`. "Select all" / "Clear all" toggle. Validates name + at least one recipient. POSTs `{ action: 'create', name, memberIds }` → toast → reset → refresh.
- **Detail dialog**: members list (with @username), Textarea composer, "Broadcast" button → POSTs `{ action: 'send', listId, content }` → toast `Message sent to N recipients`. Delete list uses a two-tap confirm pattern (button text flips to "Confirm delete"). DELETE `/api/broadcasts?id=...` → close + refresh.
- **Story views**: derive `headerViewsCount = Math.max(views.length, current.viewCount || 0)` so the pill is always accurate even before the views fetch resolves. Popover anchored `top-full left-0` below the views pill (in the header) so it never overlaps the bottom-area replies/reactions popovers. Includes loading spinner, "No views yet" empty state, and a scrollable list (`max-h-72`) with `UserAvatar` (32px) + name + @username + `timeAgo(viewedAt)`.
- **TDZ safety**: declared `headerViewsCount` (and the existing `headerReactionCount`) BEFORE the JSX return — both reference state used inside the return.

## Backend contracts consumed
- `GET /api/broadcasts` → `{ lists: [...] }`
- `POST /api/broadcasts { action: 'create', name, memberIds }` → `{ list: { id, name } }`
- `POST /api/broadcasts { action: 'send', listId, content }` → `{ ok, sent }`
- `DELETE /api/broadcasts?id=LIST_ID` → `{ ok }`
- `GET /api/stories/[id]/views` → `{ views: [...] }` (owner-only; non-owner receives 403 and we silently `setViews([])`).

## QA
- `bun run lint` → 0 errors, 0 warnings.
- `curl http://localhost:3000/` → 200.
- dev.log shows successful recompiles after both file changes (no TS / runtime errors).
- Did NOT touch any backend files, the realtime service, or any other existing component besides the three listed above.

## Notes for downstream agents
- The `Megaphone` icon is now imported in `nav.tsx`.
- The `BroadcastsView` is rendered inside `<header>` in `TopBar` — Radix Dialog portals to `body`, so this is fine; the header's `sticky`/`z-30` doesn't conflict with the dialog's `z-50`.
- If a sixth bottom-nav tab is ever desired for Broadcasts, the cleanest path is to extend the `View` union in `src/lib/store.ts` and add a `view === 'broadcasts'` branch in `src/app/page.tsx`. The current dropdown approach was chosen specifically to avoid that surgery.
