# Task 15-callstats-filepreview — Call stats card + File previews

## Scope
Two surgical frontend features (NO backend changes, NO rewrites):
1. **CallsView.tsx** — premium call-duration stats card at top of the Calls view (consumes `GET /api/calls/stats`).
2. **ChatView.tsx MessageBubble** — inline PDF preview (`<iframe>` + header bar + fallback), image hover "view full size" overlay, audio-message card restyle, video border polish.

## Backend contract consumed
`GET /api/calls/stats` → `{ stats: { total, connected, missed, declined, outgoing, incoming, audioCalls, videoCalls, totalDurationSec, totalDurationLabel, avgDurationSec } }` (auth required — 401 unauth, route already implemented by 15-backend).

Document messages already carry `fileUrl`, `fileName`, `fileSize`, `mimeType` (from `/api/files/upload`) — no backend change needed for PDF preview.

## Edits — CallsView.tsx (additive only)
- **Imports**: added `type { ReactNode }`, lucide `PhoneMissed, PhoneIncoming, PhoneOutgoing, Mic, Clock, TrendingUp`.
- **Interface**: `CallStats` mirroring the backend payload.
- **State**: `stats`, `statsLoading` + `loadStats` callback (silent-fail). Wired into mount `useEffect` alongside `loadCalls`.
- **Render**: at top of `fc-scroll` container, before the call-history list:
  - `statsLoading` → stats skeleton (6 tiles + ratio bar).
  - `stats && stats.total > 0` → `<CallStatsCard stats={stats} />`.
  - otherwise (total 0) → hidden.
- **Components**: `CallStatsCard` (`m-2 rounded-2xl border border-border bg-card p-4 shadow-sm`, header row, 6-tile grid 2cols/3cols, outgoing-vs-incoming ratio bar, avg-duration footer) + `StatTile` helper (icon chip + big number + label; `valueClass`/`iconClass`/`isText` props).
- Missed tile uses `text-destructive` when `stats.missed > 0`.
- Existing call history list, start-call dialog, skeletons, empty state — UNCHANGED.

## Edits — ChatView.tsx MessageBubble (additive/replacement of media branches only)
- **Imports**: added lucide `Maximize2`.
- **Helper**: `isPdfMessage(msg)` — `mimeType === 'application/pdf'` OR fileName ends with `.pdf` (case-insensitive).
- **State**: `pdfFailed` (bool) + derived `isPdf` flag. Bubble padding switches to `p-1` when rendering a PDF so the iframe sits flush.
- **PDF branch** (inside `msg.type === 'document'`): wrapper `overflow-hidden rounded-lg border border-border bg-card`; header `flex items-center justify-between gap-2 rounded-t-lg bg-muted/40 px-3 py-1.5` with FileText + truncated fileName + size + "Open" download button; `<iframe src={msg.fileUrl} className="h-96 w-full border-0" onError={() => setPdfFailed(true)} />`. On error → `pdfFailed=true` → re-renders the existing download card as fallback. Header download button always present as escape hatch.
- **Image branch**: kept thumbnail + tap-to-open-dialog. Added `group` class on button + hover overlay `<span>` (top-right, `bg-black/55 backdrop-blur-sm`, `Maximize2` icon, opacity-0 → group-hover:opacity-100). Added aria-label.
- **Video branch**: kept `<video controls>`. Added `border border-border` to existing `rounded-lg bg-black`.
- **Audio branch**: wrapped existing `<audio controls>` + Mic chip in `rounded-2xl bg-gradient-to-br from-primary/10 to-accent/20 p-3`; chip bumped to `h-9 w-9 bg-primary/25`; audio element `h-9`.
- **Non-PDF document branch**: unchanged existing download card.
- All other MessageBubble features (reactions, reply/forward/star/delete/edit menu, edited indicator, forwarded label, deleted placeholder, status ticks, etc.) — UNCHANGED.

## Verification
- `bun run lint` → 0 errors, 0 warnings.
- `curl http://localhost:3000/` → 200. Dev log shows clean recompile.
- `curl /api/calls/stats` → 401 (route exists, requires auth — expected).
- Realtime service, API routes, Prisma schema, db — UNTOUCHED.

## Decisions / notes
- Hide stats card entirely when `stats.total === 0` (per spec). Show stats skeleton during initial fetch for layout continuity.
- PDF iframe onError is unreliable cross-browser; the header "Open" button always provides a download path so users have an escape hatch even when onError doesn't fire.
- Bubble padding for PDFs switches to `p-1` (same as image/video) so the iframe header sits flush with the bubble edge.
- Outgoing-vs-incoming ratio bar: primary color (outgoing) + primary/40 (incoming). NO indigo/blue.
- `/* eslint-disable react-hooks/set-state-in-effect */` was NOT needed — no set-state-in-effect violations introduced.
