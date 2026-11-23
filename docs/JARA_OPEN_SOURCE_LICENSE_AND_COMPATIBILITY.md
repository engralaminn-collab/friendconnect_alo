# Jara AI — Open-Source License & Compatibility Report

**Date:** 2026-11-23  
**Status:** Audit/planning document. No unverified model/license is marked production-ready.

## Evaluation Rules

Before integrating any external component:
- Verify source-code license and model-weight license separately.
- Verify dataset restrictions and commercial-use permission.
- Verify GPU/CUDA/Python/Node compatibility.
- Verify security/dependency maintenance status.
- Verify deployment and external service requirements.
- Do not integrate unclear/uncertain commercial rights.

## Candidate Components

| Component | Repo | Intended Role | License (verify before use) | Compatibility Notes | Status |
|---|---|---|---|---|---|
| Mynah | https://github.com/honwee/mynah | Digital-human reference architecture | Verify repo license | Reference/selective reuse only; do not replace FriendConnect ALO | NOT INTEGRATED |
| LiveKit Agents | https://github.com/livekit/agents | Realtime agent infrastructure | Apache-2.0 (verify) | LiveKit SDKs already in package.json; room/token/avatar pipeline not implemented | NOT INTEGRATED |
| LiveKit Avatar example | https://github.com/livekit/agents/tree/main/examples/avatar | Avatar integration reference | Apache-2.0 (verify) | Reference for avatar publishing pattern | NOT INTEGRATED |
| AI Avatar System (AvatarAI) | https://github.com/PunithVT/ai-avatar-system | Whisper/Chatterbox/MuseTalk/FastAPI reference | Verify repo + model weights | Likely GPU-heavy; evaluate as separate worker | NOT INTEGRATED |
| OpenAI Agents SDK (Python/JS) | https://github.com/openai/openai-agents-python / js | Optional orchestration/guardrails/handoffs | Verify license | Optional; existing Jara APIs/Prisma remain authoritative | NOT INTEGRATED |
| MuseTalk | https://github.com/TMElyralab/MuseTalk | Lip-sync/talking head | Verify code/model/license | GPU likely required; adapter boundary needed | NOT INTEGRATED |
| LivePortrait | https://github.com/KlingAIResearch/LivePortrait | Portrait animation | Verify code/model/license | GPU likely required; quality/latency benchmark needed | NOT INTEGRATED |
| IndicConformer | https://github.com/AI4Bharat/IndicConformerASR | Bengali ASR | Verify code/model/license | Candidate for server-side Bangla ASR; benchmark required | NOT INTEGRATED |
| Faster Whisper | https://github.com/SYSTRAN/faster-whisper | ASR baseline/fallback | Verify | CPU/GPU options; good fallback candidate | NOT INTEGRATED |
| Orpheus Bengali | https://github.com/kawshikbuet17/Orpheus-TTS-Bengali-Finetuning | Bengali TTS | Verify base/model/finetune licenses | Benchmark naturalness/latency before use | NOT INTEGRATED |
| Chatterbox Bangla | https://github.com/jongy5/chatterbox-bangla | Bengali TTS | Verify | Evaluate alongside Orpheus/Piper | NOT INTEGRATED |
| Piper | https://github.com/rhasspy/piper | Self-hosted TTS | Verify | Practical CPU fallback; Bangla voice availability must be verified | NOT INTEGRATED |

## Current Safe State

- Browser Web Speech API STT/TTS is used as **fallback/preview only** and must be labeled as such.
- Canvas Jara avatar is a **fallback UI renderer**, not a real audio-driven video renderer.
- No external model weights downloaded/installed by this change.
- No unclear-license asset/model integrated.

## Required Before Production Integration

1. Create a per-component license matrix with source URL, commit/tag, license text, model-weight license, dataset license, commercial-use verdict.
2. Run dependency security scan and GPU/CPU benchmarks.
3. Isolate GPU renderers behind authenticated internal worker APIs.
4. Keep feature flags off until credentials/models/hardware pass verification.