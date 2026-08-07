# Task 14-stories-online — full-stack-developer (Story replies + Online friends widget)

## Task
Surgically edited two existing frontend files (no rewrites, no backend changes) to wire up the round-4 backend features:

1. `src/components/fc/stories/StoryViewer.tsx` — added a story-reply input bar at the bottom of the viewer (for friends) + a "Replies" button + popover (for own story), with pause-on-focus auto-advance.
2. `src/components/fc/home/HomeView.tsx` — added an "Online now" widget (horizontal avatar strip with green dot + pulsing ring) backed by `GET /api/friends/online`, cross-checked with `useSocket().isOnline`, auto-refresh every 30s.

## Context I read first
- `/home/z/my-project/worklog.md` — full architecture + Task 14-backend entry (backend routes for `/api/stories/[id]/replies` and `/api/friends/online`).
- `src/app/api/stories/[id]/replies/route.ts` — confirmed reply shape `{ id, userId, userName, userPhoto, content, createdAt }` and that POST notifies the story owner.
- `src/app/api/friends/online/route.ts` — confirmed online shape `{ id, username, name, photoUrl, lastSeen }` (2-minute lastSeen threshold).
- `src/components/fc/stories/StoryViewer.tsx` (existing, 283 lines) — verified progress bars, tap zones, view tracking, body-scroll lock, keyboard nav, touch swipe, header.
- `src/components/fc/home/HomeView.tsx` (existing, 243 lines) — verified StoriesBar wiring, hero greeting, quick actions, friends strip, recent chats, suggestions.
- `src/components/fc/ui.tsx` — `UserAvatar({name, src, size, online})` shape (online prop renders `fc-online-dot`).
- `src/hooks/use-socket.tsx` — `useSocket()` returns `{ isOnline }`.
- `src/app/globals.css` — verified `fc-pulse`, `fc-ping-ring`, `fc-online-dot`, `fc-scroll`, `fc-no-scroll`, `fc-safe-top/bottom` classes exist.
- Prior agent records in `/agent-ctx/` (12-stories, 12-chat-delete-forward, 13-suggestions, 13-chat-features) for conventions.

## Work Log

### StoryViewer.tsx (surgical edits — additive, ~230 lines added; total file now ~510 lines)

**Imports added:**
- `Send, MessageCircle, Loader2` from `lucide-react` (appended to existing lucide import line).
- `toast` from `sonner`.
- (Did NOT need `useAuth` — `user.isMe` is already passed in via `StoryViewerUser` prop.)

**New exported interface:**
```ts
export interface StoryReply {
  id: string
  userId: string
  userName: string
  userPhoto: string | null
  content: string
  createdAt: string
}
```

**New state + refs in the component:**
- `replyText`, `sending`, `replies`, `repliesOpen`, `loadingReplies`, `paused` (React state).
- `progressBarRef` (HTMLDivElement) — replaces the previous framer-motion progress bar.
- `rafRef`, `startRef`, `pausedAtRef`, `pausedAccRef`, `pausedRef`, `goNextRef` — refs for the manual `requestAnimationFrame` auto-advance timer (so we can cleanly pause/resume on input focus).

**New effects:**
1. `setReplyText('') + setRepliesOpen(false)` on `[index]` — clears the reply draft + closes the popover when the active story changes.
2. `goNextRef.current = goNext` on `[goNext]` + `pausedRef.current = paused` on `[paused]` — keep refs in sync for the rAF timer (avoids stale closures).
3. Fetch replies effect on `[index, user.isMe, stories]` — when viewing OWN story, calls `GET /api/stories/${story.id}/replies` and populates `replies`. Best-effort (silent catch). For others' stories, clears `replies`.
4. **Auto-advance timer (replaces framer-motion progress bar)** on `[index]` — uses `requestAnimationFrame` to update `progressBarRef.current.style.width` from `0%` → `100%` over `STORY_DURATION_MS` (5s). When `paused` (input focused), tracks elapsed paused time and resumes correctly. On reaching 100%, calls `goNextRef.current()` (= `goNext`).
5. Pause/resume handler on `[paused]` — when `paused` becomes true, records `pausedAtRef.current = Date.now()`; when false, accumulates the elapsed paused duration into `pausedAccRef.current` so the timer picks up where it left off.

