# Super Admin coding agent — status

Status as of 2026-11-28 (branch `arena/2b2a87d0-friendconnect-alo`, `b6248b6`).

| Item | Status |
|---|---|
| Private Super Admin channel to Jara for engineering support | **Not implemented.** |
| Server-side Super Admin enforcement for agent tools | **Not implemented.** The existing `/api/jara/tools` registry is read-only and authenticated, and contains no repository or shell tools. |
| Sandboxed workspace, repository allowlist, command allowlist, egress limits | **Not implemented.** |
| Approval gates for commit, push, PR, merge, deploy, migration, secret access | **Not implemented.** |
| Coding-agent candidate review (OpenCode, SWE-agent, Free Claude Code, LibreChat, MCP) | **Not performed at source level.** |

Hard rules that any future implementation must meet: no autonomous deployment, no production `.env` or database credentials in the sandbox, no model self-granted permissions, and no browser-session or token extraction from paid subscriptions.
