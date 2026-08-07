# Task 16-lastseen-filters — full-stack-developer (Last-seen + photo filters)

## Task
Implement two FriendConnect features described in worklog Task ID 16-backend:
1. **Last-seen granularity** — rewrite `lastSeenText` in `src/lib/api.ts` to produce
   "online" / "offline" / "last seen just now" / "last seen 5m ago" / "last seen 2h ago"
   / "last seen yesterday" / "last seen 3d ago" / "last seen Jan 5", and add a new
   `formatLastSeenPrecise(lastSeen)` helper that returns `{ label, detail }` for a
   richer profile-view display.
2. **Profile photo filters** — `UserAvatar` accepts an optional `filter?: string`
   (CSS filter) applied to `AvatarImage` only; `ProfileView` shows a Sparkles
   filter-picker popover next to the camera button (9 presets), persists the choice
   via `PUT /api/users/me { photoFilter }`, and applies the filter to the avatar in
   real-time. Other-user profile view also passes the filter through.

## Work Log
- Read `/home/z/my-project/worklog.md` end-to-end (Tasks 0 → 16-backend) to confirm
  architecture, API contracts, hooks (`useAuth`, `useSocket`), and the emerald/teal
  styling rule. Verified Task 16-backend added `Profile.photoFilter` + `Message.pinnedBy`,
  added `GET /api/messages/search` + `POST /api/messages/[id]/pin`, and exposed
  `photoFilter` in `/api/auth/me`, `/api/users/me`, `/api/users/[id]`. Updated
  `ProfileData` type in `src/hooks/use-auth.tsx` to include `photoFilter: string | null`.
- Inspected existing files before editing: `src/lib/api.ts`, `src/components/fc/ui.tsx`,
  `src/components/fc/profile/ProfileView.tsx`, `src/app/api/users/me/route.ts`,
  `src/app/api/users/[id]/route.ts`, `src/app/api/auth/me/route.ts`,
  `src/hooks/use-auth.tsx`, `src/components/ui/popover.tsx`, `src/components/ui/avatar.tsx`.
  Confirmed: PUT `/api/users/me` treats `photoFilter` as a string field with empty
  string → null; GET `/api/users/[id]` already returns `photoFilter`; `AvatarImage`
  passes `style` through to the underlying `<img>` so a CSS filter applies cleanly.
- Feature 1 — last-seen granularity (`src/lib/api.ts`):
  - Added two private helpers: `isYesterday(d, now)` (calendar-day comparison, not a
    naive 24h window — handles the "11:55pm yesterday, 12:05am today" case) and
    `shortMonthDay(iso)` (e.g. "Jan 5").
  - Rewrote `lastSeenText(online, lastSeen)` with the exact tier list from the spec:
    online → "online"; null/invalid → "offline"; future timestamp (clock skew) →
    "online"; <1m → "last seen just now"; <1h → "last seen {n}m ago"; <24h →
    "last seen {n}h ago"; calendar-yesterday → "last seen yesterday"; <7d →
    "last seen {n}d ago"; older → "last seen {MMM d}". Same name + signature as
    before, so all existing call sites (ChatView header, ProfileView) automatically
    pick up the new granularity.
  - Added `formatLastSeenPrecise(lastSeen): { label, detail }`. `label` is a short
    string ("online" / "offline" / "now" / "5m" / "2h" / "yesterday" / "Jan 5");
    `detail` is the full sentence ("last seen 5 minutes ago at 3:42 PM"). Treats
    `lastSeen` within the last 30s as effectively online (realtime service writes
    lastSeen on socket disconnect, so a fresh timestamp means the socket was just
    alive).
