# AI identity and permissions — status

Status as of 2026-11-28 (branch `arena/2b2a87d0-friendconnect-alo`, `b6248b6`).

| Item | Status |
|---|---|
| Jara as the existing permanent AI user (`jara-ai-system-001`, non-loginable) | Implemented (pre-existing, see `JARA_ARCHITECTURE.md`) |
| `src/lib/ai-identity.ts` policy functions (status, scopes, human ceiling) | Implemented as pure code with unit tests. **Not wired** to any route, model, or socket event. |
| Enforcement on the live Jara responder | **Not implemented.** |
| Suspended AI stops acting immediately | **Not implemented** (no runtime enforcement path). |
| Explicit invitation and approval for AI participation in groups and calls | Group consent exists (`/api/jara/group/consent`). Call participation does not exist. |

Not verified: anything in the "Not implemented" rows. Do not describe these as complete.
