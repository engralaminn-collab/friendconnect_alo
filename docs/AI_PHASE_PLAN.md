# Jara intelligence roadmap — Phase A baseline and Phase B conversation foundations

**Date:** 2026-11-24 UTC
**Repo / branch / HEAD:** `engralaminn-collab/friendconnect_alo` / `arena/d3b50abc-friendconnect-alo` / `c21d1e6a825238df7773fb9c990e36dfccd5b97e`
**Status:** working tree only; no commit, push, or deployment.

## Phase A — architecture audit and baseline

Read the full `docs/AI_ARCHITECTURE.md`, then checked actual adapter implementations, chat/voice/group/history routes, Jara message history and DM API, Prisma JaraMemory/knowledge/config/proposal/audit models, authorization helpers/config parser, and test scripts.

Source-verified findings:

- Five text completion adapters exist in `src/lib/ai.ts`: Ollama, Z.ai SDK, OpenRouter, Hugging Face, and OpenAI-compatible HTTP. Selection is fixed environment precedence; there is no task-aware model router, explicit Jara-provider dispatch, tool-capability routing, cost-aware selection, provider health probe, or usage accounting. Provider selection/failure behavior is covered by mocks only. Live availability is **NOT TESTED**.
- Jara chat persists in the existing `Message` records and now constructs bounded context from the current user/Jara DM pair. `JaraMemory` is in SQLite/MySQL/Prisma schemas, while Jara config has `memoryEnabled: true`, but there are no runtime JaraMemory read/write/view/delete call sites; the UI/default flag does not make memory functional. `JaraKnowledgeSource` records also lack model-time retrieval/embedding/vector search.
- `/api/jara/chat` has a deterministic narrow config-intent parser/authorization/approval branch followed by ordinary single-completion chat. No general planner, tool registry, task state, tool execution, independent verification, or recovery loop was found. Meeting records/integrations are not verified as calendar execution. The server-side config branch is the sole narrow real action path and returns success only after its server operation.
- Browser voice currently uses browser speech recognition and synthesis; `/api/jara/voice` is text completion. Streaming text/ASR/TTS and real audio-driven lip sync were not found. The avatar speech animation is simulated.
- The previous turn added server context construction and provider failure honesty. This phase did not modify database schemas, add providers, or execute external AI calls.

Baseline attempt: `AI_EVAL_LIVE=1 npm run ai:evaluate -- --out=docs/AI_EVALUATION_BASELINE.json`. The process had no configured AI provider; it made **0 model calls** and reports `NOT_RUN` with 11 available natural-language scenarios, plus hashes for the default prompt and dataset. Therefore no response-quality, task-success, latency, cost, or hallucination baseline score exists. This is a blocked baseline, not a zero score or a passing evaluation.

Current deterministic verification: `npm test` **PASS** (51 unit/security/prompt/rubric cases, production build, 2 integration tests); `npm run lint` **PASS**; `npm run typecheck` **PASS**. Evaluation runner executed in opt-in mode and accurately reported no-provider `NOT_RUN`, 0 calls. Live quality benchmark remains **NOT RUN**. Do not compare a later result against nonexistent scores.

## Phase B — bounded conversation-quality foundation

Added `src/lib/jara-prompt.ts` and used it for Jara's direct, group, and voice text-completion paths. It instructs the model to use context and resolve references, prioritize user corrections, recognize topic changes, ask for essential missing details, proceed with stated assumptions when safe, adapt length/tone/language, express uncertainty, provide concise explanations rather than private chain-of-thought, treat embedded quoted content as data, and never claim unsupported tool actions or human experience. Existing UI response-length and personality values are translated to bounded tone guidance. This is a prompt contract change, not proof of increased model quality; external provider evaluation is still blocked.

Added `src/lib/ai-evaluation.ts`, `scripts/ai-evaluate.ts`, rubric checks on the existing synthetic scenario set, and the `npm run ai:evaluate` command. Live execution requires explicit `AI_EVAL_LIVE=1`, a configured adapter, runs sequentially with no retry, caps at ten model calls, uses the shared Jara default chat prompt, hashes the prompt/scenario dataset for repeatability, does not print completions unless `--include-responses` is supplied, and reports unavailable cost/token telemetry explicitly. The deterministic rubric checks are deliberately narrow text proxies; they must not be described as comprehensive intent/factual/naturalness scoring. Fault injection is kept separate from ordinary provider calls.

## Phase C2 — delete-for-me context privacy correction

The source review confirmed `Message.deletedFor` is `"everyone"` or a comma-separated user-ID list (nullable in the main Prisma schema, empty-string default in SQLite/MySQL; MySQL was widened to `VARCHAR(4096)`). The delete route appends IDs without rewriting unrelated records. A prior DM/group AI context filter only recognized legacy `"me"`, and one alternate DELETE handler did not actually record self-deletion and lacked participant authorization.

