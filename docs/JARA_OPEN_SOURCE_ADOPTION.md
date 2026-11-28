# Jara — Open-source adoption review (Jarvis-AI topic + requested orgs)

**Reviewed:** 2026-11-27 UTC. All repository facts (stars, license, push activity) were
checked against the GitHub API on that date. This document is an evaluation and a record
of what was actually changed — it is not a promise that any listed project is deployed,
endorsed, or compatible with Jara's governance model.

**Intended audience:** Jara maintainers and the owner/Super Admin. Pair this with
`JARA_OPEN_SOURCE_STACK.md`, `JARA_OPEN_SOURCE_LICENSE_AND_COMPATIBILITY.md` and
`JARA_DEPENDENCY_INVENTORY.md`.

## 1. What was requested

1. Check <https://github.com/topics/jarvis-ai>.
2. "Must be add for Jara", from these orgs:
   `NYLLON-SOFTWARE`, `LibreChat-AI`, `open-webui`, `BerriAI`, `temporalio`, `SWE-agent`,
   `jarves`, `MeiGen-AI`.

Interpretation (recorded): research what those projects do, identify which capabilities
are genuinely useful to FriendConnect/Jara **without breaking Jara's governance model**
(proposal → approval flow, audit log, group consent, honest capability labels), and add
what can be added safely as code. Capabilities that require external GPU/LLM/agent
infrastructure, sandboxed code execution, or legal review are documented here as
explicitly deferred rather than half-integrated.

## 2. The `jarvis-ai` topic — what it actually is

The topic is dominated by single-author Python desktop voice-assistant demos (typical:
MIT license, tens-to-thousands of stars, Windows/macOS focus, no multi-user governance).
Common capability themes across the top entries:

| Capability theme | Example repos (stars, license) | Jara status before this change | Jara status now |
|---|---|---|---|
| Voice I/O (wake word, STT, TTS) | `GauravSingh9356/J.A.R.V.I.S` 1506★ MIT; `akshayaggarwal99/jarvis-ai-assistant` 677★ MIT; `JoelShine/JARVIS-AI-ASSISTANT` 109★ MIT | Browser Web Speech fallback; self-hosted ASR/TTS via `JARA_ASR_URL`/`JARA_TTS_URL` env boundary (`jara-voice.ts`); not live in this sandbox | Unchanged (already the honest ceiling) |
| Web search / Wikipedia | `Avinashb722/jarvis-ai-assistant` 146★; `rajkishorbgp/JARVIS-AI-Assistant` 65★ | None | **Added** — `web_search` tool (SearXNG or Brave, fail-closed when unconfigured) |
| Weather reporting | `Arbazkhan4712/JARVIS-AI` 94★; many others | None | **Added** — `weather` tool (Open-Meteo, no key, fail-honest on network error) |
| Todo / reminders | `GauravSingh9356/J.A.R.V.I.S`; `kishanrajput23/Jarvis-Desktop-Voice-Assistant` 1099★ | None | **Partial** — user-scoped memory notes via `remember`/`recall_memory`; scheduled reminders remain **deferred** (needs a consented scheduler; nothing is faked) |
| PC control / automation | `BolisettySujith/J.A.R.V.I.S` 393★; `kishanrajput23` 1099★ | None (deliberately) | **Rejected** — arbitrary device control has no place in a server-side social app without a dedicated, consented device agent |
| Music / media playback | most demo assistants | Media flows exist (calls/meetings/renderer) | Unchanged |
| Email send | `GauravSingh9356/J.A.R.V.I.S` | Email is an auth/OTP subsystem only | **Deferred** — sending user email from Jara needs its own consent + scope review |
| Image generation / "full app" assistant | `aftabrehan/jarvis-ai` 46★ (Next.js SaaS) | None | **Deferred** — out of scope; asset pipeline exists for avatars |
| Talking "HUD"/avatar | `eadmin2/jarvis_ai` 216★ | Browser canvas avatar + GPU renderer boundary | Unchanged + MeiGen path documented below |

