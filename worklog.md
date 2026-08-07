# FriendConnect — Worklog & Architecture Handover

## Project Status
FriendConnect is a private social platform (Next.js 16 + Prisma SQLite + socket.io realtime + WebRTC).
The backend (Prisma schema, all API routes, realtime mini-service) and frontend shell + auth/home/friends/profile/notifications/settings views are **complete and lint-clean**. The dev server runs on port 3000, realtime service on port 3003.

The remaining big features to build are: **ChatView** (WhatsApp-style realtime), **CallsView + CallOverlay** (WebRTC), and **GroupsView**. These are stubbed with minimal placeholders and must be replaced with full implementations.

## Tech Stack & Conventions
- Next.js 16 App Router, TypeScript, Tailwind v4, shadcn/ui (New York), lucide-react, framer-motion, sonner toasts, zustand.
- Single user-facing route: `/` (src/app/page.tsx) — it's an SPA that switches views via `useApp().view`.
- All components MUST be `'use client'` where they use hooks.
- Backend: Prisma (`import { db } from '@/lib/db'`). SQLite (no JSON fields — stored as String, parsed with JSON.parse).
- API routes under `src/app/api/*` (auth, users, friends, messages, files, groups, calls, notifications, setup).
- Realtime: socket.io mini-service at `mini-services/realtime/index.ts` (port 3003). Frontend connects via `useSocket()` hook with `io('/?XTransformPort=3003', { withCredentials: true })`.
- File uploads: `POST /api/files/upload` (FormData) → returns `{ file: { id, url, name, mimeType, size } }`. Files served at `/api/files/:id`.
- Password hashing: scrypt (no bcrypt). Sessions in httpOnly cookie `fc_session`.
- Theme: emerald/teal brand (NOT indigo/blue). next-themes `attribute="class"`.

## Key Files & Contracts (READ THESE)
- `src/lib/store.ts` — zustand `useApp()`: `{ view, setView, activeChatUserId, activeChatGroupId, activeProfileId, openChat(userId), openGroupChat(groupId), openProfile(userId), theme, setTheme }`. `View` type union includes: splash, welcome, login, register, forgot, home, friends, chat, groups, calls, profile, settings, notifications.
- `src/lib/api.ts` — `api<T>(path, opts)`, `uploadFile(file)`, `initials`, `timeAgo`, `clockTime`, `lastSeenText`, `ApiError`.
- `src/lib/constants.ts` — `RT` object of socket event names; `iceServers()` returns RTCIceServer[] (STUN + optional TURN from env).
- `src/hooks/use-auth.tsx` — `useAuth()`: `{ user, loading, refresh, setUser, login, register, logout }`. `user.profile` has photoUrl, bio, phone, location, birthday, education, work, profileVisibility, messagePermission, callPermission, lastSeen.
- `src/hooks/use-socket.tsx` — `useSocket()`: `{ socket, connected, online: Set<string>, isOnline(userId) }`.
- `src/hooks/use-notifications.tsx` — `useNotifications()`: `{ unread, notifications, refresh, markAllRead }`.
- `src/components/fc/ui.tsx` — `UserAvatar({name, src, size, online})`, `FCLogo({size})`, `EmptyState({icon,title,description,action})`, `SectionTitle`.
- `src/components/fc/shell/nav.tsx` — `TopBar`, `BottomNav` (already wired; tabs: home, friends, chat, calls, profile).