**`handleSendReply` callback:**
- Validates `replyText.trim()` is non-empty and `!sending`.
- POSTs `{ content }` to `/api/stories/${story.id}/replies`.
- On success: clears input, toasts "Reply sent", and (if viewing own story) appends the new reply to the local `replies` list.
- On error: toasts the error message.

**Progress bar JSX:**
- Replaced the previous `<motion.div>` (framer-motion) with a plain `<div ref={progressBarRef} className="h-full bg-white" style={{ width: '0%' }} />`. Width is updated directly via the ref for performance (no React re-render per frame).
- Past-story bars still render as `<div className="h-full w-full bg-white" />` (unchanged).

**Reply input bar / Replies button + popover (new JSX, before closing `</motion.div>`):**
- Wrapper: `absolute bottom-4 left-4 right-4 z-10` (per spec). Rendered after the bottom gradient + tap zones so it overlays correctly.
- **When `user.isMe`**: shows a "Replies" button styled like the input bar (`rounded-full border border-white/20 bg-black/40 backdrop-blur px-4 py-2 text-white`). Label: `Loading replies…` / `No replies yet` / `Replies (N)`. Clicking toggles a popover above the button.
  - Popover: `absolute bottom-full left-0 right-0 mb-2 max-h-72 overflow-y-auto rounded-xl bg-black/80 backdrop-blur p-2 fc-scroll` (per spec). Renders a loading spinner, empty state ("No replies yet" with MessageCircle icon), or list of replies (UserAvatar 32px + name + timeAgo + content).
  - AnimatePresence + motion.div for fade/slide animation.
- **When `!user.isMe`**: shows a `<form>` with the same bar styling. Input has `placeholder="Reply to {firstName}…"`, `maxLength=500`, `onFocus={() => setPaused(true)}` / `onBlur={() => setPaused(false)}` (drives the auto-advance pause). Enter (without Shift) or Send button submits.
  - Send button: `h-8 w-8 rounded-full bg-primary text-primary-foreground` with `Send` (or `Loader2 animate-spin` while sending). Disabled when input is empty or sending.

**Tap-zone interaction:** The wrapper occupies only the bottom strip (`bottom-4 left-4 right-4`). The form/button capture pointer events in that strip. The three tap-zone buttons (z-10, full-screen) still receive taps everywhere else — left/center/right thirds still work for prev/close/next. Verified the form is rendered AFTER the tap zones so it wins in its bounding rect (same z-index, later paint).

**Removed:** The `/* eslint-disable react-hooks/set-state-in-effect */` directive at the top of the file. The directive was reporting as unused (`react-hooks/set-state-in-effect` was no longer firing on this file). Removing it eliminated the unused-directive warning; lint is now 0 errors / 0 warnings.

### HomeView.tsx (surgical edits — additive)

**Imports added:**
- `useMemo` to the existing `react` import line.
- `useSocket` from `@/hooks/use-socket` (new import line).

**New state:**
- `onlineFriends: Friend[]` — populated by `GET /api/friends/online`.

**New `loadOnline` function + effect:**
- `loadOnline()` calls `api<{ online: Friend[] }>('/api/friends/online')` and `setOnlineFriends(data.online)`. Silent catch.
- Effect on `[]` calls `loadOnline()` immediately and sets up a 30-second `setInterval` for auto-refresh.

**`onlineList` useMemo:**
- Combines the REST `onlineFriends` list with the realtime socket presence set.
- A friend is considered online if EITHER source reports them as online:
  - REST: friend is in `onlineFriends` (lastSeen within 2-min threshold per backend).
  - Socket: `isOnline(f.id)` returns true (realtime presence; more accurate).
