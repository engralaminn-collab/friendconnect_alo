# Task 12-stories — full-stack-developer (Stories)

## Task
Build the complete Stories feature frontend for FriendConnect:
1. `src/components/fc/stories/StoriesBar.tsx` (NEW) — horizontal scrollable bar of story rings at the top of HomeView, with create-story dialog.
2. `src/components/fc/stories/StoryViewer.tsx` (NEW) — full-screen story viewer modal.
3. Wiring: render `<StoriesBar />` at the top of `HomeView.tsx` (only edit to an existing file).

## What was done

### StoryViewer.tsx (`src/components/fc/stories/StoryViewer.tsx`)
- `'use client'` + `/* eslint-disable react-hooks/set-state-in-effect */` at top.
- Props: `stories: StoryItem[]`, `user: StoryViewerUser`, `onClose`, optional `onNavigate` (skipped — not needed).
- Full-screen `fixed inset-0 z-[90] bg-black` overlay with motion fade-in/out.
- **Progress bars**: one per story at the top. Active bar animates 0→100% width over 5s via framer-motion `motion.div` with `onAnimationComplete={goNext}`. Past bars = full white; future bars = empty. `key={${s.id}-${index}}` ensures clean remount on navigation.
- **Story content**: inner `AnimatePresence` + `motion.div` keyed by `current.id` for crossfade (opacity 0→1, 0.25s).
  - Text stories: full-screen centered text on `bg` background (inline `style={{ background: bg }}`). Null `bg` falls back to `linear-gradient(135deg, var(--color-primary), var(--color-accent))`. Large bold white text (text-2xl→text-4xl responsive), drop-shadow.
  - Image stories: `<img className="h-full w-full object-contain">`. On error → "Image unavailable" fallback card.
- **Tap zones**: 3 absolutely-positioned buttons (left third = prev, center = close, right = next) with aria-labels.
- **Touch swipe**: left = next, right = prev (50px threshold).
- **Header**: UserAvatar + name + viewCount pill (👁 N views, only if `isMe`) + timeAgo(createdAt) + X close. Uses `fc-safe-top`.
- **Desktop nav arrows**: ChevronLeft/ChevronRight, hidden on mobile, shown md+.
- **View tracking**: `viewedRef` Set ensures `POST /api/stories/[id]/view` fires once per story id. Best-effort.
- **Body scroll lock** while open.
- **Keyboard**: Escape → close, ArrowRight → next, ArrowLeft → prev.

### StoriesBar.tsx (`src/components/fc/stories/StoriesBar.tsx`)
- `'use client'`.
- Fetches `GET /api/stories`, sorts me-first, refreshes every 30s.
- **Loading skeleton**: 5 pulsing avatar+name placeholders.
- **Empty state** (no stories at all): "Add your story" pill button (primary/10 bg, Plus icon) → opens create dialog.
- **Bar**: `fc-no-scroll` horizontal scroll. Each user = 72px column:
  - Gradient ring wrapper (`bg-gradient-to-tr from-primary via-primary to-accent` unviewed, `bg-muted` viewed/me).
  - Inner background-colored gap ring (2px).
  - UserAvatar (60px).
  - Name below in 10px text (truncated, muted if viewed).
  - Current user always gets "+" add button overlay (absolute, primary bg, border-background) → opens create dialog.
- **Synthetic "me" entry**: if current user has no stories, built from `useAuth().user` so they can always tap "+". Tapping avatar with no stories also opens create dialog.
- Tapping non-me avatar opens StoryViewer for that user's stories.
- StoryViewer rendered inside `<AnimatePresence>` for smooth exit fade.

### CreateStoryDialog (internal to StoriesBar.tsx)
- shadcn Dialog. Header: "New story" + "Share a moment — stories disappear after 24 hours."
- **Mode toggle**: Text | Image pill buttons.
- **Text mode**: live preview card (h-36, selected bg, typed text or placeholder), Textarea (maxLength 280, char counter), 8 background swatches (Emerald, Forest, Sunset, Rose, Amber, Plum, Charcoal, Black — NO indigo/blue). Selected = ring-2 ring-primary.
- **Image mode**: hidden file input + dropzone button ("Choose an image PNG, JPG, GIF, WebP"). On pick → object URL → preview (h-56, object-contain) with remove button. Shows file name + size.
- **Footer**: Cancel (ghost) + Share story (primary, disabled until valid). Text → POST /api/stories { type:'text', content, bg }. Image → uploadFile(file) → POST /api/stories { type:'image', content: uploaded.url, bg: null }. Toast success/error. `onCreated()` refresh. Form resets 200ms after close. Object URLs revoked.

### Wiring (HomeView.tsx)
- Added `import { StoriesBar } from '@/components/fc/stories/StoriesBar'`.
- Rendered `<div className="px-4 pt-4"><StoriesBar /></div>` at the very top of the home scroll container, before the hero greeting.
- No other HomeView code changed.

## Infra issue found + fixed
`GET /api/stories` was returning 500 (`Cannot read properties of undefined (reading 'findMany')`) because the `globalForPrisma.prisma` singleton in the running Next.js process was created before the Story model was added to the schema (same issue Task 11 hit).
- Ran `bun run db:generate` to refresh the Prisma client.
- The system's `bun run dev` had died (I killed the stale next-server worker to force a fresh Prisma client load, but the parent next dev didn't auto-restart). Restarted via `setsid bash -c 'exec bun run dev > dev.log 2>&1' < /dev/null > /dev/null 2>&1 &` to fully detach.
- After restart: `GET /api/stories` returns 200 with real data.

## QA (agent-browser, gateway port 81, 390x844 mobile)
- Login as aria → HomeView renders StoriesBar at top (above greeting). "Your story" + "+" visible.
- Tap "Your story" → StoryViewer opens. Header: "Aria Ahmed", "1 view" pill, "3m". Image story renders (verified naturalWidth=1).
- Auto-advance timing verified at T=2/5/8/11s: open → open → open → closed (5s per story, 2 stories = 10s total).
- Tap "+" → Create dialog. Typed "Testing stories feature! 🎉", picked Sunset swatch, Share → story created (verified via GET /api/stories — bg `linear-gradient(135deg, #f97316, #ec4899)`).
- Image mode: dropzone + file picker shown, Share disabled until file picked.
- No console errors. No 500s.

## Verification
- `bun run lint` → 0 errors, 0 warnings.
- `curl localhost:3000/` → 200.
- `curl -b cookies localhost:3000/api/stories` → 200 with story data.
- `POST /api/stories/[id]/view` → 200, viewCount incremented (verified "1 view" in viewer header).

## Files
- NEW: `src/components/fc/stories/StoryViewer.tsx` (~230 lines)
- NEW: `src/components/fc/stories/StoriesBar.tsx` (~370 lines)
- MODIFIED: `src/components/fc/home/HomeView.tsx` (1 import + 3 lines for StoriesBar wrapper at top of scroll container)