Takeaway: the topic adds the **shape** of a JARVIS assistant (voice-first, tools,
ambient), which Jara already targets. The genuinely missing Jara capabilities were the
read-only tools and a durable job record — both are what this change adds.

## 3. Org-by-org review

### 3.1 NYLLON-SOFTWARE

| Repo | Stars | License | What it is | Verdict |
|---|---|---|---|---|
| `SignuDoc` | 3386★ | MIT | Open-source document signature platform (DocuSign alternative) | **Deferred / not a fit** — a whole platform, not a component; Jara/FriendConnect has document flows (proposals, consents) but adopting e-signature needs legal review, its own service boundary and threat model. Not embedded. |
| `ember-cloudflare` | 1355★ | MIT | Slack/Campfire-style chat on Cloudflare Workers | **Rejected** — Jara is an in-app assistant, not a separate chat product; one-click Cloudflare deploy model doesn't map. |
| `ascii-engine`, `fox`, `indexx` | 2–23★ | none/NOASSERTION | Niche projects | **Rejected** — no Jara use case; `fox` (Joplin fork) is an unrelated note-taking product. |

### 3.2 LibreChat-AI (`LibreChat` 47,585★ MIT — studied actively; `code-interpreter` 167★ Apache-2.0; `rag-api` 928★ MIT; `agents` 74★ MIT)

| Capability in LibreChat | Jara verdict |
|---|---|
| **Agents + tool calling** | **Adopted pattern (constrained)** — new built-in tool registry (`src/lib/jara-tools.ts`), OpenAPI-style descriptors, allow-listed read-only tools, authenticated execution via `/api/jara/tools/run`, audit-logged, no self-authorization by Jara chat. Open-ended agent autonomy stays out until consent + policy land. |
| **RAG (`rag-api`)** | **Adopted pattern (lite)** — approved-knowledge retrieval (`src/lib/jara-knowledge.ts`): BM25 lexical ranking over `JaraKnowledgeSource` rows where `status='approved' AND isApproved=true`. No pgvector/Postgres dependency introduced; the function boundary is where a real RAG backend can slot in later. |
| **MCP support** | **Deferred with design note** — `open-webui/mcpo`-compatible MCP-to-OpenAPI endpoints can later be adapted as *additional allow-listed tools*; arbitrary MCP server execution is not exposed to Jara chat. Requires per-tool policy + audit + consent review first. |
| **Code Interpreter (`code-interpreter`)** | **Deferred — do not enable by default.** Sandboxed code execution for a social-messaging assistant is high-risk (abuse, cost, data exfiltration). Needs: network-isolated sandbox, egress policy, per-call approval, quotas, abuse monitoring. Not integrated. |
| **OpenAPI Actions** | Pattern noted in tool descriptors (`inputSchema` fields). Not a spec-compliant OpenAPI ingestor yet — deliberate, to avoid "point it at any URL" SSRF. |
| **Artifacts, message search, multi-user auth** | FriendConnect already covers search/auth; artifact/canvas rendering deferred. |

### 3.3 open-webui (`open-webui` 159,688★ NOASSERTION (open-webui license); `pipelines` 2445★ MIT; `mcpo` 4431★ MIT; `oikb` 432★ MIT; `open-terminal` 3664★ MIT; `computer` 771★ NOASSERTION)

| Capability | Jara verdict |
|---|---|
| **Pipelines (UI-agnostic plugin framework)** | **Adopted as design reference** — Jara tools are the analogous plugin seam: server-side registry + OpenAI-compatible endpoints. Embedding the Python Pipelines runtime is rejected; Jara must stay inside the Next.js/TypeScript system of record. |
| **Tools / functions** | **Adopted** — see LibreChat section; same registry. |
| **Knowledge Bases + `oikb` sync** | **Adopted pattern** — retrieval over approved `JaraKnowledgeSource` (see above). `oikb`'s "sync anything into a KB" is exactly the wrong default for Jara without approval gates; sources remain Super-Admin-approved only. |
| **`mcpo` (MCP→OpenAPI proxy)** | **Deferred with design note** — viable path to expose allow-listed MCP tools later behind the same registry; not wired today. |
| **Open WebUI itself (UI)** | **Rejected** — FriendConnect is the product UI; a second chat UI would fork identity, consent and moderation surfaces. |
| **`open-terminal` (remote machine API)** | **Rejected for Jara** — remote machine control contradicts least-privilege; would need owner-signed, per-session consent and isolation that does not exist today. |

