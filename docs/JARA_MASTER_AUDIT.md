# Jara AI Master Audit — FriendConnect ALO

**Date:** 2026-11-23  
**Branch:** `arena/7ec91873-friendconnect-alo`  
**Base commit:** `4acaafd` (`4acaafdc3c735a30e5a18a90e2a15536eb78a4ed`)  
**Scope:** Phase 1 repository audit for the Jara AI master development prompt. No destructive changes were made during audit.

## 1. Current Stack & Architecture

| Area | Current state |
|---|---|
| Framework | Next.js 16.3.x (App Router), React 19, TypeScript, Tailwind CSS 4, shadcn/ui |
| Auth | NextAuth credentials + custom DB session rows (`Session.token`) for realtime; bcryptjs passwords; optional 2FA/TOTP |
| Database | Prisma 6.11.1. Schema datasource is SQLite in `prisma/schema.prisma`; runtime supports SQLite and MySQL through adapters (`@prisma/adapter-better-sqlite3`, `@prisma/adapter-mariadb`), selected by `DATABASE_URL` |
| Realtime | Socket.IO server in `socket-server.js` (port 3003), client via `socket.io-client` |
| Calls | WebRTC signaling over Socket.IO; STUN/TURN config via env; LiveKit client/server SDKs are installed but not wired into Jara call flow |
| AI gateway | `src/lib/ai.ts` multi-provider: Ollama, Z.ai, OpenRouter, HuggingFace, OpenAI-compatible |
| Deployment | PM2 (`ecosystem.config.cjs`), Caddy, Docker Compose, Coturn scripts |
| Testing | Playwright present; lint/typecheck scripts exist; no comprehensive Jara RBAC/prompt-injection/bilingual/call isolation suite observed |

## 2. Existing Jara Implementation (Reviewed)

### Docs
- `docs/JARA_ARCHITECTURE.md` — governance/avatar/voice/group design.
- `docs/JARA_BANGLA_VOICE_REPORT.md` — Bangla voice findings.
- `docs/JARA_DEPENDENCY_INVENTORY.md` — dependency/license inventory.
- `docs/JARA_TEST_EVIDENCE.md` — existing test evidence.
- `docs/JARA_AI_MODELS.md` — model catalog added in this branch (35 repos, P0-P2 priorities).
- `docs/open-source-ai-models.md` — AI provider config.

### Data model (Prisma)
- `JaraConfig` — single live config: face/avatar/background/theme/colors/animation/clothing, voice, personality, LLM/STT/TTS, memory, `isLive`, version.
- `JaraProposal` — proposal hash/version/status/expiry/approval metadata.
- `JaraAuditLog` — action/actor/role/detail/ip/ua/timestamp; no structured previous/new values or authorization result field.
- `JaraMemory` — per-user key/value memory.
- `JaraGroupConsent` — group enabled/listen consent.

### Server/lib
- `src/lib/jara.ts` — Jara identity constants, default config, SHA-256 config hash, allowed values, natural-language instruction parser, proposal expiry helper.
- `src/lib/ai.ts` — provider detection and chat/summarize/translate/moderate helpers.
- `src/lib/session.ts` — `getSessionUser`/`requireUser`; role returned from DB.

### API routes
- `GET/PUT /api/jara/config` — live config; emergency rollback behind `_emergencyRollback`.
- `GET/POST /api/jara/proposals` — list/create proposals.
- `POST /api/jara/proposals/[id]/approve` — server-side admin check, hash/version/expiry/replay/concurrency/integrity checks, audit.
- `POST /api/jara/proposals/[id]/reject` — reject proposal.
- `POST /api/jara/chat` — chat + Super Admin instruction -> proposal (no live apply on chat text).
- `POST /api/jara/voice` — voice transcript -> LLM reply.
- `GET/POST /api/jara/group` and `GET/POST /api/jara/group/consent`.
- `GET /api/jara/profile`, `GET /api/jara/history`, `POST /api/jara/rollback`, `GET /api/jara/health`.

### UI
- `src/components/jara/JaraChat.tsx` — chat UI.
- `src/components/jara/JaraVoiceCall.tsx` — browser SpeechRecognition + SpeechSynthesis MVP.
- `src/components/jara/JaraAvatar.tsx` — canvas 2D avatar.
- `src/components/jara/JaraConfigCenter.tsx` — proposal/config center dialog.
- `src/app/page.tsx` — integrates Jara chat/config into main app.

## 3. Gaps Against Master Prompt

### Critical / P0
- **No explicit Super Admin role model**: schema comment says `role user|admin`; code accepts `admin|superadmin` in places, but no dedicated superadmin bootstrap/policy layer and no granular permission matrix.
- **Audit log not fully compliant**: missing structured previous value, new value, authorization result, change reason, request/session correlation fields.
- **No emergency disable/kill switch**: no global Jara disable flag with server-side enforcement across chat/voice/group/calls/SMS.
- **No per-call appearance isolation**: JaraConfig is global/live; spec requires per-call visual profiles and temporary changes that auto-expire without overwriting other meetings.
- **No SMS subsystem**: no SMS config, inbox/outbox, consent, opt-out, delivery status, rate limits, or human approval flow.
- **No donor/contributor portal**: no contribution records, consent, admin review, or secure non-public storage.
- **No meeting integration records**: no Zoom/Google Meet/Microsoft Teams authorized integration config/audit model.
- **No approved knowledge/instructions store**: Jara answers from LLM context; no curated approved knowledge source model.
- **No consent/recording policy records**: no call recording consent, retention/deletion policy objects, or human takeover records.