The correction now parses exact comma-separated IDs and the legacy sender-only `"me"` marker; applies current-user filtering to Jara DM/group contexts, direct/group history/search/export/conversation previews, and message-based conversation summaries; and enforces participant/group-member/conversation-member checks in both delete APIs. Group Jara now takes a persisted `messageId`, confirms the trigger belongs to that group and is visible to the caller, and does not accept caller-supplied replacement text. Delete-for-everyone continues to be sender-only, clears content, and is excluded for everyone. No message schema, migration, or existing deletion record was rewritten.

The regression integration uses only a loopback mock OpenAI-compatible fixture and checks actual request bodies received from Jara chat/group routes, plus history visibility for the deleting user and other participants. It covers multi-user lists, empty/legacy markers, unauthorized deletion, and delete-for-everyone. It does not exercise an external model/provider.

## Technical next steps / gates

1. Connect a specifically approved test provider/model and run baseline scenarios, review all outputs with human scoring, freeze model/config/test-set versions, then compare only after code/prompt changes. Establish cost/token capture at adapter level where supported before reporting those metrics.
2. Add route-level tests with mocked session/DB/rate-limit/provider for persistence failure, cross-user isolation, corrections, deletion, group consent, and unauthorized requests.
3. **Phase C design completed; implementation remains gated.** See [`JARA_MEMORY_PRIVACY_DESIGN.md`](./JARA_MEMORY_PRIVACY_DESIGN.md) for repository findings, proposed consent/data/retention controls, acceptance tests, and decisions requiring approval. No schema migration or memory runtime is part of this phase. In particular, the existing global `memoryEnabled: true` flag is not user consent, and normal Jara DM history/provider processing is distinct from long-term memory.
4. Build historical retrieval only after memory controls and consent are in place. Start with deterministic bounded per-user keyword retrieval/recency and compare with a privacy-reviewed semantic index only if measured relevance justifies it. Never send whole histories by default.
5. Add durable task state and a minimal allowlisted tool API only after defining actions and approvals; start with read-only user-authorized retrieval. Each tool needs schema validation, re-auth/resource authorization, timeouts, audit logs, verified return values, and approval gates for writes/external communication. Do not make natural-language/config parsing a tool permission system.
6. Keep model routing on a single selected provider per request until explicit provider choice, privacy labels, supported capabilities, retry/cancellation, and usage telemetry are implemented and tested. Preserve explicit provider failure rather than silent downgrade.
7. Only start real streaming/ASR/TTS when infrastructure, provider contract, consent, cancellation, and end-to-end tests are available.

## Expanded order and implementation gates (2026-11-24)

The full product request is recorded in `JARA_MULTIMODAL_ARCHITECTURE.md`; verified current state, not wish-list completion, is in `JARA_TEST_REPORT.md`.

### Completed in this expanded worktree
- Audited LiveKit routes/group-call behavior and restricted the legacy room-token endpoint to conversation-member access; `end` no longer deletes a room shared by all call participants.
- Replaced SMS signature-presence acceptance with strict Twilio form webhook verification using a fixed HTTPS callback URL, and added unit tests. This secures an inbound callback path only; carrier connectivity/outbound remain absent.
- Wrote open-source stack, deployment, provider configuration, privacy/consent and multimodal architecture documents; identified schema parity problems before attempting a risky memory/SMS migration.
- Made the existing browser-voice text bridge use authenticated persisted Jara DM history rather than browser-supplied history. Voice transcripts and responses now persist as ordinary chat messages and share delete/expiry/schedule visibility. The integration mock verifies visible context is reused, hidden content and spoofed client history do not reach the provider, and both turns are saved. This improves same-thread continuity; it does not add persistent memory or server-side realtime audio.

### Not implemented; dependencies/gates remain
1. Reconcile canonical/SQLite/MySQL Prisma models and raw SQLite DDL, audit migration history and test on disposable SQLite + MySQL before any production schema change.
2. Obtain product/privacy approval for memory consent wording, policy version, categories, retention, exports, backup deletion, provider processing and user controls; then implement consent, owner isolation, review/correction/deletion, retention and retrieval as one release. Do not set consent based on `memoryEnabled`.
3. Select one realtime stack only after a disposable LiveKit Agents vs Pipecat Bengali/audio test with service auth, call-scoped consent, stop/revoke, latency/quality/concurrency targets and resource budget.
4. Implement authorized audio/video channel handling (if separately approved) with no default recording, live indicator, individual/group consent and retention; browser speech and call media are not Jara perception.
5. Secure secret storage and provider-specific SMS configuration; obtain carrier/sender approval; test opt-in, opt-out, signature, idempotency, delivery and approval workflows before outbound delivery.
6. Add semantic retrieval only after data permissions and knowledge/memory separation, with source citations, owner/ACL filtering, deletion propagation and measured relevance.
7. Add general tasks/tools only after an allowlist, typed schemas, fresh server authorization, approval gates, idempotency, durable task state, verification and rollback are implemented.

No provider/model quality or speech benchmark has been run. Do not mark these phases complete based on configs, schemas, UI labels, or candidate repository activity.
