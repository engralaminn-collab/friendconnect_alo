# Task 13-suggestions — Friend Suggestions UI

## Summary
Added "People you may know" friend-suggestions section (powered by `GET /api/friends/suggestions`, mutual-friends-ranked) to BOTH HomeView and FriendsView. Surgical edits — no existing code/features removed.

## Files edited
1. `src/components/fc/home/HomeView.tsx` — switched suggestions data source from `/api/users/search?q=` (random users) to `/api/friends/suggestions` (mutual-friends-ranked). Enhanced the existing "People you may know" Card section with mutual-friends subtitle ("X mutual friends" or "Suggested for you") + premium "Top" gradient badge + `bg-primary/5 ring-1 ring-primary/20` row highlight for 3+ mutuals. Added `sendingId` loading state on the Add button.
2. `src/components/fc/friends/FriendsView.tsx` — added 5th "Suggested" tab (`grid-cols-5`). Added `Suggestion` interface + state + `loadSuggestions`/`addSuggestion` useCallbacks. Fetches on mount + when Suggested tab becomes active. Richer `SuggestionRow` (avatar/name/@username/mutual-friends/bio/location/Add-friend button) with `SuggestionSkeleton` loading state + `EmptyState` empty state. High-mutual premium highlight.

## Backend contract consumed
- `GET /api/friends/suggestions` → `{ suggestions: [{ id, username, name, photoUrl, bio, location, mutualFriends }] }`
- `POST /api/friends { action:'request', targetId }` (existing, reused for the Add button)

## Key decisions
- Inline `SuggestionRow` in each file (not shared) — the two variants differ intentionally: HomeView compact (horizontal card), FriendsView richer (vertical info).
- "Top" badge threshold: 3+ mutual friends.
- HomeView: removed redundant `load()` after `sendRequest` (optimistic filter + 15s interval suffice).
- FriendsView: fetch on mount + on tab activation (per task spec).
- `addSuggestion` reuses existing `actionLoading` state pattern (keyed `[id + 'request']`).

## Verification
- `bun run lint` → 0 errors, 0 warnings.
- Dev server returns 200 on `/`. `GET /api/friends/suggestions 200` confirmed in dev.log.
- No eslint-disable needed (useCallback-wrapped setState calls in useEffect don't trigger `react-hooks/set-state-in-effect`).
- No backend/realtime/API changes.
