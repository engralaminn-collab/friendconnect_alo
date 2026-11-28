# Voice and video architecture — status

Status as of 2026-11-28 (branch `arena/2b2a87d0-friendconnect-alo`, `b6248b6`).

| Item | Status |
|---|---|
| Human one-to-one audio and video (WebRTC P2P, signalling, ICE, TURN config) | Implemented; a real two-way Chromium call is recorded in the PR #3 test report. Re-verification has not been done on this branch. |
| Group calls via LiveKit (`/api/calls/group`, `/api/livekit/token`, `GroupCallView`, documented in `docs/group-calls.md`) | Implemented in code, **conditional** on `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` (commented out in `.env.example`). **No test** references these routes, and no LiveKit server was run. Status: unverified. |
| Jara voice conversation (browser speech recognition and SpeechSynthesis, `/api/jara/voice`) | Implemented in the browser. This is not a server-side real-time voice session. |
| Jara as a real media participant (LiveKit or otherwise) | **Not implemented.** Jara is not a LiveKit participant. The existing LiveKit code serves human group calls only. |
| Local STT/TTS (Whisper-family, Piper) | **Not evaluated or deployed.** No latency measurement exists. |
| Architecture decision record for AI media participation | **Not written.** Required before implementation. |

Not verified: any real-time AI voice or video participation. A Canvas avatar is not a media participant.