### 3.4 BerriAI (`litellm` 64,027★ NOASSERTION (LiteLLM license — verify before commercial redistribution); `agentchat` 161★ MIT; `litellm-pgvector` 93★ MIT; `moyai` 353★ MIT)

| Capability | Jara verdict |
|---|---|
| **LiteLLM AI gateway** (100+ providers, cost tracking, guardrails, load balancing, budgets) | **Adopted (adapter + boundary, not vendored code)** — `src/lib/ai.ts` now supports `LITELLM_URL` (+ optional `LITELLM_API_KEY` / `LITELLM_MODEL`) as a first-class provider slot (checked after Ollama). Jara talks to a self-hosted LiteLLM proxy exactly like OpenAI-compatible APIs; cost tracking/load balancing live in the proxy, not in-repo. Failover policy stays "no cross-provider fallback" — a configured proxy may implement its own routing/fallback internally; that is the operator's explicit choice. |
| **LiteLLM-style guardrails** | **Adopted** — `src/lib/jara-guardrails.ts`: secret-shaped prompts (PEM keys, AWS/OpenAI/Anthropic/GitHub/Slack/Twilio tokens, inline passwords) are rejected **before any provider call**. Injection phrasing is reported, not blocked. On by default; `JARA_AI_GUARDRAILS=off` disables (not recommended). |
| **`agentchat`** (unified Slack/Discord/Teams/email agent SDK) | **Deferred** — Jara already answers inside FriendConnect (in-app + SMS boundary with Twilio-signed webhooks). Cross-channel fan-out needs channel-by-channel consent; SMS path is the pattern. |
| **`moyai` (self-hosted coding agent)** | **Rejected for Jara** — coding agents are out of Jara's product scope; see SWE-agent below. |

### 3.5 temporalio (`temporal` 24,637★ MIT; `sdk-typescript` 953★ MIT; `ui` 452★ MIT; `sdk-go` 1002★ MIT)

| Capability | Jara verdict |
|---|---|
| **Durable execution for long-running business processes** | **Adopted pattern, minimal implementation** — Jara's avatar renders and future batch work need "job survives restart, retries with backoff, idempotent enqueue, human-cancellable". Rather than stand up Temporal server + workers in one change, this adds a durable `JaraJob` registry (Prisma model + `src/lib/jara-jobs.ts` + `GET/PATCH /api/jara/jobs[...]`), with exponential backoff, idempotency keys, explicit claim/transition rules and a real call site (GPU avatar render dispatch). **If the org approves Temporal, this table becomes the outbox/staging layer in front of it** — the call sites do not change shape. |
| **Temporal service itself** | **Deferred (recommended for scale, not faked now)** — requires a running Temporal server, worker processes, and an operations story (UI, namespaces, retention). Right answer for Billing/SMS-batch/render farms at volume; overkill as an untested dev-dependency today. No `temporalio` npm package was added — unlike the Python demos, this dependency is only meaningful with a live cluster. |

### 3.6 SWE-agent (`SWE-agent` 20,883★ MIT; `mini-swe-agent` 10,143★ MIT; `SWE-ReX` 663★ MIT)

