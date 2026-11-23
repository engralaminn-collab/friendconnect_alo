# Jara AI — External Requirements & Blockers

**Date:** 2026-11-23  
**Rule:** No secret values are recorded here. Status reflects repository/sandbox inspection only.

## A. GPU / Digital Human Renderer

| Requirement | Needed for | Status | Notes |
|---|---|---:|---|
| NVIDIA GPU host / CUDA-compatible drivers | MuseTalk/LivePortrait/real-time avatar rendering | BLOCKED (unverified) | Sandbox has no GPU verification; production host hardware not inspected. |
| Model weights + license verification | Avatar/lip-sync/TTS/ASR models | BLOCKED | No weights downloaded; licenses must be verified per model. |
| VRAM/concurrency benchmark | Concurrent call isolation/performance | BLOCKED | Requires actual GPU environment. |
| Authenticated GPU worker boundary | Secure offload from app server | NOT IMPLEMENTED | Adapter interface/docs needed; no worker deployed. |

## B. Bengali / English Voice

| Requirement | Needed for | Status | Notes |
|---|---|---:|---|
| Server-side ASR (IndicConformer/Faster Whisper) | Real STT | NOT CONFIGURED | Browser SpeechRecognition currently used as fallback. |
| Server-side TTS (Orpheus/Chatterbox/Piper) | Real Bangla/English TTS | NOT CONFIGURED | Browser speechSynthesis currently used as fallback. |
| Audio benchmark dataset/process | Quality/latency acceptance | NOT IMPLEMENTED | Required before claiming natural Bangla support. |

## C. SMS

| Requirement | Needed for | Status | Notes |
|---|---|---:|---|
| Approved SMS provider account/credentials | Outbound/inbound SMS delivery | NOT CONFIGURED | `JaraSmsConfig` exists; no provider adapter/webhook delivery. |
| Sender registration/compliance | Production SMS | BLOCKED/EXTERNAL | Depends on country/provider. |
| Webhook endpoint + signature verification | Delivery status/opt-out | NOT IMPLEMENTED | |

## D. Meetings

| Requirement | Needed for | Status | Notes |
|---|---|---:|---|
| Zoom/Google/Microsoft app credentials + OAuth consent | Authorized meeting integrations | NOT CONFIGURED | Integration records only. |
| Compliance/recording consent review | Meeting participation/recording | NOT IMPLEMENTED | |

## E. Storage / Scanning

| Requirement | Needed for | Status | Notes |
|---|---|---:|---|
| Secure object storage (S3-compatible/local secure volume) | Asset uploads | NOT CONFIGURED | Asset API accepts trusted local paths; no upload pipeline. |
| Malware scanning | Safe uploads | NOT IMPLEMENTED | |
| Backup/retention/deletion policy | Privacy/compliance | PARTIAL | Docs/process needed. |

## F. Database / Deployment

| Requirement | Needed for | Status | Notes |
|---|---|---:|---|
| Prisma engines available in CI/build env | prisma validate/generate/migrations | BLOCKED in sandbox | `binaries.prisma.sh` unreachable in sandbox. |
| Reviewed dev DB backup before db push | Safe schema sync | REQUIRED | Do not run unreviewed db push against production. |
| Production migration process | Safe deploy | PARTIAL | Existing deploy scripts present; Jara schema migration needs review. |

## G. LiveKit / Realtime

| Requirement | Needed for | Status | Notes |
|---|---|---:|---|
| LiveKit server/credentials (if using LiveKit cloud/self-host) | Real-time rooms/tokens/avatar tracks | NOT CONFIGURED | SDKs installed; no LiveKit token/room/avatar implementation. |
| TURN/STUN properly configured | Reliable WebRTC across NAT | PARTIAL | Existing TURN config/docs present; environment-specific. |