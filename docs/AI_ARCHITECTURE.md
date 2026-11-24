# FriendConnect AI architecture audit and staged remediation report

**Audit / repair date:** 2026-11-24 UTC
**Repository:** `engralaminn-collab/friendconnect_alo`
**Branch:** `arena/d3b50abc-friendconnect-alo` (active)
**Base / HEAD:** `c21d1e6a825238df7773fb9c990e36dfccd5b97e` (unchanged; working tree is uncommitted)
**Scope:** source-level audit completed before AI code changes, followed by a bounded safety/context foundation and a conversation/evaluation foundation. No deployment, production restart, commit, or push performed. No provider credentials were inspected or exposed.

## Executive summary

FriendConnect contains several distinct AI-assisted paths, but it is **not a general task-completing agent runtime**. The existing real capability is non-streaming text completion through an environment-selected provider adapter. Jara can persist chat messages and has narrow, deterministic configuration/meeting actions protected by server-side authorization and approval logic. Other paths provide chat utility operations, group answers, a browser voice transcript bridge, and a transcription API with provider-dependent behavior.

The source does not provide model function calling, a general tool registry, planner/executor/verifier, durable AI task state, streaming, semantic memory retrieval, embeddings/vector search, or measured response-quality evaluation. The `JaraMemory` table and approved knowledge-source records exist but are not read into model prompts. UI labels, selected model names, config status, or capability metadata do not prove a model/service is reachable or a task has completed.

The first repair addressed bounded prompt inputs, server-owned prompt boundaries, per-user persisted Jara chat context, provider error honesty/no silent cross-provider fallback, route rate-limits, and history authorization. The follow-up phase added a shared conversation instruction contract and an opt-in scenario evaluator. Neither phase implemented new persistent memory, general agent/tool execution, or verified model quality improvement. Provider-backed tasks, quality, latency, cost, ASR/TTS, and external integration results remain **NOT RUN**.

## Baseline architecture map (before first-stage changes)

### Jara direct chat — `src/components/jara/JaraChat.tsx`, `/api/messages`, `/api/jara/chat`

- UI loads up to 50 direct messages, displays the latest 40, and posts browser-supplied conversation history with the latest user turn. The server persists latest user/assistant messages in the existing message store.
- Route authenticates via `getSessionUser`, applies a per-user rate limit, and checks `assertJaraEnabled('chat')`. Configuration branches retain role checks and use deterministic parsing/approval logic; ordinary chat uses one completion request.
- Before the first repair, normal chat trusted client-supplied turns as prompt context. There was no runtime access to JaraMemory or cross-conversation retrieval.
- `src/lib/ai.ts` selected the first configured provider using fixed environment precedence; Jara's persisted `llmProvider`/`llmModel` selection did not control the gateway.
- The old response path used greeting/keyword/echo `fallbackReply` output when no provider existed or a request failed, which could appear to be a genuine model response. Some message persistence errors are intentionally swallowed, risking incomplete history.
- Jara's supported configuration changes and meeting drafts are not general model tools: server-side regex parsing and deterministic route code identify narrow intents. Side effects rely on authorization and proposal/approval paths.

### Generic AI panel — `src/components/fc/ai/AIPanel.tsx`, `/api/ai/chat`

Before the repair, the panel sent client-managed history and a client-provided system prompt to an authenticated, rate-limited route. The route had no bounded role/size contract. The panel is not a message-reading or action-taking agent and has no tool API.

### Voice — `JaraVoiceCall`, `/api/jara/voice`, `/api/ai/transcribe`

Voice input/output primarily use browser `getUserMedia`, SpeechRecognition/Web Speech API, and `speechSynthesis`; the server voice endpoint is a text-completion bridge. It now ignores browser-submitted history, reconstructs context from the authenticated user's currently visible persisted Jara DM (including delete-for-me, expiry and schedule filtering), and stores voice transcripts/replies as ordinary messages. This is same-thread chat continuity, not long-term memory. Speech quality/availability depends on browser and installed voices. The avatar speaking-level pulse is simulated, not audio-driven lip sync. Server ASR/TTS variables/capability flags do not establish an active service. `/api/ai/transcribe` probes available SDK method names and may return 501. No server streaming ASR/TTS, streaming response, or barge-in path was verified.

