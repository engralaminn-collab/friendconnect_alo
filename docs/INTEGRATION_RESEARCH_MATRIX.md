# Integration research matrix

**Status: PARTIAL. Metadata only. No supplied repository has been reviewed at source level yet.**

The request asks for each repository to be read at source level (entry points, APIs, auth, migrations, tests, Dockerfiles, licence files, security policy, and so on) before a decision is made. That was not done in this session. The table below records what was actually verified: the GitHub repository metadata (`gh api repos/<owner>/<repo>`: SPDX licence field, archived flag, last push date) and, where the metadata said `NOASSERTION`, the text of the LICENSE file. Every "Source paths", "Dependencies", and "Security findings" cell that reads *not inspected* is an open item, not a finding.

Decisions use only the allowed vocabulary. A decision marked *provisional* must be confirmed by source review before any code is reused. No decision authorizes copying code.

Checked 2026-11-28 with `gh api`.

| Source | Feature of interest | Source paths | License (verified) | Dependencies | Security findings | Deployment requirements | Compatibility with FriendConnect | Decision |
|---|---|---|---|---|---|---|---|---|
| `livekit/livekit` | WebRTC SFU for group audio/video | not inspected | Apache-2.0 (GitHub metadata) | not inspected | not inspected | Separate media server; TURN/UDP ports; hardware not assessed | FriendConnect already depends on `livekit-client` and `livekit-server-sdk` (Apache-2.0) and ships `deploy/livekit.yaml` | **RUN AS SEPARATE SERVICE (provisional)**. Candidate for group/AI media; the existing `/api/livekit/token` route is the integration point. Source review required first. |
| `coturn` (used in `docker-compose.yml`, `deploy/`) | TURN relay | not inspected in this session | BSD-3-Clause per upstream (not fetched) | n/a | n/a | UDP relay range | Already used; `docker-compose.yml` now uses it | **RUN AS SEPARATE SERVICE** (already in use) |
| `Alishahryar1/free-claude-code` | Provider routing, Anthropic/OpenAI-compatible proxying | not inspected | **AGPL-3.0-only** (LICENSE file, copyright 2026 Ali Khokhar) | not inspected | not inspected | not inspected | AGPL-3.0 network copyleft: copying code into FriendConnect would impose AGPL terms on the whole service | **REFERENCE ONLY.** Do not copy code. Re-implement provider routing in `src/lib/ai-gateway.ts` from public API specs. |
| `activepieces/activepieces` | Workflow automation pieces and engine | not inspected | `NOASSERTION`; LICENSE says core is MIT with `packages/ee` under a separate commercial licence | not inspected | not inspected | Separate Node service; Postgres/Redis in upstream setup (not verified) | Workflow model would need its own database; FriendConnect's existing job loop is in `socket-server.js` | **REFERENCE ONLY (provisional RUN AS SEPARATE SERVICE for the MIT core only).** Do not use any `packages/ee` code. |
| `obsproject/obs-studio` | Screen capture reference | not inspected | GPL-2.0 | n/a | n/a | Desktop application | Not a WebRTC backend (as the request states) | **REFERENCE ONLY.** GPL-2.0 code must not be copied. |
| `nocobase/nocobase` | Plugin/data/workflow platform | not inspected | `NOASSERTION`; custom "NocoBase License Agreement" | n/a | n/a | n/a | Would replace the data layer; rejected by request ("do not replace the database") | **REFERENCE ONLY** |
| `nocobase/NocoCRM` | AI-assisted CRM reference | not inspected | `NOASSERTION`; custom "NocoBase License Agreement" | n/a | n/a | n/a | CRM is out of current scope | **REFERENCE ONLY** |
| `directus/directus` | Data API / CMS | not inspected | `NOASSERTION`; **Monospace Sustainable Core License 1.0** (source-available, not OSI) | n/a | n/a | n/a | Would replace the database layer | **REJECT WITH EVIDENCE** for code reuse (licence is not OSI open source and the request forbids replacing the database without proven need) |
| `temporalio/temporal` | Durable workflows | not inspected | MIT | n/a | n/a | Cassandra/Postgres/MySQL plus services; heavy | Existing job loop covers current needs | **REJECT WITH EVIDENCE** for now: the request allows Temporal only if the existing job system cannot meet requirements, and no such need has been measured. |
| `open-webui/open-webui` | Chat UI, Ollama and OpenAI-compatible connections | not inspected | `NOASSERTION`; custom "Open WebUI License" (attribution/branding terms) | n/a | n/a | n/a | Duplicates FriendConnect chat UI | **REFERENCE ONLY.** Branding terms apply; do not copy. |
| `LibreChat-AI/LibreChat` | Multi-provider chat with agents and MCP | not inspected | MIT | not inspected | not inspected | Mongo/Meili/etc. (not verified) | Overlaps the AI gateway | **REFERENCE ONLY** (agent and MCP design ideas) |
| `SWE-agent/SWE-agent` | Coding agent in sandboxed repo | not inspected | MIT | not inspected | not inspected | Docker-based sandbox (not verified) | Coding-agent use is outside the communication scope | **REFERENCE ONLY** |
| `sahilatahar/Code-Sync` | Real-time collaborative code editing | not inspected | MIT (pushed 2026-06-17) | not inspected | not inspected | not inspected | Collaboration workspace is a later phase | **REFERENCE ONLY (provisional ADAPT SELECTED CONCEPTS)** until source review |
| `postmill-ai/postmill-app` | Social/community app | not inspected | **AGPL-3.0** | n/a | n/a | n/a | AGPL copyleft | **REFERENCE ONLY** |
| `twilio-labs/call-gpt` | Phone AI agent reference | not inspected | MIT (last push 2024-12-13) | not inspected | not inspected | Twilio account (paid per use) | Twilio is paid; not activated | **REFERENCE ONLY** |
| `joincalldotco/Call` | Calling app | not inspected | MIT (last push 2026-01-09) | not inspected | not inspected | not inspected | Overlaps existing calling | **REFERENCE ONLY** |
| `amulchapla/AI-Powered-Call-Center-Intelligence` | Call analytics reference | not inspected | MIT (last push 2023-06-29, stale) | not inspected | not inspected | not inspected | Stale | **REFERENCE ONLY** |
| `neondatabase/autoscaling` | Kubernetes autoscaler for Neon Postgres | not inspected | Apache-2.0 | n/a | n/a | Kubernetes | Targets Postgres and Kubernetes; FriendConnect uses SQLite/MySQL and Docker Compose | **REJECT WITH EVIDENCE** (not applicable to the architecture) |
| `MeiGen-AI/InfiniteTalk` | Talking-video generation | not inspected | Apache-2.0 | not inspected | not inspected | GPU; model weights (not assessed) | Media generation is an optional separate service; no GPU available | **REJECT WITH EVIDENCE** for production host (hardware not available; weights and licence not checked) |
| `ripienaar/free-for-dev` | Discovery list of free services | not inspected | No licence file | n/a | n/a | n/a | Discovery list, not software | **REFERENCE ONLY**. Each listed service must be verified separately. |
| `MirrorFly/mirrorfly-react-chat-sample` (named in request) | React chat SDK sample | not reviewed | **BLOCKED**: `gh api` returned 404 for this repository path; the organisation was not enumerated | n/a | n/a | n/a | SDK services may be paid | **BLOCKED WITH EXACT REASON**: repository path not found; org enumeration not performed |
| `jarvis.cx`, `jarvis.institute` (marketing sites), `topics/jarvis-ai` | Product comparison | not reviewed | n/a | n/a | n/a | n/a | Request says these are not to be used for decisions | **REJECT WITH EVIDENCE**: marketing material, not source |
| Lark Suite (`larksuite.com`) | Product reference | not reviewed (proprietary) | Proprietary | n/a | n/a | Hosted service | Reference only; no source | **REFERENCE ONLY** (product comparison; do not scrape) |
| `anomalyco/browse`, `anomalyco/*` org, `perrypixel/10x-Tool-Calls`, `rasonyang` repositories, `jarves` org, `MeiGen-AI` org, `SWE-agent` org (other repos), `nocobase` org (other repos), `directus` org (other repos), `temporalio` org (other repos), `LibreChat-AI` org (other repos), `OBS` (other repos), `MirrorFly` org (other repos), `Activepieces` (other repos) | Various | not inspected | not checked | not checked | not checked | not checked | not checked | **NOT REVIEWED** (open item). Each must be enumerated and inspected before any decision. |

## Mapping to existing FriendConnect architecture

- Realtime and signaling: `socket-server.js` (authoritative), `src/lib/socket-security.cjs`, `src/lib/webrtc.ts`, `src/lib/ice.ts`.
- Media: `src/app/api/livekit/token`, `src/app/api/calls/*`, `livekit-client` and `livekit-server-sdk` already in `package.json`.
- AI: `src/lib/ai-gateway.ts`, `src/lib/ai-identity.ts`, `src/lib/jara*.ts`, `src/app/api/jara/*`.
- Jobs: `runJobs()` in `socket-server.js` (scheduled messages, reminders, expired sessions, ringing calls).
- Storage and access: `src/lib/file-access.ts`, `src/lib/upload-security.cjs`, `src/app/api/files/[id]/route.ts`.

## Open items before any INTEGRATE decision

1. Source review of LiveKit (`livekit/livekit`) and the `livekit` deploy config.
2. Enumeration of each organisation named in the request.
3. Source review of `sahilatahar/Code-Sync` (MIT) for concepts only.
4. Verification of `MirrorFly` repository paths.