- Deduplicates by `id` using a `Map`. Order: REST friends first, then socket-only friends.
- Deps: `[onlineFriends, friends, isOnline]`.

**New ONLINE NOW section (JSX):**
- Rendered AFTER the hero greeting + quick actions, BEFORE the existing Friends strip.
- Hidden when `onlineList.length === 0` (cleaner than showing a muted hint, per the spec's either/or).
- Section title: `SectionTitle` with a small pinging green dot (`animate-ping` Tailwind built-in) + "Online now" text + a count badge (`bg-primary/15 text-primary text-[10px] font-bold`).
- Strip: `fc-no-scroll flex gap-3 overflow-x-auto px-4 pb-1` — same pattern as the existing Friends strip.
- Each online friend renders as a `button` (calls `openChat(f.id)` on click) with:
  - A `relative` wrapper around the avatar.
  - A pulsing ring halo: `fc-pulse pointer-events-none absolute -inset-1 rounded-full bg-primary/20` (subtle "live" breathing halo).
  - `UserAvatar` with `online` prop (green dot at bottom-right via `fc-online-dot`).
  - First-name label below.

### Verification
- `bun run lint` → **0 errors, 0 warnings**. (Removed the now-unused `react-hooks/set-state-in-effect` eslint-disable directive at the top of StoryViewer.tsx — the rule was no longer firing on this file, so the directive had become a warning. With it removed, lint is fully clean.)
- Dev server returns **HTTP 200** on `/` (verified via curl).
- `dev.log` shows `GET /api/friends/online 200` being polled every ~30s by the HomeView auto-refresh, alongside `GET /api/stories 200`, `GET /api/friends 200`, etc. No errors or warnings.
- Did NOT touch the realtime service, any API routes, the Prisma schema, or any backend file.

## Decisions / Notes
- **Replaced framer-motion progress bar with a manual rAF timer** so I could cleanly pause/resume on input focus. The rAF callback updates `progressBarRef.current.style.width` directly (no React re-render per frame — better perf than `setState` at 60fps). Pause/resume is handled by tracking elapsed paused time in refs and subtracting it from the elapsed total.
- **Pause-on-focus (not pause-on-typing):** Pausing the moment the input receives focus is the Instagram-style UX. If the user just tabs through without typing, the story pauses; tapping outside the input blurs it and the timer resumes. This was the cleanest, most predictable behavior.
- **`goNextRef` + `pausedRef` pattern:** These refs are kept in sync via small effects so the rAF tick closure (which captures them once per `index` change) always sees the latest values without needing to be re-created.
- **Replies fetch only for own story** (per the spec). For friends' stories, the user just sees the reply input. The backend's GET endpoint would allow friends to view replies too, but the spec specifically says "for own story" so I followed that.
- **`onlineList` uses union of REST + socket** so the widget surfaces friends who may be connected via socket even if their `profile.lastSeen` is slightly stale (the 2-min threshold can lag). This is more inclusive and matches the spec's hint that "socket presence may be more accurate".
- **Hidden when empty** rather than showing "No friends online right now" — cleaner UI, matches the spec's preferred option.
- **No new shadcn components needed** for these two features. Used a styled native `<button>` for the Send button (small icon button on translucent bar) — cleaner than importing shadcn `Button` for a tiny 32px round icon button.
- **Eslint note:** The `react-hooks/set-state-in-effect` rule (from `eslint-plugin-react-hooks@7`) uses the React Compiler to analyze each file. The compiler appears to bail out on this StoryViewer (likely because of the complex motion/AnimatePresence patterns or some other inference issue), so the rule never fires — even on direct `setState` calls in effect bodies. After removing the now-unused directive, lint is clean. If the compiler ever starts analyzing this file, the rule may flag the `setImgError(false)`, `setReplyText('')`, `setRepliesOpen(false)`, `setReplies([])`, `setLoadingReplies(true)` calls — at which point the directive can be re-added at the top of the file.