### Group Jara — `/api/jara/group`

The route verifies authenticated user, group membership, group-level consent, Jara membership, and a persisted, caller-visible Jara mention identified by message ID, then fetches a limited recent group message window and requests a completion. It no longer accepts client-supplied text as the triggering group message. There is no semantic retrieval or model tool execution. The first repair added request/context bounds, rate limiting, explicit mention requirement, honest provider errors, and current-user visibility filtering for deleted/expired/not-yet-scheduled messages before constructing the provider context.

### Utility / admin paths

- `/api/ai/summarize` checks conversation membership, retrieves a bounded message slice, and calls a completion.
- `/api/ai/translate` and `/api/ai/moderate` are prompt-wrapped completions. Moderation JSON parse failure was observed to default to unflagged, so it is not suitable as a fail-closed enforcement decision without further repair.
- `/api/ai/models` and `/api/ai/status` reflect environment/config metadata, not provider health probes.
- Jara knowledge-source records can be managed/approved, but there is no inference retrieval/indexing/embedding pipeline.
- `/api/jara/history` previously exposed global audit/config history to any authenticated user; the first repair restricts it to Super Admin.

## Providers integrated in source and routing behavior

| Provider path | Source-level implementation | Config/model facts | Runtime status |
|---|---|---|---|
| Ollama | HTTP `/api/chat` adapter | `OLLAMA_URL`, `OLLAMA_MODEL` (default label `llama3.2`) | Code present; live endpoint/model **NOT RUN** |
| Z.ai | `z-ai-web-dev-sdk`, `chat.completions.create` | `ZAI_API_KEY` config signal; request does not show explicit model selection | Code present; SDK/provider semantics and cancellation **NOT RUN** |
| OpenRouter | HTTP chat-completions | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` or free-model default | Code present; live call **NOT RUN** |
| Hugging Face | HTTP inference API | `HUGGINGFACE_API_KEY`, `HF_MODEL`; adapter converts turns into role-prefixed plain text | Code present; endpoint/model compatibility **NOT RUN** |
| OpenAI-compatible HTTP | `/chat/completions` | `OPENAI_BASE_URL`, `AI_MODEL`, `OPENAI_API_KEY` / `AI_API_KEY` | Code present; live call **NOT RUN** |

Selection is a fixed environment precedence (Ollama → Z.ai → OpenRouter → Hugging Face → OpenAI-compatible), not task-, privacy-, context-window-, or capability-aware routing. Jara's DB-selected provider/model is not authoritative for dispatch. No direct Anthropic or Google Gemini adapter was identified. No dynamic health check, context-window selection, structured-output negotiation, cost/latency routing, or capability policy exists. Before the first repair, a failed adapter could be silently retried through Z.ai. That cross-provider fallback has been removed. HTTP adapters use a 45-second abort signal; Z.ai SDK cancellation remains unverified. Provider credentials are server-side; none are listed here.

Configuration **names** observed include `OLLAMA_URL`, `OLLAMA_MODEL`, `ZAI_API_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `HUGGINGFACE_API_KEY`, `HF_MODEL`, `OPENAI_API_KEY`, `AI_API_KEY`, `OPENAI_BASE_URL`, `AI_MODEL`, `JARA_ASR_URL`, `WHISPER_URL`, `FASTER_WHISPER_URL`, `JARA_TTS_URL`, `PIPER_URL`, and `ORPHEUS_URL`. Names/configuration do not establish availability.

## Capability classification

