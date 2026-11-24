# Jara multimodal architecture — implementation status and target boundaries

**Reviewed:** 2026-11-24 UTC
**Branch / HEAD:** `arena/d3b50abc-friendconnect-alo` / `c21d1e6a825238df7773fb9c990e36dfccd5b97e`
**Status:** source audit plus bounded security changes only; not a production architecture approval.

## Product boundary

Jara should be a single authenticated assistant experience across text, audio, camera/video, and SMS, but each channel must remain a separate, explicit input/output transport behind shared identity, authorization, consent, rate-limit, audit, and provider-policy controls. A browser transcription is user-submitted text, not proof of audio provenance. A LiveKit room is media transport, not permission for an AI agent to listen, record, or analyze. An approved knowledge record is not permission to expose private messages. Ordinary chat history is not persistent memory.

## Current source-verified paths

| Surface | Current implementation | Not established |
|---|---|---|
| Text DM | Next.js routes, persisted Jara messages, bounded server-built current-user/Jara context, five non-streaming text adapters; prompt can respond to input language | Provider availability/quality, evaluated Bangla/Banglish accuracy, general tools, semantic memory |
| Group interaction | Authenticated group path with membership/consent checks and persisted visible trigger message | General continuous listening, group memory, streaming agent |
| Voice | Browser `getUserMedia`/Web Speech recognition and browser speech synthesis; disclosure/Continue appears before mic permission; `/api/jara/voice` is a text-model bridge that rebuilds context from this user's visible persisted Jara DM and saves transcript/reply as ordinary chat history | Real server-side ASR/TTS, two-way realtime agent, streaming/barging, measured Bangla quality |
| Camera/video | Existing user-to-user group calls use LiveKit client SDK and an authorized conversation-membership token route | Jara visual perception, camera-frame upload/analysis, recording, Jara track publisher |
| SMS | Admin config and data models in one Prisma schema; inbound route now fails closed unless explicitly enabled for Twilio with signature verification and fixed HTTPS public URL | Carrier delivery, outbound adapter, delivery callback, provider credentials/account, production compliance |
| Cross-session continuity | Ordinary Jara DM messages persist and bounded context can use that same authenticated DM thread | Intentional continuity across conversations/channels, persistent personal memory, or semantic history retrieval |
| Personal memory | `JaraMemory` key/value schema exists; proposed privacy design documents controls | Runtime consent/read/write/review/correct/delete/retention/retrieval; `memoryEnabled` is not consent |
| Knowledge | Admin source record/API exists in canonical schema | Model-time retrieval, embedding, citations, permissions-aware indexing |
| Tools/tasks | Narrow deterministic admin/config and meeting-draft flows | General function calling, task queue, durable agent plan, verification/recovery loop |
| Notifications | FriendConnect notifications and push foundations exist | Jara task completion notifications or verified external delivery |

## Proposed service boundaries (not yet implemented)

1. **Next.js control plane:** session-derived identity, role checks, channel consent, explicit per-request policy, rate limits, bounded input, audit IDs, user controls. It remains the authority for FriendConnect access; workers never receive client-supplied identity as authorization.
2. **Provider gateway:** explicit one-provider-per-request selection, provider/data classification, timeouts, cancellation, budgets, content minimization, safe errors and telemetry. Existing adapter environment precedence is not a policy-aware router.
3. **Realtime media plane:** LiveKit rooms/tokens for media only; an isolated agent participant may join only after explicit per-call opt-in, participant notice/consent, scoped token grants, and a user-visible active indicator. Audio/video tracks should not be recorded by default. Stop/leave and revocation must terminate processing promptly.
4. **Worker plane:** separately deployable ASR, TTS, vision, and agent workers, authenticated with short-lived service credentials and strict request/response schemas. No direct DB access unless separately reviewed. Do not add these services to the app until hardware, model licenses, security, and test environments exist.
5. **Memory/knowledge:** different stores, consent policies and retrieval ACLs. Personal memory only from explicitly user-confirmed items for the owner; knowledge only from approved sources with provenance; conversation history only from records the caller can currently see. Retrieval is bounded and never expands the authorization boundary.
6. **Task/tool gateway:** allowlisted typed operations; server re-authorizes the current actor and resource on every execution. Writes, outbound communication, booking, and other consequential actions require a confirmation step and verified result. An LLM completion is never a completion receipt.
7. **Observability:** request IDs, provider/service status, timings and outcome classes without prompts, transcripts, memory values, secrets, or media. Define access/retention before enabling sensitive telemetry.

## Channel invariants

- User identity, group membership, recipient, and role come only from server session/database state.
- Jara is disclosed as an AI. Camera/microphone access is user-initiated, visibly active, stoppable, and never assumed from a call join.
- No channel is permitted to bypass message visibility (`deletedFor`, expiry, schedule), blocks, group membership, or explicit purpose consent.
- User disable/revocation applies before subsequent work and cancels in-flight provider/worker tasks where supported.
- Audio/video, transcript, chat history, memory, and provider telemetry have different retention purposes; do not combine them under one “memory” toggle.
- SMS opt-out and provider signature checks occur before persistence or action. A configuration flag is not a connected carrier.

## Authorization fixes in this worktree

- The legacy `/api/livekit/token` route now accepts only `fc-<conversationId>` rooms and checks the authenticated user's conversation membership before minting a token.
- `/api/calls/group` verifies membership on `end` and no longer deletes the shared LiveKit room when one participant leaves; LiveKit participant disconnect plus the room's empty timeout governs cleanup.
- SMS webhook ingestion uses a Twilio signature verifier and requires `JARA_SMS_PUBLIC_WEBHOOK_URL`, HTTPS, enabled inbound config and form-encoded requests. Other providers/media formats fail closed. No provider was contacted.

## Acceptance gates before realtime Jara launch

A disposable environment must demonstrate cross-account token denial, consent-off no-agent join, mid-call revoke/stop, no recording by default, private call/chat context isolation, malformed/replayed webhook handling, provider disconnect/timeout, concurrent sessions, background cancellation, accessibility and Bangla/English audio quality, security review, privacy/legal review, and resource/cost targets. This repository/environment has not passed those gates.