- Feature 2 — photo filters:
  - `src/components/fc/ui.tsx`: added `filter?: string | null` prop to `UserAvatar`.
    Normalizes null/undefined/"" /"none" → no filter. When provided, applies
    `style={{ filter }}` to `<AvatarImage>` only — the `AvatarFallback` (initials
    circle) is untouched, so users without a photo still get the branded emerald
    fallback. The `online` presence dot is also unaffected.
  - `src/components/fc/profile/ProfileView.tsx`:
    - Added `Popover, PopoverContent, PopoverTrigger` + `Sparkles, Loader2` imports,
      added `cn` from `@/lib/utils`, added `formatLastSeenPrecise` to the api import,
      added `AuthUser` to the use-auth import (used as a prop type for the picker).
    - Extended `ProfileResult.user` interface with `photoFilter: string | null` and
      `lastSeen?: string | null` (both optional so the existing backend response
      shape — which only returns photoFilter, not lastSeen, for other users —
      type-checks).
    - **Other-user profile header**: `UserAvatar` now passes `filter={u.photoFilter}`
      so the chosen filter renders for visitors; the status `<p>` uses
      `lastSeenText(online, u.lastSeen)` (was previously hardcoded to `null`,
      losing granularity) and carries a `title` tooltip with
      `formatLastSeenPrecise(u.lastSeen).detail` for hover-rich display.
    - **MyProfile header**: `UserAvatar` now passes `filter={p?.photoFilter}` so
      the current user sees their own filter live. Added a small `Active now` /
      precise last-active line below the email using `formatLastSeenPrecise`
      combined with `useSocket().isOnline(user.id)` (prefers the live socket
      presence flag over the timestamp). If the user has never been seen
      (`lastSeen` is null and not online), the line is hidden rather than showing
      a misleading "offline".
    - Added a `PhotoFilterPicker` component (rendered next to the camera button in
      a small flex cluster at the avatar's bottom-right): a Sparkles-icon button
      (`bg-primary/15 text-primary`, 8×8 round) triggers a `Popover` with a 3-column
      grid of 9 preset filters (None, Grayscale, Sepia, Saturate, Contrast, Bright,
      Vintage, Cool, Warm). Each tile is a 48px `UserAvatar` preview with the
      filter applied + name below (`text-[10px]`); the selected tile gets
      `ring-2 ring-primary` + an `sr-only` "Selected" marker for screen readers.
      Clicking a tile calls `PUT /api/users/me { photoFilter: '' | '<css-value>' }`
      (empty string clears, per backend convention), `await refresh()` from
      `useAuth` (so the avatar in the header re-renders with the new filter
      immediately), then `toast.success('Photo filter updated')` and closes the
      popover. A `Loader2` spinner overlays the in-flight tile; all tiles disable
      during the request to prevent double-submits. Errors toast the server
      message.
- Verified end-to-end with curl + the demo accounts:
  - Login as aria → `PUT /api/users/me { photoFilter: "grayscale(1)" }` → 200;
    `GET /api/auth/me` returns `photoFilter: "grayscale(1)"`. ✓
  - `PUT { photoFilter: "" }` → clears to `null`. ✓
  - Login as bilal → `GET /api/users/<aria-id>` returns `photoFilter: "sepia(0.6)"`
    (cross-user visibility works). ✓
  - Boundary tests for the helper logic: 5s ago → "online"/"active now"; 45s →
    "now"; 5m → "5m"/"last seen 5 minutes ago at HH:MM PM"; 2h → "2h"; yesterday
    (26h ago) → "yesterday"; 10d → "Jan 5"-style date. All pass.
- Ran `bun run lint` → 0 errors, 0 warnings. Verified dev server: `GET /` returns
  HTTP 200; recent `dev.log` shows `PUT /api/users/me 200` and
  `GET /api/users/<id> 200` from my test runs, no errors.

## Stage Summary
- Files produced/edited:
  - `src/lib/api.ts` — rewrote `lastSeenText`, added `formatLastSeenPrecise`,
    added private `isYesterday` + `shortMonthDay` helpers. Backward-compatible:
    same exported names + signatures; all existing call sites (ChatView header,
    ProfileView other-user) automatically pick up the improved granularity.
  - `src/components/fc/ui.tsx` — added optional `filter?: string | null` prop to
    `UserAvatar`. Applied only to `AvatarImage` (fallback + presence dot
    untouched). All existing callers continue to work — the prop is optional and
    defaults to no filter.
  - `src/components/fc/profile/ProfileView.tsx` — added `PhotoFilterPicker`
    component + `PHOTO_FILTERS` preset array; applied the `filter` prop to both
    the MyProfile avatar (from `useAuth().user.profile.photoFilter`) and the
    other-user profile avatar (from `GET /api/users/[id]` response); switched
    other-user status to `lastSeenText(online, u.lastSeen)` (was `null`) +
    added `formatLastSeenPrecise` detail as a `title` tooltip; added an
    `Active now` / last-active line under the email in MyProfile.
- Backend untouched (no changes to realtime service, API routes, or Prisma
  schema) — all work consumed the existing Task 16-backend contracts.
- Lint clean (`bun run lint` → 0 errors / 0 warnings). Dev server returns HTTP
  200 on `/`. API smoke-tested end-to-end with curl.
- Decisions:
  - Filter prop normalized so `"none"` and `""` both mean "no filter" — the
    PHOTO_FILTERS preset uses `"none"` as the sentinel for the "None" tile, but
    the backend stores `null` (sent as `""`). This avoids a confusing
    `"none"`-vs-`null` mismatch in the DB.
  - "Yesterday" is a calendar-day check (not 24h-ago) so an 11:55pm-last-seen
    at 12:05am-today correctly says "yesterday" instead of "5m ago" (which the
    tier ladder would otherwise produce via the <1h bucket).
  - `formatLastSeenPrecise` treats lastSeen within 30s as "online" — the
    realtime service updates lastSeen on socket disconnect, so a fresh
    timestamp implies the socket is alive. Call sites can override with the
    `useSocket().isOnline()` flag (MyProfile does this).
  - Did NOT thread `photoFilter` through conversation-list / friends-list /
    HomeView endpoints — per task spec, kept scoped to (a) current user via
    useAuth, (b) other-user profile via GET /api/users/[id]. Future agents can
    extend `UserAvatar filter={...}` to other surfaces trivially since the
    prop is now in place.