| Capability | Audit classification | Qualification |
|---|---|---|
| Text completion | Implemented in code; provider unverified | Five adapters; no external provider execution. |
| Provider selection | Partial | Fixed precedence; no task-aware routing; Jara DB preference ignored. |
| Local/cloud providers | Partial | HTTP/SDK adapters exist; availability/privacy/quality not tested. |
| Conversation context | Partial | Existing persisted DM records provide bounded Jara context; no semantic retrieval. |
| Persistent personal memory | Missing at runtime | `JaraMemory` schema exists, but no runtime read/write or user controls. |
| Knowledge retrieval | Missing in inference | Admin records exist, but no retrieval/index/embedding path. |
| Streaming | Missing | Completion adapters return complete answers; no stream path identified. |
| Model tools/function calling | Missing | No registry/function schema or model-call loop. |
| Jara config operations | Narrow implemented path | Deterministic parser/server actions, role/approval/audit constraints; not general agent execution. |
| Meeting operations | Partial | Draft/profile/UI paths exist; external calendar/video execution unverified. |
| Voice | Browser-dependent fallback | Browser speech recognition/synthesis; server voice endpoint is text model bridge; real ASR/TTS not verified. |
| Avatar lip-sync | Simulated preview | Not audio-driven rendering / not a real voice-generated video track. |
| AI evaluation | Partial foundation | Executable narrow rubric checks and runner now exist; live model evaluation is blocked. |

## First-stage safety/context changes

- `src/lib/ai-input.ts` adds bounded user/assistant turn validation and builds Jara context from the authenticated user's persisted one-to-one Jara messages only. It excludes deleted-for-everyone, per-user comma-list deletions, legacy sender-only `"me"`, expired, and future-scheduled rows, bounds history/context size, and adds the current input once if persistence failed.
- Generic `/api/ai/chat` now has a server-owned prompt, rejects system/tool/unknown roles, validates bounds, fails closed if the limiter is unavailable, and reports provider failure with an explicit 502. `AIPanel` no longer sends a client system prompt, trims local history to the request bound, and describes its lack of tools/chat access.
- `/api/jara/chat` validates turn roles/size but does not forward browser history to the provider; it rebuilds context from the authenticated user's persisted Jara thread. Missing provider and request failure are explicit 503/502 errors, not canned AI-like replies. The UI clips submitted history to the validator's limit.
- `/api/jara/voice` validates/rate-limits bounded transcript/history and uses a text-only completion bridge; it does not claim server-side recognition or speech synthesis.
- `/api/jara/group` retains membership and consent authorization while adding per-user rate limiting, bounded messages/context, explicit mention requirement, excluded unavailable messages, and provider error reporting.
- `/api/jara/history` now requires Super Admin authorization.
- `src/lib/ai.ts` returns typed provider failures and no longer produces fabricated assistant text or silently forwards the prompt to Z.ai after an error. HTTP adapter timeout is 45 seconds; Z.ai SDK cancellation behavior is not established.

## Phase B conversation foundations and evaluation

A shared prompt builder in `src/lib/jara-prompt.ts` is now used by direct Jara chat, voice text bridge, and group Jara. It tells the model to use relevant context, resolve references, honor user corrections, recognize topic changes, clarify essential ambiguity, state safe assumptions, adapt tone/length/language, express uncertainty, provide useful concise explanations rather than private reasoning traces, treat quoted content as untrusted data, and avoid unsupported action/human-experience claims. This is **IMPLEMENTED in prompt source**; response quality is **NOT VERIFIED** without model runs and human review.

An opt-in evaluation runner is in `scripts/ai-evaluate.ts`, with narrow deterministic checks in `src/lib/ai-evaluation.ts` and rubric metadata in `tests/ai/evaluation-scenarios.json`. Run via `AI_EVAL_LIVE=1 npm run ai:evaluate`; it makes sequential calls, retries zero times, caps at 10, hides completions unless `--include-responses` is passed, and reports cost/token usage as unavailable with the current adapter. The checks are text proxies and not a comprehensive measure of factual accuracy, semantic relevance, naturalness, or safe tool-use.

**Executed baseline:** `AI_EVAL_LIVE=1 npm run ai:evaluate -- --out=docs/AI_EVALUATION_BASELINE.json` — status **NOT_RUN**, provider `none`, `providerConfigured: false`, 0 model calls, 11 normal scenarios available. No AI quality baseline score exists; this is a configuration-blocked baseline, not a score of zero and not a pass.

