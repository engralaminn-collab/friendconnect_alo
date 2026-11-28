# FriendConnect documentation index

Each file below is classified as one of:

- **Current**: describes the code on this branch and is maintained.
- **Current, scoped**: accurate for the topic it covers, but not a whole-system statement.
- **Planned**: describes intended behaviour; the code does not yet exist or is not verified.
- **Historical**: a record of a past state. Do not use it as a description of current behaviour.
- **Superseded**: replaced by a named file. Read the replacement.

The status of a feature is always in the matrix that names it, not in the prose of older reports.

These classifications come from each file's title and from spot checks against the code. They were not produced by reading every file line by line. Where a file contradicts `REMEDIATION_MATRIX.md` or `RELEASE_REPORT.md`, the matrix and the report win.

## Start here

| File | Status | Purpose |
|---|---|---|
| `../README.md` | Current | Repository overview and development modes |
| `REMEDIATION_MATRIX.md` | Current | The 30-finding matrix with per-finding evidence |
| `RELEASE_REPORT.md` | Current | Commands run, results, and blockers for the latest branch |
| `TESTING.md` | Current, scoped | How to run each test suite |
| `SECURITY_AUDIT.md` | Current, scoped | Security audit history. Its scope statements still apply. |
| `FREE_FIRST_ARCHITECTURE.md` | Current | Licence and cost classification of components |
| `INTEGRATION_RESEARCH_MATRIX.md` | Current, partial | Metadata-level review of supplied external repositories |
| `ARCHITECTURE.md` | Current, scoped | Overall architecture |
| `CI_CD_AND_OPERATIONS.md` | Current, scoped | CI pipeline and operations |
| `DEPLOYMENT_AND_RECOVERY.md` | Current, scoped | Deployment and recovery procedure. Not executed against a live host in this session. |

## Feature documents

| File | Status | Notes |
|---|---|---|
| `ai-gateway.md` | Current, scoped | Gateway behaviour as implemented; provider live tests not run |
| `AI_ARCHITECTURE.md` | Current, scoped | |
| `AI_PHASE_PLAN.md` | Planned | Phase plan; several phases are not started |
| `open-source-ai-models.md` | Current, scoped | Model options; no model was benchmarked here |
| `group-calls.md` | Current, scoped | Group call design; real browser and device tests not run |
| `CALL_TEST_PROCEDURE.md` | Current | Manual test procedure |
| `REAL_PHONE_CALL_TEST.md` | Planned | Requires real devices; not performed |
| `e2ee-design.md` | Planned | End-to-end encryption is **not implemented**. Message delivery does not use it. |
| `free-self-hosted-stack.md` | Superseded | Replaced by `FREE_FIRST_ARCHITECTURE.md` |

## Jara (AI assistant) documents

The Jara series contains overlapping audits written on different dates. Read `JARA_ARCHITECTURE.md` and `JARA_TEST_REPORT.md` for the current state.

| File | Status |
|---|---|
| `JARA_ARCHITECTURE.md`, `JARA_MESSAGING_ACCEPTANCE.md`, `JARA_TEST_REPORT.md`, `JARA_TEST_EVIDENCE.md` | Current, scoped |
| `JARA_PRIVACY_AND_CONSENT.md`, `JARA_MEMORY_PRIVACY_DESIGN.md` | Planned (memory is not implemented) |
| `JARA_MULTIMODAL_ARCHITECTURE.md`, `JARA_BANGLA_VOICE_REPORT.md` | Planned or partial |
| `JARA_MASTER_AUDIT.md`, `JARA_MASTER_IMPLEMENTATION_AUDIT.md` | Historical; overlapping. Consolidate with owner review. |
| `JARA_DEPLOYMENT_GUIDE.md`, `JARA_DEPLOYMENT_AND_ROLLBACK.md` | Superseded by `DEPLOYMENT_AND_RECOVERY.md` for deployment steps; confirm with owner |
| `JARA_OPEN_SOURCE_*` (3 files), `JARA_AI_MODELS.md`, `JARA_DEPENDENCY_INVENTORY.md`, `JARA_EXTERNAL_REQUIREMENTS.md`, `JARA_PROVIDER_CONFIGURATION.md` | Current, scoped |

## Remediation history

| File | Status | Replaced by |
|---|---|---|
| `REMEDIATION_EXECUTION_REPORT_2026-11-28.md` | Superseded | `REMEDIATION_MATRIX.md`. It stated the 30-finding list was unavailable; the list is now used directly. |
| `REMEDIATION_REPORT.md` | Historical | `REMEDIATION_MATRIX.md` |
| `FINAL_DELIVERY_REPORT.md` | Historical | `RELEASE_REPORT.md` |
| `API_ACCEPTANCE_MATRIX.md` | Current, scoped | |

## Deployment-specific

| File | Status | Notes |
|---|---|---|
| `DEPLOY_PANEL_ALOLABS.md` | Historical | Names a specific host. No host was contacted in this session. Owner must confirm before use. |
| `DEPLOY_LEARN_ALOEDUCATION.md` | Historical | Same |
| `ENTERPRISE.md` | Planned | |

## Archive

`archive/` contains older audits and worklogs (`AUDIT_INITIAL.md`, `AUDIT_FINAL.md`, `IMPLEMENTATION_AUDIT.md`, `E2E_TEST_RESULTS.md`, `DATABASE_ACCEPTANCE_REPORT.md`, `WORKLOG_HISTORY.md`, and an older candidate backend). Status: **Historical**. Do not use them as evidence for current behaviour.

## Status documents (2026-11-28)

These record what is implemented, partial, blocked, or not started for the AI and communication roadmap. Each names its blockers. None of them claims a feature is complete.

- `AI_IDENTITY_AND_PERMISSIONS.md`
- `VOICE_VIDEO_ARCHITECTURE.md`
- `JARA_LIVE_AVATAR.md`
- `CODING_AGENT_SECURITY.md`
- `DOCUMENT_SHARING_AND_RAG.md`
- `SMS_AND_NOTIFICATION_ARCHITECTURE.md`

The Stage A wiring audit is in `AI_ARCHITECTURE.md`, section "Stage A wiring audit".

