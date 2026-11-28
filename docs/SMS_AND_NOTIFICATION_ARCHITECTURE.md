# SMS and notification architecture — status

Status as of 2026-11-28 (branch `arena/2b2a87d0-friendconnect-alo`, `b6248b6`).

| Item | Status |
|---|---|
| In-app messaging and notifications | Implemented (not an SMS gateway). |
| Carrier SMS adapter, consent, opt-out, delivery status, retry | **Not implemented.** |
| Twilio-related code | Present: `src/app/api/jara/sms/send` and `sms/webhook`, with guardrails in `jara-guardrails.ts`. No Twilio SDK is in `package.json`. The webhook has signature checks (per `SECURITY_AUDIT.md`). **Not verified against a live provider.** No authorised test provider is configured here. |
| Paid provider activation | **Not authorised.** Do not activate without explicit approval. |

Do not describe SMS as working until an authorised provider test has been run and recorded.