### High / P1
- **Bilingual engine incomplete**: browser STT/TTS MVP exists; no server-side Bangla ASR/TTS pipeline, no language detection confidence, no Bengali-English mixed-sentence evaluation harness.
- **Digital human realism incomplete**: canvas avatar only; no real-time audio-to-avatar/video pipeline (MuseTalk/LivePortrait/LiveKit Agents) integration.
- **LiveKit installed but not used for Jara**: `livekit-client`, `livekit-server-sdk`, `@livekit/components-react` are dependencies; no Jara LiveKit room/token pipeline.
- **Command Center incomplete**: missing SMS, call, meeting, knowledge, model selection, activity monitoring, emergency disable/recovery, donor review, per-call profiles.
- **No prompt-injection defenses beyond prompt text**: needs server-side policy checks, tool/action allowlists, and "Jara cannot change own authority" enforcement on every sensitive endpoint.
- **No human approval workflow for sensitive outbound actions**: SMS/call/message sending lacks approval queue.

### Medium / P2
- **Model catalog not operationalized**: `docs/JARA_AI_MODELS.md` exists; no admin UI/service for evaluating/selecting models against license/latency/Bangla criteria.
- **No comprehensive test suite** for RBAC, prompt injection, Bangla/English speech, SMS, per-call background isolation, Super Admin authorization.
- **No explicit AI disclosure banners in all communication surfaces**.
- **No retention/deletion/consent management UI**.

## 4. Security & Compliance Findings

- **Good baseline:** proposal approval verifies server-side role, hash/version, expiry, replay, concurrent live-version conflict, and logs attempts. Jara ID is reserved.
- **Risk:** role naming inconsistency (`admin` vs `superadmin`) can cause authorization drift. Needs a single server-side policy helper.
- **Risk:** direct emergency rollback path exists but should be constrained to Super Admin and emit structured audit with previous/new config.
- **Risk:** no immutable append-only guarantee beyond normal DB table; audit logs can be deleted by DB admins at infrastructure level. Application must prevent delete/update via API.
- **Risk:** browser STT/TTS and LLM responses can be prompt-injected; all tool/actions must be server-authorized and allowlisted.
- **Risk:** no SMS/call consent/opt-out enforcement because those systems are not implemented yet.
- **Rule:** no real person likeness, no fake donors/activity, no secret camera replacement, no unauthorized meeting automation.

## 5. Backward-Compatible Implementation Plan (This Branch)

### Phase A — Foundations (implement now)
1. Add Prisma models/enums-as-strings for: Jara appearance profiles, per-call presentation assignments, SMS contacts/messages/config, donor contributions, consent records, meeting integrations, approved knowledge sources, emergency control/state, and structured Jara config audit fields.
2. Add server-side Jara policy helpers: `isSuperAdmin`, `canManageJara`, `assertSuperAdmin`, emergency-disable guard, and audit writer with previous/new/authorization/requestId.
3. Extend Jara config/API to include AI disclosure, emergency disable, default/persistent appearance profile, and safe configuration metadata.
4. Add APIs for appearance profiles, SMS config/log stubs, donors, consents, meeting integrations, approved knowledge, and command-center summary.
5. Add Command Center UI scaffolding for missing modules; clearly label unconfigured/external integrations as not active.
6. Add tests for RBAC/policy/audit helpers and schema validation where feasible.

### Phase B — Integrations (requires env/credentials/hardware)
- Bengali ASR/TTS: IndicConformer/Faster Whisper + Orpheus/Chatterbox/Piper evaluation and service integration.
- Realistic avatar: MuseTalk/LivePortrait/LiveKit Agents pipeline with WebRTC.
- SMS: Twilio/Vonage/local gateway provider adapter with opt-out, rate limits, delivery webhooks.
- Meetings: authorized Zoom/Google Meet/Teams integrations via official APIs/SDKs.
- Payments/donations: verified provider (Stripe/SSLCommerz/etc.) after compliance review.

## 6. Non-Negotiable Constraints Acknowledged

- No rebuild of FriendConnect ALO.
- No destructive schema/data changes without verified approval.
- No Base44/Supabase replacement.
- No hardcoded secrets.
- No fake data or fake integration claims.
- No feature marked complete without implementation and tests.
- Preserve existing user data/services and existing Jara behavior where possible.

## 7. Audit Command Evidence

Commands run during audit (representative):
- `git rev-parse --short HEAD` → `4acaafd`
- `git branch --show-current` → `arena/7ec91873-friendconnect-alo`
- Inspected: `package.json`, `prisma/schema.prisma`, `.env.example`, `src/lib/auth.ts`, `src/lib/session.ts`, `src/lib/jara.ts`, `src/lib/ai.ts`, `src/app/api/jara/*`, `src/components/jara/*`, `src/app/page.tsx`, `docs/JARA_*`, `docs/open-source-ai-models.md`.

## 8. Next Implementation Step

Proceed with **Phase A foundations**: backward-compatible Prisma schema extensions + Jara policy/audit helpers + Command Center/API scaffolding, then run typecheck/lint/tests for touched areas. Full external integrations (SMS providers, meeting APIs, production avatar/TTS/ASR pipelines) will be implemented as modular adapters behind explicit configuration and flagged as inactive until credentials and verification are present.