| Capability | Jara verdict |
|---|---|
| **Autonomous issue-fixing agent** | **Rejected for Jara** — Jara is a social-platform assistant; an agent that edits repositories is a developer tool, not a friend in chat. Enabling it would pierce every trust boundary Jara enforces (no shell, no fs, no repo access from chat). |
| **`mini-swe-agent` / `SWE-ReX` sandboxed execution** | **Deferred** — the *pattern* (isolated, disposable execution sandbox) is the right reference for the deferred LibreChat Code Interpreter decision above. Do not integrate without a signed proposal: egress allow-list, per-session approval, resource quotas, audit, and a kill switch. |

### 3.7 jarves (`jarves` 335★ NOASSERTION (alpha Symfony PHP CMS); `jarves-standard` 7★ MIT)

| Capability | Jara verdict |
|---|---|
| Symfony-based CMS/framework | **Rejected — wrong stack and wrong problem.** Jara lives inside Next.js + Prisma; nothing in `jarves` maps to Jara or FriendConnect. Noted and closed; no code added. (If the asker meant the "Jarvis" voice assistant org, that is covered by §2.) |

### 3.8 MeiGen-AI (`InfiniteTalk` 8,488★ Apache-2.0; `MultiTalk` 3,042★ Apache-2.0; `LongCat-Video-Avatar` 492★; `X-Cut` 36★ AGPL-3.0; `PosterCraft` 1,029★ NOASSERTION)

| Capability | Jara verdict |
|---|---|
| **InfiniteTalk** — unlimited-length audio-driven talking-head video | **Documented + env-hooked, not vendored** — Jara already has an honest GPU-renderer boundary (`JARA_GPU_WORKER_URL`, `isApproved` render flow, browser fallback otherwise). `submitAvatarRenderJob()` posts `{ script, referenceImageUrl, voiceSampleUrl, … }` to that worker, and render jobs now also enqueue a durable `avatar_render` `JaraJob`. MeiGen InfiniteTalk (Apache-2.0) is the reference open-source worker to deploy behind that URL; `.env.example` now names it. License is permissive; model weights are pulled separately by the operator — check each weight's license before production use, and keep GPU compute off FriendConnect's app servers. |
| **MultiTalk** — multi-person conversational talking video (NeurIPS 2025) | **Documented, same boundary** — correct backend for meeting-room-style multi-speaker avatar renders when self-hosted; not wired to meeting creation (GPU cost + consent of all participants required). |
| **PosterCraft / LongCat-Video-Avatar** | **Deferred** — poster/world-model generation is not a Jara capability; asset tools (JaraAsset + approval) already gate any future design-asset generation. |
| **X-Cut (AGPL-3.0 chat-driven video editing)** | **Rejected** — AGPL obligations not acceptable inside the proprietary product; and out of scope. |

## 4. What this change actually adds (code)

All changes are additive; no governance gate was loosened, Jara still cannot self-approve,
and every network-egress surface fails closed when unconfigured.

1. **AI gateway (BerriAI)** — `LITELLM_URL`/`LITELLM_API_KEY`/`LITELLM_MODEL` provider slot
   (after Ollama, before Z.ai) in `src/lib/ai.ts`; honest provider reporting in
   `getAIProvider()`/`getAvailableModels()`/`getAIStatus()`.
2. **Input guardrails (LiteLLM-style)** — `src/lib/jara-guardrails.ts`; `aiChat()` rejects
   secret-shaped prompts before any provider call (`AIInputRejectedError`); `/api/jara/chat`
   maps that to HTTP 400 with a safe message instead of a fake "unavailable" reply;
   toggle with `JARA_AI_GUARDRAILS=off` (default on).
3. **Tool registry (LibreChat/Open WebUI pattern)** — `src/lib/jara-tools.ts` +
   `GET /api/jara/tools` + `POST /api/jara/tools/run`. Tools: `get_time`, `calculate`
   (no eval; parser-based), `search_knowledge` (approved sources only), `web_search`
   (SearXNG via `JARA_SEARCH_URL` or Brave via `JARA_BRAVE_API_KEY`; else `unconfigured`),
   `weather` (Open-Meteo, no key), `remember`/`recall_memory` (user-scoped JaraMemory).
   Read-only, no code execution, no arbitrary URLs, every run audit-logged (`tool_call`).
