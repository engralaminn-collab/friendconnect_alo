# Jara AI — External Requirements & Blockers

**Date:** 2026-11-23  
**Rule:** No secret values are recorded here. Status reflects repository/sandbox inspection only.

## A. GPU / Digital Human Renderer

| Requirement | Needed for | Status | Notes |
|---|---|---:|---|
| NVIDIA GPU host / CUDA-compatible drivers | MuseTalk/LivePortrait/InfiniteTalk avatar rendering | BLOCKED (unverified) | Sandbox has no GPU; production host hardware not inspected. |
| Model weights + license verification | Avatar/lip-sync/TTS/ASR models | BLOCKED | No weights downloaded; licenses must be verified per model. |
| VRAM/concurrency benchmark | Concurrent call isolation/performance | BLOCKED | Requires actual GPU environment. |
| Authenticated GPU worker boundary | Secure offload from app server | ADAPTER READY / UNCONFIGURED | `src/lib/jara-renderer.ts` + `/api/jara/renderer/{status,render}` support GPU worker HTTP, ComfyUI API, and RunningHub; set `JARA_GPU_WORKER_URL`, `COMFYUI_API_URL`, or `RUNNINGHUB_API_KEY`. |

## B. Bengali / English Voice

| Requirement | Needed for | Status | Notes |
|---|---|---:|---|
| Server-side ASR (Faster-Whisper / Whisper) | Real STT | ADAPTER READY / UNCONFIGURED | `src/lib/jara-voice.ts` supports `JARA_ASR_URL` / `FASTER_WHISPER_URL` / OpenAI Whisper; defaults to browser SpeechRecognition fallback. |
| Server-side TTS (Piper / Orpheus / OpenAI TTS) | Real Bangla/English TTS | ADAPTER READY / UNCONFIGURED | `src/lib/jara-voice.ts` supports `JARA_TTS_URL` / `PIPER_TTS_URL` / OpenAI TTS + `AudioContext` lip-sync in `JaraVoiceCall.tsx`; defaults to browser speechSynthesis fallback. |
| Audio benchmark dataset/process | Quality/latency acceptance | NOT IMPLEMENTED | Required before claiming natural Bangla support. |

## C. SMS

| Requirement | Needed for | Status | Notes |
|---|---|---:|---|
| Approved SMS provider account/credentials | Outbound/inbound SMS delivery | ADAPTER READY / UNCONFIGURED | `src/lib/jara-sms.ts` supports `httpsms`, `telnyx`, and `twilio` + `POST /api/jara/sms/send`; requires live provider keys in `.env`. |
| Sender registration/compliance | Production SMS | BLOCKED/EXTERNAL | Depends on country/provider. |
| Webhook endpoint + signature verification | Delivery status/opt-out | IMPLEMENTED | `/api/jara/sms/webhook` verifies httpSMS HS256 JWT, Telnyx Ed25519, and Twilio HMAC-SHA1 signatures. |

## D. Meetings

| Requirement | Needed for | Status | Notes |
|---|---|---:|---|
| Zoom/Google/Microsoft app credentials + OAuth consent | Authorized meeting integrations | NOT CONFIGURED | Integration records only. |
| Compliance/recording consent review | Meeting participation/recording | NOT IMPLEMENTED | |

## E. Storage / Scanning

| Requirement | Needed for | Status | Notes |
|---|---|---:|---|
| Secure object storage (S3-compatible/local secure volume) | Asset uploads | CONFIGURED (LOCAL) | `/api/files/upload` and `/api/jara/assets/upload` persist files with `FileAccess` ACL grants. |
| Malware scanning | Safe uploads | ADAPTER READY / UNCONFIGURED | `src/lib/jara-scanner.ts` implements ClamAV `clamd` `INSTREAM` protocol when `JARA_MALWARE_SCAN=clamav` + `CLAMD_HOST`/`CLAMD_SOCKET` are configured. |
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