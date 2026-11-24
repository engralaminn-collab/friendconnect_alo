# Jara provider configuration — inventory and safe setup

**Reviewed:** 2026-11-24 UTC. This file names settings only; it contains no credentials. Presence of an environment variable, database field, UI selection or `configured` label does not prove endpoint availability or a working modality.

## Text completion (implemented adapters; live status untested)

`src/lib/ai.ts` currently selects a configured adapter by fixed environment precedence, not the `JaraConfig.llmProvider` preference:

| Adapter | Environment names observed | Current behavior |
|---|---|---|
| Ollama | `OLLAMA_URL`, `OLLAMA_MODEL` | Local HTTP chat-completion-style adapter; endpoint/model not probed |
| Z.ai SDK | `ZAI_API_KEY` | SDK completion path; explicit model/cancellation behavior not verified |
| OpenRouter | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | HTTP chat completion; live request not made |
| Hugging Face | `HUGGINGFACE_API_KEY`, `HF_MODEL` | Role-prefixed text request; endpoint/model compatibility not tested |
| OpenAI-compatible HTTP | `OPENAI_BASE_URL`, `AI_MODEL`, `OPENAI_API_KEY` or `AI_API_KEY` | HTTP chat completion; live request not made |

Adapter selection is server-side. Failures do not silently route a prompt to another provider. Choose one test provider intentionally, use a disposable test credential in the deployment secret manager, restrict outbound networking, set usage limits, and test with synthetic data. Do not enable live evaluator mode without explicit provider/model and data-transfer approval. Do not put secrets in public `NEXT_PUBLIC_*` variables, docs, issue reports, or the Jara database config.

## Voice/audio

Environment names recognized for capability metadata include `JARA_ASR_URL`, `WHISPER_URL`, `FASTER_WHISPER_URL`, `JARA_TTS_URL`, `PIPER_URL`, and `ORPHEUS_URL`. Current source does not implement server ASR/TTS calls at those URLs; `src/lib/jara-voice.ts` only reports configured signals. Jara voice UI uses browser speech APIs; `/api/jara/voice` forwards transcript text to the configured text LLM. Setting one of these variables is **not** an integration and must not be represented as server voice/realtime.

Before implementing an endpoint, define HTTPS/internal network trust, authentication, input-size/audio codec limits, maximum duration, language, model/version, timeouts, cancellation, retention, data residency, result schema, errors, benchmark and abuse controls. Never accept arbitrary client-supplied model URLs (SSRF risk).

## LiveKit group calls

Server-side names: `LIVEKIT_URL`, optional `NEXT_PUBLIC_LIVEKIT_URL` compatibility, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`. Keep key/secret private; URL is a public websocket destination only when deliberately exposed. Group call token code checks conversation membership. The legacy generic token endpoint is now limited to `fc-<conversationId>` and checks conversation membership. These routes provide room token mechanics, not Jara agent subscriptions or visual/audio analysis. LiveKit server connectivity and browser media have not been tested in this sandbox.

## SMS webhook

The inbound route requires all of: persisted SMS config enabled, inbound enabled, provider `twilio`, non-empty `webhookSecret`, `JARA_SMS_PUBLIC_WEBHOOK_URL` set to the exact externally configured HTTPS callback URL, form-encoded provider request, and a valid `X-Twilio-Signature`. The verifier checks HMAC-SHA1 in constant time against sorted form key/value pairs and that fixed public URL. Do not rely on proxy-derived `Host`/`X-Forwarded-*` values. Other provider signature formats and JSON payloads intentionally fail closed.

`webhookSecret` is expected to be the Twilio account auth token, stored in the existing DB config field. That field is not an encrypted secret store; do not enable production SMS on this basis. Before production, migrate to secret-manager-backed credentials, test canonical URL behavior through the actual proxy, replay/idempotency, request size/rate limits, tenant/contact scope, opt-out persistence and provider-specific signatures. No outbound send adapter or actual delivery is implemented.

## Environment policy and verification

- Keep development, CI, staging and production credentials separate; least privilege and rotate through secret manager.
- Record the chosen provider, model/version, region, data policy, purpose and approval in deployment governance—not the raw key.
- Default to no-provider/no-call if missing, disabled, out of budget or unhealthy. Do not send real personal or group data until terms and consent cover that provider.
- Health checks should report readiness only after authenticated low-cost probes; existing metadata routes/config labels are not provider health probes.
- Provider-backed quality, latency, Bengali/Banglish accuracy, cost, concurrency and failover are **NOT TESTED**; the evaluation baseline remains `NOT_RUN` with 0 model calls.
