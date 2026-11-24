# Archived documents

These files are kept for history. They describe the project **before** the
remediation described in [`../REMEDIATION_REPORT.md`](../REMEDIATION_REPORT.md)
and must not be used as a description of current behaviour.

| File | Status | Read instead |
| --- | --- | --- |
| `WORKLOG_HISTORY.md` | Historical build log (moved verbatim from the repository root). Records how the app was built, round by round. | `../ARCHITECTURE.md` |
| `AUDIT_INITIAL.md` | Superseded audit. Its findings are the ones the remediation fixed. | `../REMEDIATION_REPORT.md`, [`../../docs/SECURITY_AUDIT.md`](../../docs/SECURITY_AUDIT.md) |
| `AUDIT_FINAL.md` | Superseded. Written before the current fixes landed. | `../REMEDIATION_REPORT.md` |
| `IMPLEMENTATION_AUDIT.md` | Superseded. | `../REMEDIATION_REPORT.md` |
| `E2E_TEST_RESULTS.md` | Superseded. The Playwright suite it describes never actually ran in CI (finding #13). | `../TESTING.md` |
| `DATABASE_ACCEPTANCE_REPORT.md` | Superseded. Describes the hand-maintained runtime that was replaced by generated schema artefacts. | `../ARCHITECTURE.md` |
| `arena-backend-candidate/` | An alternative self-hosted backend that was imported for review and never wired in (its own `IMPORT-STATUS.md` says so). Moved here from the repository root so it is no longer mistaken for the running application; nothing imports it. | `../ARCHITECTURE.md` |

Nothing here is deleted: several of these documents contain design history that
is not recorded anywhere else.
