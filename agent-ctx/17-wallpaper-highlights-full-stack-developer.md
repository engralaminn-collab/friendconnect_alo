# Task 17-wallpaper-highlights — full-stack-developer (Custom wallpaper + story highlights)

## Task
Surgically extend two existing components to ship round-7 frontend features:
1. **Custom chat wallpaper upload** — `src/components/fc/chat/ChatView.tsx` (ChatSettingsSheet).
2. **Story highlights** — `src/components/fc/stories/StoriesBar.tsx` + `src/components/fc/stories/StoryViewer.tsx`.

Backend contracts (already shipped by task 17-backend, not touched):
- `POST /api/files/upload` (FormData `file`) → `{ file: { id, url, name, mimeType, size } }`.
- `POST /api/messages/preferences { peerId, wallpaper }` — wallpaper is a CSS background value.
- `GET /api/stories` now returns `{ stories: [{ ..., stories: [...active], highlights: [...saved] }] }` with `isHighlight: boolean` on each item.
- `POST /api/stories/[id]/highlight { highlight: true|false }` (owner only).

## Work Log
- Read `worklog.md` end-to-end to learn the architecture (rounds 1–6 features in ChatView, the round-7 backend additions, the styling rules: emerald/teal brand, no indigo/blue).
- Read the existing `ChatView.tsx` `ChatSettingsSheet` (8 preset wallpaper swatches in a 4-col grid, `aspect-[2/5]` tiles, `handleWallpaperChange` does optimistic set + POST `/api/messages/preferences` + toast).
- Read `StoriesBar.tsx` + `StoryViewer.tsx` + `src/app/api/stories/route.ts` + `src/app/api/stories/[id]/highlight/route.ts` to confirm the highlight grouping + toggle contract.
- **Feature 1 (ChatView.tsx)** — surgical edits:
  - Added `Camera, Image as ImageIcon` to the lucide import block.
  - Added `handleCustomWallpaperUpload(file)` callback in `ChatRoom`: validates image type, `uploadFile(file)` → builds `url('${uploaded.url}')` (single-quoted for special-char safety), `setWallpaper(value)`, POST `/api/messages/preferences`, toast `Custom wallpaper set`, reverts on error.
  - Passed `onCustomWallpaperUpload={handleCustomWallpaperUpload}` to `ChatSettingsSheet`.
  - Extended `ChatSettingsSheet` props with `onCustomWallpaperUpload?: (file: File) => Promise<void>`.
  - Added `uploading` state + `fileInputRef` + `isCustomWallpaper` (regex `/^url\(/i`) + `handleCustomPick` change handler.
  - Added a 9th tile in the Wallpaper grid (`bg-muted`, `aspect-[2/5]`, centered `ImageIcon` + `Custom` label in `text-[9px]`, `Loader2` spinner while uploading, `Check` badge + `ring-primary` when active wallpaper is a custom url). Hidden `<input type="file" accept="image/*">` triggers upload → on success closes the sheet.
- **Feature 2 (StoryViewer.tsx)** — surgical edits:
  - Added `Bookmark` to lucide imports.
  - Added `isHighlight: boolean` to `StoryItem` interface.
  - Added `startIndex?: number` + `onHighlightChange?: (storyId, isHighlight) => void` to `StoryViewerProps`.
  - `useState` for `index` now initialises from `startIndex` (clamped to `[0, stories.length)`).
  - Added `highlightOverrides: Record<string, boolean>` + `highlightBusy` state for optimistic UI.
  - Added `handleToggleHighlight` callback: optimistic local override → POST `/api/stories/[id]/highlight` → toast `Added to highlights` / `Removed from highlights` → `onHighlightChange?.()` → revert on error.
  - Derived `isHighlighted = highlightOverrides[current.id] ?? current.isHighlight`.
  - Added bookmark button at `absolute right-16 top-4 z-20` (next to close), `bg-black/40 backdrop-blur rounded-full`, filled (`fill-current text-primary`) when highlighted, `Loader2` while busy, only rendered when `user.isMe`.