## Memory, privacy, security, and permissions

The existing message store provides recent persisted Jara DM context for the current user/Jara pair. This is not long-term personalized memory. `JaraMemory` has no runtime path, review/edit/delete controls, retention semantics, or safe-secret exclusion policy, and remains inactive. Jara config's default `memoryEnabled: true` is metadata, not functioning memory or user consent. No second memory system or schema migration was added. Current-user delete-for-me IDs, delete-for-everyone, expired, and future-scheduled messages are filtered from direct/group model context; this was verified against a local mock-compatible provider payload. Do not store secrets as conversational memory.

Auth remains session-based. New chat/voice/group rate limits are keyed by authenticated user and fail closed (503) if the limiter is unavailable. Jara context is scoped to one authenticated user and Jara. Group path membership and consent gates remain. Generic chat does not gain app data or actions. Config/meeting actions remain deterministic server logic and existing role/approval paths, not model tool calls. Global history now requires Super Admin. Credentials remain server-side.

Context is still sent to whichever provider is selected; this work did not establish provider data retention, training, or privacy guarantees. Operators must review provider terms/configuration before enabling it. The system has no independent factual verifier, so answer truth remains model-dependent. Moderation parse failure was identified as fail-open and is not repaired in these phases.

## Tests, evaluation, and results

Deterministic tests cover bounded roles/content, context isolation/filtering, unconfigured AI, provider failure without cross-provider fallback, prompt-contract content, rubric scoring/unknown checks, and scenario schema/categories. Integration tests include prompt-role rejection and regular-user history denial alongside existing session/file/socket paths.

Current verification: `NEXTAUTH_SECRET=<test-only>` `npm test` passed 53 unit/security/evaluator/prompt cases, the scenario-schema test, the Next.js production build, and 2 integration tests. The session/API integration test sends Jara direct and group requests through a local mock OpenAI-compatible HTTP fixture and asserts the exact serialized provider payload excludes content hidden from the caller while preserving other participants' visibility; no external AI provider was contacted. `npm run lint`, `npm run typecheck`, `git diff --check`, and JavaScript syntax checks passed. The separate quality evaluator remains `NOT_RUN` with 0 external model calls because no approved provider is configured.

Metrics still **NOT PRODUCED**: model response quality, factual accuracy, intent understanding, task completion, memory retrieval, tool selection/execution, hallucination, human usefulness, provider latency/cost, and external ASR/TTS. Provider calls, calendar execution, external knowledge retrieval, multi-instance rate limiting, and deployed GitHub Actions runs are **NOT RUN**.

## Changed-file inventory for this AI work

- `docs/AI_ARCHITECTURE.md`, `docs/AI_PHASE_PLAN.md`, `docs/AI_EVALUATION_BASELINE.json` — source audit, phased findings, and actual no-provider baseline capture.
- `README.md` — AI capability/limitation link and agent boundary disclosure (prior phase).
- `src/lib/ai-input.ts`, `src/lib/ai.ts`, `src/lib/jara-prompt.ts`, `src/lib/ai-evaluation.ts` — bounded context, provider failure handling, conversation prompt, deterministic scoring proxies.
- `src/app/api/ai/chat/route.ts`, `src/app/api/jara/chat/route.ts`, `src/app/api/jara/voice/route.ts`, `src/app/api/jara/group/route.ts`, `src/app/api/jara/history/route.ts` — changes documented in first-stage section; the three Jara model paths now share the prompt builder.
- `src/components/fc/ai/AIPanel.tsx`, `src/components/jara/JaraChat.tsx` — bounded client history and accurate capability disclosure (prior phase).
- `scripts/ai-evaluate.ts` — opt-in controlled evaluator runner.
- `tests/ai/ai-input.test.ts`, `tests/ai/ai-routing.test.ts`, `tests/ai/ai-evaluation.test.ts`, `tests/ai/jara-prompt.test.ts`, `tests/ai/evaluation-scenarios.test.ts`, `tests/ai/evaluation-scenarios.json` — input/routing/prompt/evaluator/scenario tests and rubric data.
- `tests/integration/session-api.test.cjs` — prompt injection and Jara history authorization assertions (prior phase).
- `package.json` — evaluator and AI tests scripts.

