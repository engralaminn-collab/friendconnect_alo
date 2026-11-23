# Jara Architecture — FriendConnect + Jara AI

## Overview Diagram

```
Browser
 ├── Sidebar: Jara entry (always visible, AI badge, live version)
 ├── JaraChat: text chat (HTTP → /api/jara/chat → AI gateway → DB Message with JARA_ID)
 ├── JaraVoiceCall: mic → Web Speech API STT → /api/jara/voice → LLM → SpeechSynthesis TTS (barge-in via cancel())
 ├── JaraAvatar: Canvas 2D avatar — face/background/theme from live JaraConfig, moods (idle/listening/speaking/thinking), lip-sync from speakingLevel, blink
 ├── Group Chat: group messages include Jara when group consent enabled (via /api/jara/group)
 └── JaraConfigCenter: Super Admin UI — proposals, preview, approve/reject, versions, audit (Dialog)

Server
 ├── Prisma schema: User (JARA_ID=jara-ai-system-001, role=jara) + JaraConfig + JaraProposal + JaraAuditLog + JaraMemory + JaraGroupConsent
 ├── DB runtime: SQLite (better-sqlite3) + MySQL path via Prisma driver adapters; Jara seeded on first DB access
 ├── AI gateway (src/lib/ai.ts): Ollama → Zai → OpenRouter → HuggingFace → OpenAI (priority order, free first)
 ├── Jara logic (src/lib/jara.ts): JARA_ID, default config, hashConfig (SHA256 canonical JSON), parseInstructionToPatch
 └── API routes:
      GET  /api/jara/config — live config (public)
      PUT  /api/jara/config — emergency rollback (admin, _emergencyRollback flag)
      POST /api/jara/chat — normal chat + Super Admin instruction → proposal (does NOT apply live)
      GET/POST /api/jara/proposals — list/create proposals (admin only for create)
      POST /api/jara/proposals/[id]/approve — approve+apply (admin only, hash/version/expiry/replay checks, audit)
      POST /api/jara/proposals/[id]/reject — reject (admin only)
      POST /api/jara/voice — voice transcript → LLM reply (STT/TTS are browser-side)
      GET/POST /api/jara/group — group Q&A (requires consent + membership + mention)
      GET/POST /api/jara/group/consent — enable/disable Jara in group (group admin only)
      GET  /api/jara/profile — Jara public profile (AI badge)
      GET  /api/jara/history — audit + versions
      POST /api/jara/rollback — create rollback proposal (requires approval)
      GET  /api/jara/health — health + AI provider status

Realtime (existing)
 └── Socket.IO (socket-server.js, port 3003) — auth via session token, chat:message, etc. Jara messages are HTTP-persisted but could be broadcast via socket (future). Jara does NOT need socket to chat; HTTP is reliable.
```

## Governance Flow (Approval Gate)

```
1. Super Admin: "Jara, change your background to blue futuristic" (in JaraChat)
2. Server: parseInstructionToPatch → { background: 'blue-futuristic' } → summary
3. Server: load live config vN, merge patch → proposed vN+1, hashConfig(proposed), create JaraProposal status=pending expiresAt=+24h, audit=propose
4. Server: respond with understanding + proposal ID/hash + "Please approve" — LIVE UNCHANGED
5. UI: proposal appears in JaraChat (preview banner) + JaraConfigCenter (pending list)
6. UI: Preview shows CURRENT (live) vs PROPOSED (not live) — JaraAvatarPreview for both
7. Super Admin: clicks Approve (or says "Approved. Apply this change.") → POST /api/jara/proposals/:id/approve { configHash, version }
8. Server verifies:
   a. caller is admin via getSessionUser().role === 'admin'|'superadmin' (never trust frontend)
   b. proposal is still pending (else 409 replay)
   c. not expired (else 410 + mark expired)
   d. provided hash/version matches stored (else 409 modified)
   e. recomputed hash matches stored (integrity)
   f. live version still == proposal.previousVersion (else 409 concurrent modification)
   g. actor is not Jara (defense in depth)
9. Server: deactivate old live (isLive=false), create new JaraConfig version vN+1 isLive=true, proposal status=applied, audit=apply
10. UI: JaraChat shows confirmation, Config Center moves proposal to history, live badge updates to vN+1
```

## Security Properties

- No frontend role check alone — all approval verifies `getSessionUser().role` server-side.
- Proposals are immutable once created (configHash bound). Modified proposals fail hash check.
- Expired proposals (24h) are rejected with 410 and marked expired.
- Replay rejected: second approve on same ID returns 409 (status != pending).
- All attempts (success + blocked) are audit-logged in JaraAuditLog with actorId, role, IP, UA, timestamp.
- Jara user (id=jara-ai-system-001, role=jara) cannot be impersonated: register blocks username=jara, and session creation requires valid password (Jara has passwordHash='__JARA_SYSTEM__' which never verifies).
- Jara cannot approve own proposal (ID + role check).
- Normal user "Approved" message without being Super Admin is never authorized (auth is on the HTTP approval endpoint, not on chat text).
- Rollback is also a proposal requiring approval — no direct version switch without audit.

## Visual Identity Customization

Config fields: face, avatar, avatarUrl, background, backgroundUrl, theme, colors (JSON), animation, clothing.
All are in JaraConfig and editable via chat proposal or Config Center (propose → preview → approve).
Live avatar uses live config; preview uses proposed config. Replacement preserves Jara ID and conversation history.

## Group Participation

- Group admin enables Jara via POST /api/jara/group/consent { groupId, enabled, listenEnabled } — creates/updates JaraGroupConsent and adds Jara as GroupMember.
- When enabled, POST /api/jara/group { groupId, message } is allowed; Jara only responds when mentioned (@Jara or message contains "jara") — privacy-preserving, no secret listening.
- UI must show "AI participant • Jara is listening" indicator when listenEnabled (to be wired in ChatView header — documented as next iteration; API is ready).
- Jara can be removed by setting enabled=false (admin only) — removes group membership, further group calls with Jara are rejected.

## Voice Conversation Stack

```
Mic (getUserMedia) → MediaStream → Web Audio Analyser (level) + SpeechRecognition (continuous, interimResults, lang=bn-BD)
  → onresult final transcript → barge-in: if speaking, speechSynthesis.cancel()
  → POST /api/jara/voice { transcript, history } → LLM (system prompt: voice mode, Bangla/English detection)
  → reply text → SpeechSynthesisUtterance (voice selection by voiceLanguage, rate/pitch from config)
     → simulated lip-sync via speakingLevel interval → JaraAvatar mood=speaking
     → onend → recognition resumes → loop
```

Echo cancellation: `getUserMedia({ audio: true })` uses browser AEC; TURN not needed for Jara voice (it's local loopback, not P2P).
Reconnection: SpeechRecognition.auto-restart on `onend` unless muted/ended.
Transcripts optional: `onTranscript` callback in JaraVoiceCall logs to chat.

## Deployment Notes

- Build requires `better-sqlite3` + Prisma adapters (installed with --ignore-scripts to avoid native build needing nodejs.org headers offline).
- DB seeding is idempotent — re-running does not duplicate Jara.
- `next build` copies static assets; Jara avatar SVG at /jara-avatar.svg is served.
- Caddy already proxies /api/* and Socket.IO; no new route needed for Jara.