- **Feature 2 (StoriesBar.tsx)** — surgical edits:
  - Added `Bookmark` to lucide imports, `SectionTitle` to `@/components/fc/ui` imports.
  - Added `highlights: StoryItem[]` to `StoryUser` interface (matches backend grouping).
  - Replaced `viewerUser` state with `viewer: { user, list: 'stories' | 'highlights', startIndex? } | null` so the same viewer can show either list.
  - Added `highlights: []` to the synthetic `myGroup` fallback.
  - `ordered` (main stories row) now filters out friends with only highlights (they appear exclusively in the highlights section).
  - Added `highlightEntries` (flat list of `{ user, story }` across me + friends) for the highlights row.
  - Added `openHighlightAt(g, storyId)` that opens the viewer on a user's highlights array at the tapped highlight's index.
  - Rendered a `HIGHLIGHTS` section (`mt-3`, `SectionTitle`) below the stories row: horizontal scroll of 40px circular thumbnails (image preview for image stories, gradient bg + tiny text snippet for text stories) with a bookmark badge + truncated username label.
  - Updated the `StoryViewer` invocation to pass `stories` from the chosen list, `startIndex`, and `onHighlightChange={() => load()}` so the parent refreshes after a toggle.
  - Added `HighlightThumbnail` helper component (image vs text rendering).
- Lint: `bun run lint` → 0 errors, 0 warnings after removing an unused `eslint-disable` directive.
- Dev server: confirmed `GET / 200` in `dev.log`; no compile errors.

## Stage Summary
- Two round-7 frontend features shipped surgically with zero regression to existing ChatView (reactions, pin/mute, search, voice notes, delete/forward, star, disappearing, presets wallpaper, drafts, archive, edit, group-typing, global search, message pin, PDF preview) and StoriesBar/StoryViewer (stories bar, create dialog, viewer, replies, auto-advance, tap zones, keyboard nav, touch swipe).
- Files modified (additive only):
  - `src/components/fc/chat/ChatView.tsx` — +`Camera`/`ImageIcon` imports, +`handleCustomWallpaperUpload`, +`onCustomWallpaperUpload` prop on `ChatSettingsSheet`, +Custom wallpaper tile + hidden file input + uploading state.
  - `src/components/fc/stories/StoryViewer.tsx` — +`Bookmark` import, +`isHighlight` on `StoryItem`, +`startIndex`/`onHighlightChange` props, +`highlightOverrides`/`highlightBusy` state, +`handleToggleHighlight`, +bookmark button.
  - `src/components/fc/stories/StoriesBar.tsx` — +`Bookmark`/`SectionTitle` imports, +`highlights` on `StoryUser`, +`viewer` state (replaces `viewerUser`), +`highlightEntries`, +`openHighlightAt`, +HIGHLIGHTS section, +`HighlightThumbnail` helper.
- Decisions:
  1. Custom wallpaper value stored as `url('${uploaded.url}')` (single-quoted) so special chars in the URL don't break the CSS value; the existing `style={{ background: wallpaper }}` on the messages scroll area handles it transparently.
  2. `isCustomWallpaper` detected via `/^url\(/i` regex so the Custom tile shows the selected ring + Check badge when an uploaded image is active.
  3. StoryViewer uses a local `highlightOverrides` map (instead of cloning the stories array) so the bookmark icon flips immediately on toggle without disturbing the rest of the viewer's state. The parent is notified via `onHighlightChange` so the highlights section refreshes, but `viewer.user` retains its old object reference so the open viewer's `stories` prop stays stable (no index shifting mid-view).
  4. `startIndex` prop on StoryViewer lets the user open the viewer directly on a specific highlight (rather than always starting at index 0).
  5. Main stories row filters out friends with only highlights (no active stories) — they appear exclusively in the HIGHLIGHTS section, avoiding dead avatar clicks.
  6. Bookmark button at `right-16 top-4 z-20` per spec (next to the close button which sits in the z-30 header), with `bg-black/40 backdrop-blur` pill so it stays legible over any story background.
  7. For other users' highlights, the viewer is read-only — no bookmark button since `user.isMe` is false.
- Backend, realtime service, API routes, Prisma schema — untouched.
