# Jara live avatar — status

Status as of 2026-11-28 (branch `arena/2b2a87d0-friendconnect-alo`, `b6248b6`).

| Item | Status |
|---|---|
| Existing Canvas 2D avatar in the Jara UI | Implemented. It is a UI animation, not a video track. |
| Existing avatar-render job dispatch (`/api/jara/renderer/render`, `src/lib/jara-renderer.ts`) | Dispatch exists with modes selected by environment: a GPU worker (`JARA_GPU_WORKER_URL`) and a `livekit_avatar` mode (`JARA_LIVEKIT_AVATAR_URL`). **Neither worker was available or verified**, and no test exercises the render route. |
| Full-body, office-style, live, speech-synchronised avatar | **Not implemented.** |
| Capacity and latency assessment (GPU, VRAM, real-time factor) | **Not performed.** No GPU worker was available in this sandbox. |
| Licence review of candidate pipelines (LiveKit Agents examples, Tavus, Anam, D-ID, LemonSlice, InfiniteTalk, MultiTalk) | Not performed at source level. Do not treat any candidate as approved. |

Not verified: a live full-body avatar on a call. A generated demo video is not a live call test.