## Socket.io Events (server <-> client)
Client → server:
- `RT.MESSAGE_SEND` `{ tempId?, receiverId, content, type?, fileUrl?, fileName?, fileSize?, mimeType? }` → ack `{ ok, message, tempId }`. Server persists + emits `message:new` to both rooms. Auto-marks DELIVERED if recipient online.
- `RT.MESSAGE_SEEN` `{ messageId }` → server marks SEEN, emits `message:status` `{ id, status:'SEEN' }` to sender.
- `RT.TYPING` `{ receiverId, isTyping }` → server emits `typing:indicator` `{ userId, isTyping }` to receiver.
- `RT.GROUP_MESSAGE_SEND` `{ tempId?, groupId, content, type?, fileUrl?, fileName?, fileSize?, mimeType? }` → ack `{ ok, message, tempId }`. Server persists + emits `group:message:new` to all members (message includes `sender` with profile).
- Call signaling: `RT.CALL_OFFER` `{ targetUserId, type, sdp }`, `RT.CALL_ANSWER` `{ targetUserId, sdp }`, `RT.CALL_ICE` `{ targetUserId, candidate }`, `RT.CALL_RINGING` `{ targetUserId }`, `RT.CALL_REJECT` `{ targetUserId }`, `RT.CALL_END` `{ targetUserId }`.
Server → client:
- `message:new` (full message object: id, senderId, receiverId, groupId, content, type, fileUrl, fileName, fileSize, mimeType, status, createdAt)
- `message:status` `{ id, status }`
- `typing:indicator` `{ userId, isTyping }`
- `group:message:new` (message object + `sender: { id, name, profile: { photoUrl } }`)
- `presence` `{ userId, online }`
- `call:incoming` `{ callerId, type?, sdp?, ringing? }` (from incoming offer or ringing ping)
- `call:sdp` `{ kind: 'answer', sdp, from }`
- `call:ice-candidate` `{ candidate, from }`
- `call:ended` `{ reason, by, from }`

## REST API endpoints (all require auth except auth/*)
- Auth: `POST /api/auth/register|login|logout|forgot|verify-otp|reset-password`, `GET /api/auth/me`, `GET /api/auth/token`.
- Users: `GET /api/users/search?q=`, `GET /api/users/:id`, `PUT /api/users/me` (body fields: name, username, photoUrl, bio, phone, location, birthday, education, work, profileVisibility, messagePermission, callPermission).
- Friends: `GET /api/friends` (list), `POST /api/friends` `{ action: 'request'|'accept'|'reject'|'remove'|'block'|'unblock', targetId }`, `GET /api/friends/requests` `{ incoming[], outgoing[] }`, `GET /api/friends/blocked`.
- Messages: `GET /api/messages/conversations` → `{ conversations: [{ id, username, name, photoUrl, lastMessage, unread }] }`, `GET /api/messages?userId=ID` or `?groupId=ID` → `{ messages: [...] }` (also marks incoming 1:1 as SEEN).
- Groups: `GET /api/groups`, `POST /api/groups` `{ name, description?, memberIds?, photoUrl? }`, `GET /api/groups/:id`, `GET /api/groups/:id/messages`, `POST/DELETE /api/groups/:id/members`.
- Calls: `GET /api/calls` (history), `POST /api/calls` `{ action:'start', receiverId, type:'audio'|'video' }` → `{ call: { id } }`, `POST /api/calls` `{ action:'end', callId, status?, duration? }`.
- Notifications: `GET /api/notifications` `{ unread, notifications[] }`, `POST /api/notifications` `{ all?: true } | { id }`.
- Setup: `POST /api/setup` seeds demo accounts (aria/bilal/carla @friendconnect.app, password password123).

## Message object shape (from REST /api/messages and socket message:new)
```
{ id, senderId, receiverId?, groupId?, content, type: 'text'|'image'|'video'|'audio'|'document',
  fileUrl?, fileName?, fileSize?, mimeType?, status: 'SENDING'|'SENT'|'DELIVERED'|'SEEN', createdAt }
```
Group message (REST /api/groups/:id/messages and socket group:message:new) additionally has `senderName`, `senderPhoto`.

## Styling rules (MANDATORY)
- Use shadcn/ui components from `@/components/ui/*`. Do NOT rebuild primitives.
- Mobile-first, max-width-2xl content (the shell already constrains `<main>` to `max-w-2xl`).
- Use `fc-scroll` class for custom-styled scrollable areas; `fc-bubble-me` / `fc-bubble-them` for chat bubbles; `fc-online-dot` for online dot; `fc-pulse`, `fc-rise`, `fc-ring-anim`, `fc-ping-ring` animations exist in globals.css.
- Use `text-primary`, `bg-primary`, `bg-card`, `border-border`, `text-muted-foreground` etc. (CSS vars). NEVER hardcode indigo/blue.
- Toasts: `import { toast } from 'sonner'`.
- Sticky footer is handled by the shell (`BottomNav` is `sticky bottom-0`). Views render inside `<main>` which is `flex-1`. Make views fill height with `h-full` and use internal `fc-scroll` for scrollable content.

