# Jara Persistent Memory: Privacy and Consent Design

**Status:** Phase C design only. No memory runtime, schema, migration, consent endpoint, UI, retention job, or provider configuration is implemented by this document. This is not a claim of legal compliance. Product/privacy owners must approve the open policy choices before implementation.

## 1. Findings from repository inspection

- `JaraMemory` is present in `prisma/schema.prisma`, `prisma/schema.sqlite.prisma`, and `prisma/schema.mysql.prisma`. It is a minimal `{ id, userId, key, value, createdAt, updatedAt }` key/value table with a unique `(userId, key)` constraint and user index. The Prisma models declare no `User` relation or foreign key.
- The MySQL governance migration creates the same table and indexes but no foreign key. SQLite runtime DDL does add a `User(id) ON DELETE CASCADE` foreign key. The runtime model metadata exposes a `jaraMemory` delegate, but repository-wide application-code search finds no call site that reads, creates, updates, or deletes Jara memories.
- `JaraConfig.memoryEnabled` is defaulted to `true` in config code and schemas. It is only configuration metadata today; it does not activate persistent memory and is not user consent.
- `JaraConsentRecord` and `JaraGroupConsent` are not user-managed personal-memory consent: the general consent API is Super-Admin-only, and group consent is for enabling Jara in a group.
- Jara one-to-one chat messages are already persisted in the general `Message` table. The chat endpoint builds provider context from up to 24 recent messages for that same user/Jara pair. The voice endpoint accepts bounded browser history; the group endpoint uses group messages after group enablement and a Jara mention. These are conversation-context paths, not `JaraMemory` retrieval. `/api/ai/chat` and `/api/jara/voice` accept client-supplied turns without persisted message IDs; they do not query stored message history, so the server cannot classify a caller-supplied string as a copy of a locally deleted message. Treat that as user-submitted input, not server-retrieved history; a stronger guarantee would require server-sourced message IDs/context.
- **Adjacent privacy issue corrected and verified in isolated integration tests:** `Message.deletedFor` is `"everyone"` or comma-separated user IDs, and deletion routes append the user's ID. The previous Jara DM/group context filters recognized only the legacy literal `"me"`; a message hidden from the current user could enter provider context. The correction centralizes visibility parsing and applies it to message history, both deletion APIs, Jara direct/group context, and related retrieval paths without rewriting existing records. Group Jara now resolves the triggering message by persisted `messageId`, verifies it belongs to the group and is visible to the caller, and rejects a hidden trigger before any provider request.
- Therefore, turning off a future long-term-memory feature must not be represented as deleting or disabling ordinary chat history/provider processing. Those separate behaviors need clear disclosures and their own retention/controls. Conversely, existing chat-history persistence must not be treated as opt-in for long-term memory.

## 2. Goals and non-goals

### Goals

1. Save only user-controlled, useful facts or instructions that help continue future conversations.
2. Make long-term memory **off by default** and enable it only through an explicit, informed, revocable user action.
3. Scope every memory operation to the authenticated owner; support view, correction, individual deletion, export, and delete-all.
4. Make consent, source, purpose, and expiry auditable without retaining unnecessary conversation text.
5. Keep normal chat history, group context, approved knowledge sources, and long-term personal memory separate.

### Non-goals for the first version

- No embeddings/vector database, whole-history summarization, automatic cross-user/group memory, or unrestricted model extraction.
- No storing passwords, authentication material, payment/financial account data, government identifiers, precise location, health/biometric data, or other sensitive/high-risk information as memory.
- No actions or decisions about a user based on memory without fresh user instruction and normal authorization.

## 3. Proposed user policy and controls

- Explain in plain language what is remembered, why, how it can influence future answers, whether content is sent to the currently configured model provider, and how to inspect/delete it. Do not imply that AI chat is private from a provider unless the selected provider contract/configuration establishes that.
- Provide a separate, unchecked **“Let Jara remember details for future chats”** control. Consent must be recorded for the authenticated user, with policy version, timestamp, source, and the affirmative action. A global admin `memoryEnabled` switch may disable the feature globally but can never grant consent for a user.
- Keep consent off for existing accounts when this feature launches; do not infer consent from old chats, Jara config, group membership, or provider use.
- Provide a memory center showing each saved item, category, source/date, and expiry, with edit and delete controls plus delete-all and disable-memory actions. Explain that deleting memory does not delete ordinary message history; link to the separate history controls. Support access, correction, export/portability, and erasure requests as applicable, and document any legal retention exceptions.
- Record consent changes and memory create/update/delete/expiry operations using the existing `JaraAuditLog` where its access and retention policy permit. Audit metadata should identify the actor, operation, memory record ID, policy version, timestamp, and outcome, but must never contain memory values, full messages, secrets, or provider prompt contents. Add user-scoped review of consent/audit status where appropriate. If existing audit semantics cannot meet these requirements, document that technical reason before considering a new audit model.
- Revocation takes effect before the next model request: do not retrieve, create, or update memories. Delete all existing memory records for that user as part of the disable flow (or make this consequence explicit and require a distinct user choice if product chooses preservation). The recommended default is immediate purge. Deletion must also invalidate any memory cache and must not be reversed by a later model response.
- Group conversations never create or retrieve personal long-term memories in v1. A group-level opt-in is not individual consent to extract personal memories from shared content.

## 4. Proposed data and write path

### Data model direction (not yet implemented)

Keep `JaraMemory` as the storage concept, but replace unconstrained key/value semantics with validated, reviewable records. Proposed fields:

- `id`, `userId` (required owner FK with cascade delete), `kind` (allowlisted: preference, user_fact, goal_project, communication_preference, retained_instruction, continuation_context), `key`, `value`;
- `source` (user_entered or user_confirmed), optional source message reference only if necessary and privacy-safe;
- `createdAt`, `updatedAt`, `expiresAt`, and optional `lastConfirmedAt`;
- unique owner/category/key and an owner/expiry index.

Prefer the existing `JaraConsentRecord` for versioned `jara_memory` consent history, with a user-scoped self-service API/UI and server-derived `subjectId`; the current Super-Admin-only route is not a suitable user control surface. Add a separate consent model only if a documented constraint in the existing record shape (for example, transactionally enforceable current state or policy-version history) cannot be resolved safely. Extend `JaraMemory` rather than creating a duplicate memory store. Align Prisma schemas, MySQL migration, and SQLite runtime metadata/DDL, including equivalent owner foreign-key and deletion behavior, before enabling the feature.

### Write path

- Accept explicit user requests such as “remember that …” and confirmed suggestions only. Inferred candidates must be shown to the user and require confirmation before persistence; a model-generated summary alone is not confirmation.
- Validate the category and size server-side. Treat source conversation text as untrusted data, reject the sensitive categories listed above, and never store credentials/secrets. Store concise user-approved values, not full transcripts.
- Check current consent on every write. If consent is missing, revoked, or the feature is disabled globally, do not write and do not silently queue a candidate for later.
- Use owner-scoped upsert, and keep the authenticated owner ID server-derived. Never accept `userId` from a client request as authority.

## 5. Retrieval, correction, and retention

- Retrieve only for the signed-in owner and only when both the user consent and global feature flag are active. Add a small hard bound (for example, at most 10 records / 4,000 characters total), with deterministic category/relevance and recency ordering. Do not send all records by default.
- Inject retrieved items into a clearly delimited, server-owned context section that labels them as user-approved context, not system instructions. Current user corrections override memory; let users correct stale items, and do not present memory as verified objective truth.
- Keep v1 retrieval out of group chat. Voice can use personal memory only after the same individual consent and disclosure rules; do not mistake browser-supplied transcript history for consent.
- Set an explicit retention policy before launch. Proposed starting point for product/privacy approval: expire each memory 180 days after its last user confirmation or update, with an in-product review/renewal flow. The expiry must be enforced during reads and by a cleanup job; merely hiding expired rows is insufficient. Define backup deletion windows and operational restore behavior before promising complete deletion.
- Revocation/delete must prevent later retrieval immediately and remove live rows, caches, and derived copies. Ensure deleted message content is not copied into durable memory. Do not claim deletion from backups until the documented backup lifecycle guarantees it.

## 6. Required acceptance tests before launch

1. Default-off for new and existing users; changing global `memoryEnabled` never changes a user's consent.
2. No read/write on missing, revoked, or disabled consent; revoked memory cannot enter provider prompts.
3. Cross-user read, update, delete, and guessed-ID attacks fail; the user ID always comes from the session.
4. User can list, edit, delete one, export, disable-and-purge, and delete all; every operation is owner-scoped and rate-limited.
5. Expired memories are excluded immediately and physically cleaned; user deletion/disable invalidates caches.
6. Group context, another user's messages, system/config text, model-only suggestions, sensitive values, and prompt-injection text cannot become memories without explicit safe user confirmation.
7. Provider prompt construction has a deterministic size cap and includes only the owning user's approved items; prompt-injection content in memory is treated as data.
8. Database behavior is consistent on SQLite and MySQL, including user deletion cascade and migration from the current table. Migration tests must cover the existing unique key and any duplicate/invalid legacy rows before adding constraints.
9. UI copy distinguishes long-term memory from saved chat history and discloses provider processing separately.
10. Before any AI context change is called privacy-safe, regression-test that messages whose comma-separated `deletedFor` contains the requesting user's ID are excluded from Jara DM and group context; test `deletedFor: "everyone"` and legacy values too.

## 7. Decisions required before implementation

- Approve the user-facing consent wording and policy versioning.
- Approve whether v1 requires confirmation for every memory candidate (recommended) and which memory categories are in scope.
- Approve retention (180 days is a proposal, not a current policy), backup lifecycle, export format, and delete-all semantics.
- Confirm provider data handling/retention and the permitted memory fields sent to that provider. Provider/model/usage approval for evaluation remains a separate pending decision.
- Decide the migration strategy for any pre-existing `JaraMemory` rows. Since no runtime writes were found, verify actual deployment data before migration; never silently expose legacy rows as user-approved memory.

**Implementation gate:** do not add a memory schema migration or runtime retrieval until the above decisions are approved and the user-facing controls, owner isolation, revocation/deletion path, retention enforcement, and tests can ship together.

## Expanded audit gate — schema parity (2026-11-24)

Static model inventory during the expanded review found 51 models in canonical `prisma/schema.prisma`, 28 in `prisma/schema.sqlite.prisma`, and 40 in `prisma/schema.mysql.prisma`. Canonical models absent from SQLite include `JaraConsentRecord`, `JaraKnowledgeSource`, SMS, appearance/profile, meeting and donor records (among others). The raw SQLite runtime's model registry and `INIT_SQL` also contain no Jara SMS/consent/knowledge model. MySQL migrations add a subset of omitted tables, not complete canonical parity. `JaraMemory` has no `User` relation/FK in any of the three Prisma model definitions, while the raw SQLite DDL does declare a foreign key. These differences must be reconciled—not assumed equivalent—before a consent/memory migration or production feature flag.

No schema/model/migration/runtime memory change was made in this expanded work. The static count is inventory only; Prisma engine validation was blocked by the sandbox's inability to fetch `binaries.prisma.sh`, and no disposable MySQL execution was available.