The working tree also contains earlier non-AI session, file, and socket security changes on this same branch. Those are out of scope for this AI phase and must not be discarded by a broad reset. No schema/migration changes were made.

## Rollback and exact next stage

No commit exists. Before a commit, roll back only the AI-specific files listed above by reviewing a saved diff/source-control snapshot; do not blanket-reset because the branch contains unrelated security work. If a reviewed AI-only commit is made later, revert that commit only. Rollback restores previous prompts/behavior and known failure/security defects, so it should be temporary.

**Exact next stage:** Phase C has a documented privacy/consent design in [`JARA_MEMORY_PRIVACY_DESIGN.md`](./JARA_MEMORY_PRIVACY_DESIGN.md), but implementation is gated on the approvals listed there. Separately, complete Phase A/B validation by obtaining explicit approval for a test provider/model/usage, then execute and human-score the fixed baseline scenario set before claiming model-quality improvement. Do not configure a provider or make live calls before that approval. Add persistent memory only after policy decisions and user controls are approved and can ship with owner isolation, revocation/deletion, retention enforcement, and tests. Only then should Phase D/E introduce durable task state and authorized tools. No general agent or provider-routing expansion is justified until measured baseline and memory/tool policies exist.

## Expanded multimodal review addendum (2026-11-24)

The product audit in [`JARA_MULTIMODAL_ARCHITECTURE.md`](./JARA_MULTIMODAL_ARCHITECTURE.md) distinguishes FriendConnect media transport from Jara's absent media perception/agent. Existing LiveKit group-call SDK/routes do not make Jara a realtime audio/video participant. The legacy token route was restricted to `fc-<conversationId>` with membership authorization; leaving a shared group room no longer deletes it. No LiveKit server is configured or tested.

The SMS callback's former signature-header-presence check was replaced with fail-closed Twilio form signature verification against `JARA_SMS_PUBLIC_WEBHOOK_URL` over HTTPS. It requires inbound enabled plus configured Twilio and rejects unknown providers and JSON payloads. There is still no outbound SMS send adapter, carrier account, public URL, verified production credential store, or end-to-end test; existing SMS admin config does not prove integration.

Schema/runtime audit found significant existing parity gaps, so no new persistent-memory/SMS schema was introduced. `prisma/schema.prisma` declares 51 models, `schema.sqlite.prisma` 28, and `schema.mysql.prisma` 40. The raw SQLite runtime has no JaraSms delegates/tables. MySQL migrations add five governance tables and social/attachment tables, not all canonical Jara data models. `JaraMemory` lacks a User relation in Prisma models (raw SQLite DDL has a foreign key). Any memory/SMS launch needs a separate cross-database reconciliation and migration review.

Candidate licenses/maintenance metadata, runtime fit and operational cautions are in [`JARA_OPEN_SOURCE_STACK.md`](./JARA_OPEN_SOURCE_STACK.md). No candidate software or provider was installed, called, or benchmarked. Current sandbox hardware is only 2 CPU / ~3.8 GiB RAM without GPU/container tools, and does not inform production capacity.

See [`JARA_PRIVACY_AND_CONSENT.md`](./JARA_PRIVACY_AND_CONSENT.md), [`JARA_PROVIDER_CONFIGURATION.md`](./JARA_PROVIDER_CONFIGURATION.md), [`JARA_DEPLOYMENT_GUIDE.md`](./JARA_DEPLOYMENT_GUIDE.md), and [`JARA_TEST_REPORT.md`](./JARA_TEST_REPORT.md) for channel controls, configuration names, readiness, test outputs, blockers and rollback. The evaluation baseline remains `NOT_RUN` (0 model calls). No persistent memory, camera understanding, realtime agent, semantic retrieval, outbound SMS, or general task runner is implemented.