## Dev environment notes
- Dev server: `bun run dev` (already running on :3000). Realtime: `bun run dev` in `mini-services/realtime` (running on :3003).
- Logs: `/home/z/my-project/dev.log` (Next), `/home/z/my-project/realtime.log` (socket.io).
- After editing, run `bun run lint` to verify. Read recent dev.log for runtime errors.
- The realtime service uses `bun --hot` so it auto-restarts on changes to `mini-services/realtime/index.ts`.

---
Task ID: 0
Agent: orchestrator (Z.ai Code)
Task: Built FriendConnect foundation: Prisma schema, all API routes, realtime socket.io service, frontend shell (auth/home/friends/profile/notifications/settings), theme, nav.

Work Log:
- Authored prisma/schema.prisma with User, Profile, Session, Friendship, Message, Group, GroupMember, Call, Notification, File.
- Created src/lib/auth.ts (scrypt hashing, tokens, OTP), session.ts (cookie session), constants.ts (RT events + iceServers), serialize.ts (json helpers + ensureProfile), api.ts (client), store.ts (zustand).
- Built all API routes under src/app/api/* (auth, users, friends, messages, files, groups, calls, notifications, setup).
- Built realtime mini-service mini-services/realtime/index.ts (cookie-based auth, presence, message send/persist/delivery/seen, typing, group messages, call signaling). Port 3003.
- Built hooks: use-auth, use-socket, use-notifications.
- Built UI primitives: UserAvatar, FCLogo, EmptyState, SectionTitle.
- Built views: AuthFlow (splash/welcome/login/register/forgot), HomeView, FriendsView, ProfileView (view+edit), NotificationsView, SettingsView.
- Built shell: TopBar, BottomNav, page.tsx SPA router with providers.
- Set emerald/teal theme in globals.css + custom scrollbar/bubble/animation classes.

Stage Summary:
- App compiles, lint clean, dev server returns 200 on `/`. Demo accounts seedable via POST /api/setup.
- Remaining: ChatView, CallsView+CallOverlay, GroupsView are STUBS and must be replaced with full implementations by subagents (Tasks 7, 8, 8b).

---
Task ID: 8b
Agent: full-stack-developer (GroupsView)
Task: Replaced the stub `/src/components/fc/groups/GroupsView.tsx` with a complete production-quality Groups management screen (list + create dialog + details dialog with add-members/leave flows).

Work Log:
- Read worklog.md, api.ts, store.ts, ui.tsx, use-auth.tsx, FriendsView/HomeView for conventions; inspected /api/groups, /api/groups/[id], /api/groups/[id]/members REST routes and shadcn primitives (Dialog, Checkbox, Avatar, Badge, Card, Button).
- Implemented two modes: groups list (default) and a Create dialog. List fetches GET /api/groups, renders premium cards via shadcn `Card` (rounded-2xl, hover:border-primary/40). Each card shows an inline `GroupAvatar` (rounded square using shadcn Avatar — shows photo, group initial, or Users icon fallback), name, description (line-clamp-2), member-count + role badge + timeAgo(createdAt).
- Role badges: OWNER → `bg-primary text-primary-foreground` with Crown, ADMIN → `bg-secondary text-secondary-foreground` with Shield, MEMBER → `bg-muted text-muted-foreground` with Users.
- Card tap → `useApp().openGroupChat(id)`. Long-press (500ms) OR a Settings2 button (top-right) opens the group details dialog. Implemented a `useLongPress` hook with timer ref + `wasLongPress()` flag to suppress the click handler after a long-press fires.
- Details dialog: GET /api/groups/:id → renders member list with RoleBadge per member, "(you)" marker for current user, group description, member count + created-ago. Owner sees "Add members" button (ADMIN/MEMBER don't, per task spec). Add-members sub-flow fetches GET /api/friends, filters out existing members, shows Checkboxes, posts each selected userId to POST /api/groups/:id/members in parallel. "Leave group" button → DELETE /api/groups/:id/members?userId=me for everyone. "Open chat" shortcut button also in footer.
- Create dialog: shadcn Dialog with sticky header (title + description), scrollable body, sticky footer. Body has photo upload (uploadFile from @/lib/api sets photoUrl, with loading spinner overlay), name input (required, maxLength 60, autoFocus), description textarea (maxLength 240, char counter), and a friend multi-select list using Checkbox + UserAvatar with Select all / Clear all toggle. Create button calls POST /api/groups { name, description, photoUrl, memberIds } → toast.success('Group created'), resets form, closes dialog, calls loadGroups() + optionally openGroupChat(newGroupId).
- Loading states: skeleton cards for list, spinner in dialogs. Empty states with CTAs (EmptyState component) for no groups, no friends available to add, error retry button on failed list/detail loads.
- Styling: `flex h-full flex-col` root, `fc-scroll` scrollable areas, sticky header `border-b border-border bg-background/90 backdrop-blur`, emerald/teal accents only (uses bg-primary/text-primary/15 etc., no indigo/blue). Mobile-first, max-w-md dialogs that flex to max 92vh with internal scroll.
- Removed unused eslint-disable directives (the `react-hooks/set-state-in-effect` and `@next/next/no-img-element` ones were unnecessary because those rules are already off in eslint.config.mjs).
- Verified: `bun run lint` → 0 errors, 0 warnings. Dev server compiles cleanly and `GET /` returns 200.

Stage Summary:
- Single self-contained file delivered: `/home/z/my-project/src/components/fc/groups/GroupsView.tsx` (~660 lines).
- Exports `GroupsView` (default-rendered when `useApp().view === 'groups'`). Internal helpers: `GroupAvatar`, `RoleBadge`, `useLongPress`, `GroupCard`, `GroupCardSkeleton`, `CreateGroupDialog`, `GroupDetailsDialog`.
- All required imports honored: useApp (openGroupChat), useAuth (user.id), api/uploadFile/timeAgo from @/lib/api, UserAvatar/EmptyState from @/components/fc/ui, shadcn primitives (Button, Card, Input, Textarea, Label, Dialog set, Checkbox, Avatar set, Badge, Separator), lucide icons (Plus, Users, UserPlus, LogOut, Crown, Shield, Settings2, ChevronRight-unused-removed, Camera, MessageCircle) plus Loader2 for spinners. ChevronRight was not used in the final design — omitted to keep imports clean.
- Every interactive button wired to a real action (chat open, details open, create, add members, leave, retry, select all/clear). Validation: name required (button disabled + toast error). Toasts via sonner for all success/error outcomes.

---
Task ID: 8
Agent: full-stack-developer (Calls + CallOverlay)
Task: Replaced the stub CallsView and CallOverlay with full, production-quality implementations — a calls-history view with a "Start a call" friend picker dialog, and a complete WebRTC call overlay handling outgoing/incoming/connected/ended flows with full controls (mute, camera toggle, switch camera, speaker, end), connection-state monitoring, ICE restart, call timer, no-answer timeout, and graceful cleanup on unmount/beforeunload/network change.

Work Log:
- Read /home/z/my-project/worklog.md and inspected the existing stubs (CallsView.tsx, CallOverlay.tsx), API contracts (`/api/calls`, `/api/users/:id`, `/api/friends`), socket event constants (`RT`, `iceServers`), `useSocket`, `useApp`, `UserAvatar`, `EmptyState`, `globals.css` (verified `fc-ping-ring`, `fc-ring-anim`, `fc-pulse` exist), and the realtime mini-service to confirm the call signaling flow.
- Wrote `src/components/fc/calls/CallsView.tsx`:
  - Fetches `GET /api/calls` and renders each history row with `UserAvatar`, peer name (red if missed), direction icon (`ArrowDownLeft`/`ArrowUpRight`), type icon (`Phone`/`Video`), and time (`timeAgo(startedAt)` or `mm:ss` duration when present). Tapping a row opens the peer's chat via `openChat(peerId)`.
  - "Start a call" button in the header opens a shadcn `Dialog` that loads `GET /api/friends`, lists each friend with online indicator, and exposes audio + video call buttons per friend.
  - Starting a call dispatches `window.dispatchEvent(new CustomEvent('fc:start-call', { detail: { targetUserId, type } }))` which the CallOverlay listens for.
  - Premium mobile-first styling with skeletons while loading, `EmptyState` when no history, dark-mode friendly via CSS vars.
- Wrote `src/components/fc/calls/CallOverlay.tsx` (always mounted in the authed shell, returns `null` when idle):
  - Outgoing: on `fc:start-call` → `POST /api/calls {action:'start'}` (record callId) → `getUserMedia` (with permission-denied toast + abort) → `new RTCPeerConnection({iceServers})` + add local tracks → `createOffer`/`setLocalDescription` → `socket.emit(RT.CALL_OFFER, {targetUserId, type, sdp})`. On `icecandidate` → `socket.emit(RT.CALL_ICE, {targetUserId, candidate})`. 30s no-answer timeout auto-ends with status `'missed'` and emits `CALL_END`.
  - Incoming: on `socket.on('call:incoming', {callerId, type, sdp, ringing})` with `sdp` → fetch peer info via `GET /api/users/:id` → show incoming UI with animated `fc-ping-ring` rings, Accept (green) + Decline (red). On Accept: `getUserMedia` → PC + add tracks → `setRemoteDescription(offer)` → `createAnswer`/`setLocalDescription` → `socket.emit(RT.CALL_ANSWER, {targetUserId: callerId, sdp})`. On Decline: `socket.emit(RT.CALL_REJECT)` + cleanup.
  - Answer handling: `socket.on('call:sdp', {kind:'answer', sdp, from})` → `setRemoteDescription(answer)`, flush buffered ICE candidates, clear no-answer timeout, transition to `connecting`.
  - ICE candidates: `socket.on('call:ice-candidate', {candidate, from})` → buffer if remoteDescription not yet set, else `addIceCandidate`. Guard against wrong peer via `from !== targetUserId` check.
  - Connected UI: video calls render remote video full-screen (`<video autoPlay playsInline>`) with local PiP (`<video autoPlay playsInline muted>`) in top-right corner; audio-only shows large avatar + animated audio waves (`fc-pulse`).
  - Controls bar (round `h-14 w-14` buttons): mute mic toggle (`Mic`/`MicOff`), camera on/off (`Video`/`VideoOff`, video-only), switch camera front/back via `applyConstraints({facingMode})` with fallback to `getUserMedia` + `sender.replaceTrack`, speaker toggle (`Volume2`/`VolumeX` mutes remote `<video>`), red end-call button (`PhoneOff`).
  - Connection state monitoring: `pc.onconnectionstatechange` updates a status pill; on `'failed'` attempt ICE restart once (renegotiation via `createOffer({iceRestart:true})` for caller); on `'disconnected'` show "Reconnecting…"; second failure ends the call.
  - Call timer: starts when `pc.connectionState === 'connected'`, displays `mm:ss`, stops on end.
  - End call (user): stop local tracks, close PC, `socket.emit(RT.CALL_END, {targetUserId})`, `POST /api/calls {action:'end', callId, status:'ended', duration}` (only if we own the callId), full cleanup.
  - Remote end: `socket.on('call:ended', {reason, by, from})` → if we initiated and have callId, record end with status `'declined'` or `'ended'`; show toast "Call declined" / "Call ended"; cleanup.
  - Cleanup: tracks stopped + PC closed on unmount, `beforeunload` (with `navigator.sendBeacon` for the `/api/calls` end POST for reliability), `navigator.connection` change toast, and socket-disconnect mid-call.
- All WebRTC objects (PC, streams, callId, peer info, ICE queue, timeouts, restart flag) held in refs to avoid stale closures; UI state mirrored to React state for rendering. Socket listeners registered once per socket instance and torn down properly. Used `'use client'` directive.
- Styling: `fixed inset-0 z-[100] bg-black text-white flex flex-col` overlay with `from-primary/30 via-black to-black` gradient, emerald/teal accents (NEVER indigo/blue), animated rings for ringing, audio waves for connected audio calls, status pill with color-coded dot. Mobile-first, safe-area aware (`fc-safe-top`/`fc-safe-bottom`).
- Ran `bun run lint` — clean (0 errors, 0 warnings). Verified dev server returns 200 on `/`.

Stage Summary:
- Files produced:
  - `src/components/fc/calls/CallsView.tsx` — full calls history view + start-call dialog (overwrote stub).
  - `src/components/fc/calls/CallOverlay.tsx` — full WebRTC overlay (overwrote stub).
- Decisions:
  - For incoming calls, do NOT create a new `/api/calls` record (the caller already created it); only POST `end` on the caller side when we own the callId.
  - ICE candidate buffering: queue candidates that arrive before `setRemoteDescription` completes; flush after remote description is set (handles the race where answer-side ICE arrives before offer-side finishes `setRemoteDescription`).
  - Switch camera: try `track.applyConstraints({advanced:[{facingMode}]})` first, fall back to `getUserMedia` + `RTCRTPSender.replaceTrack` for browsers that don't support in-place facingMode switching.
  - ICE restart: on `connectionState === 'failed'`, attempt one restart via `pc.restartIce()` plus a renegotiation offer (`iceRestart:true`) when we're the caller; second failure ends the call.
  - No-answer timeout: 30 seconds for outgoing calls — auto-end as `'missed'` and emit `CALL_END`.
  - Speaker toggle implemented as mute/unmute of the remote `<video>` element's audio (closest web equivalent of speakerphone toggle).
- Lint clean (`bun run lint` returns 0 errors / 0 warnings), dev server returns 200, ready for end-to-end testing with two browser sessions.

---
Task ID: 7
Agent: full-stack-developer (ChatView)
Task: Replaced the stub `src/components/fc/chat/ChatView.tsx` with a complete WhatsApp-style chat experience (conversation list + 1:1 chat + group chat) in a single self-contained `'use client'` file.

Work Log:
- Read worklog.md + existing stub + FriendsView/HomeView to match conventions; verified API/realtime contract shapes against `src/app/api/messages/*`, `src/app/api/groups/route.ts`, `src/app/api/friends/route.ts`, and `mini-services/realtime/index.ts`.
- Built `ConversationList` with Tabs (Chats/Groups), search filter, online presence dots via `useSocket().isOnline`, unread badges, last-message preview, member counts, skeleton loaders, empty states. Live updates last message + unread via `message:new`.
- Built a unified `ChatRoom` (mode: 'direct' | 'group') with: back button (uses `useApp.setState({ activeChatUserId: null, activeChatGroupId: null })`), header avatar/name/online-or-typing status, audio+video call buttons that dispatch `window CustomEvent('fc:start-call', { detail: { targetUserId, type } })`.
- Messages area: `fc-scroll flex-1 overflow-y-auto`, infinite scroll up via `?before=` param (preserves scroll position with `requestAnimationFrame` + `skipAutoScrollRef`), auto-scroll-to-bottom when at bottom.
- Bubbles: `fc-bubble-me`/`fc-bubble-them` + `fc-rise` animation. Renders text (linkified + emoji), image (thumbnail → Dialog full view), video (`<video controls>`), audio (`<audio controls>`), document (download card with FileText icon + fileName + formatBytes + Download). Group sender avatar + name shown for messages from others.
- Status ticks via lucide `Clock`/`Check`/`CheckCheck`: SENDING→Clock, SENT→Check, DELIVERED→CheckCheck (opacity-60), SEEN→CheckCheck (opacity-100).
- Realtime: subscribes to `message:new`, `group:message:new` (dedupes by id, filters by peerId/groupId), `message:status` (updates tick), `typing:indicator` (filtered by peerId). Emits `RT.MESSAGE_SEEN` for realtime incoming 1:1 messages.
- Typing: emits `RT.TYPING` isTyping:true on input, false after 1.5s idle / on send / on unmount. Animated `.fc-typing-dot` bubble (delays 0/150/300ms).
- Input bar: emoji `Popover` with 72 hardcoded emojis, attach button (hidden file input accepting image/video/audio/.pdf/.zip/.doc/.docx/.txt with `Loader2` spinner during upload), auto-growing `Textarea` (Enter sends, Shift+Enter newline), primary send button.
- Send flow: optimistic insert with `tempId` + SENDING, `socket.emit(RT.MESSAGE_SEND | RT.GROUP_MESSAGE_SEND, payload, ack)` → replace by `tempId` on success. Files: `uploadFile(file)` → message with `type` from mimeType (image/video/audio/document).
- Ran `bun run lint` (0 errors, 0 warnings — the unused `react-hooks/set-state-in-effect` disable directive was removed since the rule isn't enabled in this project). Verified `GET /` returns HTTP 200 in dev.log.

Stage Summary:
- Files produced: `/home/z/my-project/src/components/fc/chat/ChatView.tsx` (~880 lines, single self-contained file). Work notes: `/home/z/my-project/agent-ctx/7-full-stack-developer.md`.
- Lint clean (0 errors, 0 warnings). Dev server returns 200 on `/`.
- No backend changes needed — all contracts in the worklog matched the actual implementations.
- Remaining stubs for other agents: CallsView + CallOverlay (Task 8) and GroupsView (Task 8b).
