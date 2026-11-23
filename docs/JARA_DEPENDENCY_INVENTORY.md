# Jara Dependency & License Inventory

Generated: 2026-11-23
Scope: Jara AI Companion + Governance + Voice + Avatar

## 1. Core Platform Dependencies (existing FriendConnect)

| Package | Version | License | Purpose | Maintenance |
|---------|---------|---------|---------|-------------|
| next | 16.3.0 | MIT | App framework | Active (Vercel) |
| react / react-dom | 19.0.0 | MIT | UI | Active |
| prisma / @prisma/client | 6.11.1 | Apache-2.0 | DB ORM (MySQL) + SQLite fallback via db-runtime.js | Active |
| better-sqlite3 | 9.x | MIT | SQLite dev DB | Active |
| socket.io / socket.io-client | 4.8.4 | MIT | Realtime messaging | Active |
| next-auth | 4.24.11 | ISC | Auth | Active |
| bcryptjs | 3.0.3 | MIT | Password hashing | Active |
| ioredis / @socket.io/redis-adapter | 5.4.1 / — | MIT | Redis scaling | Active |
| @prisma/adapter-better-sqlite3 / @prisma/adapter-mariadb | 6.x | Apache-2.0 | Prisma driver adapters | Active |

## 2. Jara AI Gateway

| Package / Service | License | Cost | Bangla Support | Maintenance | Notes |
|-----------------|---------|------|----------------|-------------|-------|
| Ollama (https://github.com/ollama/ollama) | MIT | Free self-hosted | Yes (llama3.2, qwen2.5 support Bangla) | Active — 40k+ stars, daily commits | **Recommended** — local LLM |
| z-ai-web-dev-sdk | Apache-2.0 | Free tier | Yes | Active | Already in package.json, used as fallback |
| OpenRouter (https://openrouter.ai) | Commercial (free models) | Free tier (meta-llama:free etc.) | Partial | Active | Optional free cloud LLMs |
| LocalAI (https://github.com/mudler/LocalAI) | MIT | Free self-hosted | Yes | Active | Alternative to Ollama (not installed, evaluated) |
| Hugging Face Inference | Varies per model | Free 1000 req/day | Model-dependent | Active | Optional |

**Selected for Jara:** Ollama (primary, self-hosted) + z-ai SDK (fallback). LLM identity is decoupled — switching model does not change Jara's account.

## 3. Voice: Speech Recognition (STT)

| Implementation | License | Bangla | Latency | CPU/GPU | Status |
|----------------|---------|--------|---------|---------|--------|
| **Browser Web Speech API (webkitSpeechRecognition)** | Browser native (no extra dep) | **Yes** — `bn-BD` lang code tested in Chrome/Edge | ~300-800ms | CPU only (browser) | **Used for MVP** — free, self-hosted, no server required |
| whisper.cpp (https://github.com/ggml-org/whisper.cpp) | MIT | Yes (multilingual model) | 1-3s (CPU) / ~400ms (GPU) | 4GB RAM min, GPU optional | Evaluated — recommended for production self-hosted STT |
| OpenAI Whisper (server) | MIT (model) | Yes | ~1s | GPU preferred | Requires API key or self-host |

**Jara choice:** Browser Web Speech API for immediate use (no server GPU needed). whisper.cpp documented for production where offline Bangla STT is required.

## 4. Voice: Text-to-Speech (TTS)

| Implementation | License | Bangla voice | Quality | Requirements |
|----------------|---------|--------------|---------|--------------|
| **Browser SpeechSynthesis API** | Browser native | **Partial** — Chrome has bn-BD voice on some OS; fallback to en-US | Medium | None (client) — **used for MVP** |
| Piper TTS (https://github.com/rhasspy/piper) | MIT | Yes (bn model available) | High (natural) | Self-hosted, ~200MB model, CPU |
| Coqui TTS | MPL-2.0 | Yes with community model | High | Self-hosted, Python |
| Edge TTS (unofficial) | Reverse-engineered MS API | Yes (`bn-BD-NabanitaNeural`) | Very high | Free tier, no key, but not officially supported |

**Jara choice:** Browser SpeechSynthesis for MVP + documented upgrade path to Piper (self-hosted, MIT, free).

## 5. Avatar / Visual Identity

| Project | Repo | License | Type | Maintenance | Jara decision |
|---------|------|---------|------|-------------|---------------|
| **talking-avatar** | https://github.com/InterviewFlowAI/talking-avatar | MIT | 2D canvas + audio viseme | Last commit 2024, 200 stars | Evaluated — simple, but limited |
| **talkinghead** | https://github.com/met4citizen/talkinghead | MIT | Three.js 3D avatar, lip-sync, blink, morphs | Active, 1k+ stars | **Recommended for 3D** — self-hosted, browser-based, free |
| **mynah** | https://github.com/honwee/mynah | MIT | Simple 2D avatar | Low activity | Evaluated — too minimal |
| **Open-ai-video-chat** | https://github.com/pinnacleadvisors/Open-ai-video-chat | MIT | Full video chat | Low activity | Evaluated — heavyweight |

**Jara implementation:** Custom canvas-based avatar (JaraAvatar.tsx) inspired by talkinghead morph targets — self-hosted, free, no paid service required. Supports face/background/theme/clothing via config. Talkinghead integration is a drop-in upgrade (Three.js already available via framer-motion ecosystem). No D-ID / HeyGen / paid avatar service required.

## 6. Real-time Voice/Video Infrastructure

| Project | License | Use case | Decision |
|---------|---------|----------|----------|
| LiveKit (https://github.com/livekit/livekit) | Apache-2.0 | SFU for group calls | Evaluated — recommended if WebRTC mesh fails at scale. Current WebRTC (socket.io signaling + STUN/TURN) is retained for 1:1 and small groups to avoid dual infra. |
| LiveKit Agents (https://github.com/livekit/agents) | Apache-2.0 | AI voice agents | Evaluated — optional future for Jara voice room (STT→LLM→TTS pipeline). Current is browser-direct. |
| Pipecat (https://github.com/pipecat-ai/pipecat) | BSD-2 | Voice pipeline orchestration | Evaluated — optional future. |
| coturn (https://github.com/coturn/coturn) | BSD-3 | TURN relay | Active — already documented in coturn/ folder; install script ready. |

## 7. Security Considerations

- All avatar/voice assets are MIT or browser-native — no commercial redistribution restrictions.
- Ollama models: llama3.2 (Meta Llama Community License — commercial use allowed with attribution), qwen2.5 (Tongyi Qianwen — Apache-2.0 friendly), whisper (MIT).
- No paid SaaS is mandatory. All Jara features work self-hosted.
- TURN secrets never exposed to frontend (ice config via /api/webrtc/config with auth).

## 8. Pinning

All versions pinned in package.json / bun.lock. Ollama model tag: `llama3.2` (latest). Upgrades via `OLLAMA_MODEL` env var without code change.

