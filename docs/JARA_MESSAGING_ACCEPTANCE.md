# Jara Messaging & Governance — Acceptance Report (2026-11-25)

**Repository:** `engralaminn-collab/friendconnect_alo`
**Branch:** `arena/d33d7903-friendconnect-alo` (base `dc1e3f0`, PR #20)
**Scope of this report:** Jara as a permanent AI *user* inside the real FriendConnect
message pipeline, plus the governance checks that bound it. Anything not measured
here is marked `BLOCKED` or `PARTIAL` rather than claimed.

Run environment: Linux sandbox, Node 22.22, no outbound access to
`nodejs.org` / `binaries.prisma.sh` / the public internet, no live AI provider, no
SSH to the production host. Every test below therefore uses a local
Ollama-compatible HTTP server for inference — the same code path a configured
deployment uses (`OLLAMA_URL` → `aiChat`), not a mock of the gateway.

---

## 1. What changed

| File | Change |
|---|---|
| `src/lib/jara-responder.ts` | New. Turns a stored message into Jara's answer: participation check, idempotency, rate limit, live config → system prompt → provider, persistence, realtime fanout, notification, audit. |
| `src/app/api/conversations/[id]/messages/route.ts` | Triggers the reply (the path the chat UI sends on). |
| `src/app/api/messages/route.ts` | Same trigger for the DM/API path. |
| `src/app/api/jara/respond/route.ts` | New internal endpoint for the realtime server (`x-internal-secret`, constant-time compare). |
| `socket-server.js` | `message:send` (conversation and DM shapes) triggers `POST /api/jara/respond`. |
| `.env.example` | Documents `APP_INTERNAL_URL` (realtime → app). |
| `tests/integration/jara-user.test.cjs` | New: 5 tests, 26 s. |

Before this change the messaging routes only *exempted* Jara from permission
checks (`isJaraId`). A human could open a DM with Jara, send a message, see it
stored — and never receive an answer. Jara's only replies came from the separate
`/api/jara/chat` screen, which wrote rows without a `conversationId`, so they never
appeared in the conversation the user had open.

---

## 2. Test evidence

`npm run test:integration` → **26/26 pass** (21 pre-existing + 5 new), 45 s.
The five new tests boot the real production build (`.next/standalone/server.js`),
a real `socket-server.js`, a throwaway SQLite database per test and a real HTTP
provider.

| # | Requirement | Test | Result |
|---|---|---|---|
| 1 | Jara permanent account exists exactly once, `id=jara-ai-system-001`, `email=jara@friendconnect.local`, `role=jara` | `Jara keeps one permanent identity…` | **PASS** |
| 2 | Repeated setup/restart does not duplicate Jara | same test, second boot against the same DB | **PASS** |
| 3 | Human can find Jara (search + profile) and it is labelled AI | `Jara answers a normal direct message…` | **PASS** |
| 4 | Human can open a private conversation with Jara (and it is reused, not duplicated) | same | **PASS** |
| 5 | Jara receives the message through the authorized message system | same | **PASS** |
| 6 | A real provider generates the answer | same (local Ollama HTTP provider receives the request; response stored verbatim) | **PASS** |
| 7 | Reply is persisted and delivered | same (conversation fetch + `message:new` over Socket.IO) | **PASS** |
| 8 | Bangla messages are processed and answered as UTF-8 | same (`আসসালামু আলাইকুম…` round-trips through store, JSON and provider) | **PASS** |
| 9 | Socket.IO path: authenticated send → realtime answer on `message:new` | `Jara answers over Socket.IO…` | **PASS** |
| 10 | Duplicate-message protection (REST + socket triggers) | `…real message pipeline` replay assertion | **PASS** — `reason: duplicate`, provider called once |
| 11 | Read status | same (`status: SEEN` on the answered message) | **PASS** |
| 12 | Notification for the human | same (`Jara replied`) | **PASS** |
| 13 | No provider → honest unavailability, no fabricated answer | `Jara does not answer where it is not a participant…` | **PASS** — `type: system`, `inference: unavailable` |
| 14 | Jara cannot read/answer another pair's conversation | same (`not_participant`, incl. via the internal endpoint) | **PASS** |
| 15 | Internal trigger requires the shared secret | same (401 without `x-internal-secret`) | **PASS** |
| 16 | Ordinary user cannot change Jara's protected config | `…permanent identity…` (PUT `/api/jara/config`, POST `/api/jara/proposals`) | **PASS** — 403 |
| 17 | Jara account cannot be logged into (no usable password) | same (`/api/auth/me` → `user: null`) | **PASS** |
| 18 | Super Admin approval workflow applies a reviewed change | `Super Admin governs Jara…` | **PASS** — live config `qwen2.5`, version incremented |
| 19 | Pending proposal does not change the live config | same | **PASS** |
| 20 | Tampered hash and replay are refused | same (409 / 409) | **PASS** |
| 21 | Every privileged attempt is audited | same (`/api/jara/history`: `propose`, `apply`, `attempt_blocked`) | **PASS** |
| 22 | Governance never rewrites Jara's identity; disabling keeps it | same | **PASS** |

Other suites in the same run: `npm run test:unit` **PASS**, `npm run test:security`
**PASS** (42 tests incl. the new CI-annotation suite), `npm run schema:check`
**PASS** (52 models / 52 delegates / 52 tables, no drift), `node --check
socket-server.js` **PASS**, `npx tsc --noEmit` **0 errors**, `npm run lint`
**PASS**, `npm run build` **PASS** (standalone output present).

---

## 3. Capability matrix (honest)

| Capability | Status | Evidence / limitation |
|---|---|---|
| Jara permanent account + idempotent seed | **PASS** | Test 1–2 |
| Jara DM text chat through the normal message store | **PASS** | Tests 3–12 |
| Bangla text (UTF-8) end to end | **PASS** | Test 8 |
| Realtime delivery (Socket.IO) | **PASS** | Test 9 |
| Notifications / read receipts | **PASS** | Tests 11–12 |
| Provider-backed inference | **PASS (plumbing)** / **BLOCKED (live provider)** | The gateway path is exercised over HTTP against an Ollama-compatible provider. No external model is reachable from this sandbox, so answer *quality* is unverified here. Set `OLLAMA_URL` (or another provider) in production. |
| Honest degradation without a provider | **PASS** | Test 13 |
| Group messaging with consent + mention | **PARTIAL** | Responder enforces consent + mention and group context; the dedicated `/api/jara/group` route already existed. Group reply path is not covered by a new end-to-end test in this change. |
| Audio messages to Jara | **PARTIAL** | Media upload/ACL and `JaraVoiceCall` (browser STT/TTS) exist; transcription of an uploaded audio message into the responder is not implemented. |
| Jara audio call | **PARTIAL** | Browser Web Speech STT + SpeechSynthesis TTS via `/api/jara/voice` (unchanged, not re-verified here — requires a browser). |
| Jara video call | **PARTIAL** | Avatar-based call UI (`CallView` recognises the Jara peer); no live video avatar is claimed. |
| LiveKit group calls with Jara | **NOT IMPLEMENTED** | Jara is not a LiveKit participant. |
| Super Admin governance (propose → approve → audit → replay/tamper refusal) | **PASS** | Tests 16–22 |
| Owner-supplied reference photo as Jara's avatar | **BLOCKED** | No image was supplied; the approved-asset pipeline (`JaraAsset`, appearance profiles) is unchanged. |
| Production deployment to `panel.alolabs.net` | **BLOCKED** | No SSH/CI credentials or DNS access from this environment; nothing was deployed and no live claim is made. |
| MySQL acceptance | **BLOCKED** | No MySQL server/docker and the Prisma engine download is unreachable. |

---

## 4. Operational notes

- `APP_INTERNAL_URL` must point at the Next app from the realtime process. It
  defaults to `http://127.0.0.1:$PORT`, which is correct for the PM2/systemd
  layout in `ecosystem.config.cjs`. Behind a proxy, set it explicitly.
- The internal trigger shares `SOCKET_INTERNAL_SECRET` (falling back to
  `NEXTAUTH_SECRET`) with the existing `/internal/emit` path. If that secret is
  unset in production, the realtime server cannot trigger a reply — REST sends
  still work.
- Provider latency never blocks a send: the reply is generated after the 201
  response and delivered over `message:new`.
- Rate limit: 30 replies per human per minute (in-process/Redis cache),
  audited as `attempt_blocked` when exceeded.

## 5. Reproduce

```bash
npm ci
npm run build
node --test tests/integration/jara-user.test.cjs   # 5/5, ~26 s
npm run test:integration                           # 26/26
```
