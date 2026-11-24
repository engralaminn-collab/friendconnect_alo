# Jara privacy and consent status

**Date:** 2026-11-24 UTC
**Status:** current-state disclosure and launch gates; not legal advice or an approved policy. No consent language is approved by this code audit.

## Existing data channels are distinct

- **Normal chat history:** Jara DM turns are persisted as ordinary FriendConnect messages. Text and voice now share this same authenticated Jara DM context; voice transcripts and replies are saved as ordinary chat messages, while client-supplied history is ignored. The prior privacy correction applies per-user deleted visibility, expiry, scheduled-message eligibility, and bounded authenticated-user context. Disabling a prospective memory feature must not delete this history or be described as doing so.
- **Provider processing:** the current text route may send the bounded conversation context and latest prompt to whichever server-side text adapter is configured by environment precedence. No provider was contacted in this work. User-facing provider disclosures, provider contract/retention, and regional processing are not established here.
- **Long-term personal memory:** no runtime JaraMemory read/write or user control was found. The schema/table and `memoryEnabled: true` configuration do not indicate a user's affirmative consent. Do not infer permission from chat usage, an existing account, an admin toggle, a group toggle, or model-suggested memory.
- **Group AI:** group interaction is distinct from private DM and uses explicit group consent plus a persisted visible trigger message in the current route. Group consent does not imply every participant has consented to personal memory, audio listening, or recording.
- **Voice/media:** the voice UI now presents a disclosure and requires a separate Continue action before requesting microphone permission. The notice explains that browser speech handling varies, the recognized transcript and visible Jara chat context may be processed by the configured text provider, and transcript/reply are saved as ordinary messages. This opt-in applies to that browser voice session only; it is not consent for continuous server listening, recording, or camera analysis. There is no verified Jara realtime media agent or camera-understanding route.
- **SMS:** inbound only and only after strict Twilio verification is accepted in code; still no carrier account, outbound sending, opt-in compliance, encryption-at-rest or production webhook configuration. SMS config is not evidence of consent to any other channel.
- **Approved knowledge:** an admin-approved source is not a user's conversation and cannot authorize retrieving private messages or personal memories.

## Consent contract required before persistent memory

The recommended design is in [`JARA_MEMORY_PRIVACY_DESIGN.md`](./JARA_MEMORY_PRIVACY_DESIGN.md); it remains unimplemented. Minimum launch conditions:

1. Separate, clear, unchecked user opt-in for a specified memory purpose, categories, provider processing, retention and effect on future answers. Store policy version, actor, affirmative source and timestamp from authenticated server context.
2. Consent defaults off for existing and new accounts. Global administrator disable is a kill switch, never user consent.
3. Per-user inspect/list, edit/correct, per-item erase, export, disable-and-purge/delete-all, and distinct normal-chat-history controls. Explain backup/deletion timelines truthfully.
4. Owner-scoped queries with server-derived `userId`; no cross-account access by guessed IDs; audit metadata without sensitive values or prompt text.
5. Explicit retention/expiry enforced on retrieval and cleanup; revocation stops future retrieval before a subsequent provider request and invalidates caches/derived indexes.
6. Personal memory stays out of group chat. Only user-entered or user-confirmed safe details are eligible. Model-only inference, group content, sensitive data, secrets and deleted messages are excluded.
7. Migration parity across SQLite runtime, SQLite Prisma, MySQL Prisma and migrations, with review of existing rows and deletion behavior before activation.
8. Privacy/security review and tests for access, correction, deletion, export, retention, provider transfer and failure/revocation races.

No persistent-memory runtime/schema migration was added. Policy details such as retention days, allowed categories, provider use, backup purge and legal exceptions remain unresolved. No retention duration in the design document should be read as approved policy.

## Camera, audio, and group consent gates

Before Jara joins a call or consumes media, disclose AI participation and precise modalities; acquire affirmative consent for the relevant call participants and jurisdiction; show persistent live state and stop control; default recording off; scope room subscription to only necessary tracks; define content/transcript retention; honor withdrawal promptly; and test that non-consenting members can still use the ordinary call without the agent. Do not infer consent from microphone/camera browser permission or from group membership.

## SMS gates

Get opt-in tied to the sending purpose and number, maintain durable STOP/UNSUBSCRIBE suppression, use approved sender IDs/templates and country/provider restrictions, obtain legal/provider approval for Bangladesh and recipient jurisdictions, rate-limit, require human approval for consequential/outbound messages as configured, and provide support/escalation. Cryptographic webhook verification protects callback authenticity; it is not recipient consent. Existing `webhookSecret` field is not a production secret manager.

## User-facing wording requirements

Use plain language stating whether the user is chatting with AI, what the assistant can access now, which provider processes the request, whether content is retained, and how to stop/revoke/delete. Avoid “private,” “secure,” “real-time,” “remembers,” or “deleted everywhere” claims unless implementation and provider/backup behavior prove each claim. Label current voice as browser-dependent. A blocked/failed provider request should be described as failed, not passed off as an AI result.

## Review boundary

This document reports source state and minimum engineering safeguards, not a jurisdiction-specific legal determination. Privacy counsel/product owner must approve notices, consent scope, data processing terms, retention, children/minor handling, cross-border transfers, carrier compliance, and deletion exceptions before real users or data are enabled.