4. **Approved-knowledge RAG-lite (LibreChat rag-api / Open WebUI KB pattern)** —
   `src/lib/jara-knowledge.ts`: BM25 ranking, snippet windows, approved-only filter,
   no embeddings/deps; swappable for a real vector store later.
5. **Durable jobs (Temporal pattern)** — `JaraJob` Prisma model (additive migration
   `20261124000000_complete_jara_tables` regenerated), `src/lib/jara-jobs.ts`
   (enqueue/claim/complete/fail/cancel/list/stats, exponential backoff ≤30 min,
   idempotency keys, explicit transitions), `GET /api/jara/jobs` +
   `PATCH /api/jara/jobs/:id` (Super Admin; cancel only), and `avatar_render` jobs
   enqueued on successful GPU-worker dispatch.
6. **Surface area** — `/api/jara/health` now reports tool registry + guardrails status;
   Jara Command Center (Super Admin) reports tools + jobs modules;
   `.env.example` documents every new variable.
7. **Tests** — `tests/jara/tools.test.ts` (13 cases), `tests/ai/ai-guardrails.test.ts`;
   full unit suite green (51/51 at time of writing), security suite green (42/42),
   `tsc --noEmit` clean, `schema:check` clean, ESLint clean on changed files.

## 5. Explicitly not done (and why)

- No dependency from any listed org was added to `package.json`. Everything new is
  first-party TypeScript over existing infrastructure; the external systems (LiteLLM
  proxy, SearXNG, InfiniteTalk worker, Temporal) are operator-deployed services.
- No shell/code execution tool (SWE-agent / LibreChat code-interpreter) — pending
  signed proposal: sandboxing, egress allow-list, per-session approval, quotas.
- No vector database — Qdrant/pgvector decision stays gated on the consent/memory review
  already tracked in `JARA_OPEN_SOURCE_STACK.md`.
- No autonomous agent loop — Jara chat does not self-authorize tool calls; a human or an
  authenticated, audited route invokes tools.
- No group/broadcast tool, no email tool, no device control, no wallet/signing tool
  (SignuDoc stays a possible future integration behind legal review).
- Temporal server/workers, Open WebUI, LibreChat, Jarves, Open WebUI Desktop — not
  installed, not vendored, not forked.
- Scheduled reminders/todo timers — need a consented scheduler; memory notes cover the
  "remember this" slice without faking scheduling.

## 6. License notes

- MIT / Apache-2.0 patterns and protocols adopted (design-level): LiteLLM gateway
  boundary, tool registry, durable jobs, approved-RAG shape — no source copied verbatim
  from any listed repo; implementation is original.
- AGPL-3.0 projects (`desktop`, `X-Cut`) — rejected for integration.
- `NOASSERTION` (open-webui, litellm, PosterCraft, jarves) — do not vendor code;
  service-level integration only after license review. LiteLLM is used as an optional
  self-hosted proxy, not as a dependency.
- `none` license repos in the topic/orgs — reference only.

## 7. Operator quick-start (what to set)

```bash
# AI via self-hosted LiteLLM (optional; Ollama stays the zero-dependency default)
LITELLM_URL=http://localhost:4000
LITELLM_API_KEY=...        # optional, depending on proxy config
LITELLM_MODEL=gpt-4o-mini  # model alias configured in the proxy

# Tools
JARA_SEARCH_URL=http://localhost:8888   # SearXNG (self-hosted) — or:
JARA_BRAVE_API_KEY=...                  # Brave Search API
# weather / calculator / time / knowledge / memory need no keys

# Durable jobs: apply the schema, then list via /api/jara/jobs (Super Admin)
npm run db:push                          # dev (SQLite) / prisma migrate deploy for MySQL

# MeiGen InfiniteTalk as Jara's GPU avatar worker (separate deploy, GPU required)
JARA_GPU_WORKER_URL=http://127.0.0.1:8189
JARA_GPU_WORKER_TOKEN=...
```
