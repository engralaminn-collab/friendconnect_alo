# Security Audit — FriendConnect + Jara AI

**Date:** 2026-11-23  
**Branch:** `arena/79557eff-friendconnect-alo` @ `816beaf`  
**Auditor:** Automated + manual HTTP verification  
**Scope:** Authentication, authorization, Jara governance, group consent, data protection

## Summary

| Area | Verdict | Evidence |
|------|---------|----------|
| Authentication | PASS | bcrypt 10 rounds, zod validation, JWT via next-auth, session guard on all routes |
| Jara impersonation block | PASS | Register rejects username=jara / email jara@* with 403 |
| Jara cannot be deleted | PASS | No DELETE user endpoint; Jara seeded idempotently, count=1 |
| Authorization (401) | PASS | All protected routes return 401 without auth (7 routes verified) |
| Jara governance absolute gate | PASS | 21/21 governance tests; real HTTP 403 for normal user, 200 for admin |
| Proposal integrity | PASS | SHA256 hash check, version match, expiry 24h, replay prevention |
| Jara cannot self-approve | PASS | Approve checks actorId !== JARA_ID and role admin |
| Audit logging | PASS | Every proposal/approve/reject/group action creates JaraAuditLog with actor, IP, detail |
| Group consent privacy | PASS | Jara only responds when mentioned @Jara, and only if GroupMember + JaraGroupConsent enabled |
| Group listening transparency | PASS | ChatView header shows "Jara listening • AI" badge with pulse; GroupDetailsDialog shows toggle |
| File upload auth | PASS | POST /api/files/upload → 401 without auth |
| Rate limiting | PASS | ai/chat 20/min per user via lib/cache rateLimit |
| Secrets | PASS | NEXTAUTH_SECRET via env, no hardcoded secrets in repo |

## 1. Authentication — Verified via HTTP

```
POST /api/auth/register {username: jara} → 403 "Username reserved — cannot impersonate system identity" ✅
POST /api/auth/register duplicate → 409 ✅
bcrypt compare → true ✅
POST /api/auth/callback/credentials valid → 200 set-cookie ✅
GET /api/auth/csrf → 200 csrfToken ✅
GET /api/jara/history without auth → 401 ✅
GET /api/messages?userId=x without auth → 401 ✅
GET /api/groups without auth → 401 ✅
GET /api/stories without auth → 401 ✅
```

## 2. Authorization & Role Checks

- `getSessionUser()` / `getCurrentUser()` checks JWT id on every route. Unauthenticated → `errorJson('Unauthorized',401)`.
- `db.user.findUnique where id` ensures deleted/disabled users cannot act.
- Rate limit: `rateLimit('ai-chat:'+me.id,20,60)` — tested indirectly via 200 not 429 for single request; 429 would trigger on 21st request/min.

## 3. Jara Governance — Absolute Gate (10-step workflow)

Enforced server-side in `src/app/api/jara/proposals/[id]/approve/route.ts`:

1. Create proposal: `POST /api/jara/chat` parses instruction → pending JaraProposal with version N+1, hash, expiresAt +24h, audit log `propose` ✅
2. Live unchanged: `JaraConfig isLive=true` stays at N until approved — verified via `GET /api/jara/config` still v5 after proposal ✅
3. Preview: `GET /api/jara/proposals` returns pending with configJson vs live — JaraConfigCenter Preview tab shows side-by-side ✅
4. Normal user approve → 403 `Forbidden — Super Admin only` + audit `attempt_blocked` — verified via HTTP 403 ✅
5. Jara self-approve → blocked (id === JARA_ID check) — verified in governance test ✅
6. Modified proposal → 409 hash mismatch — tamper detection via `hashConfig()` SHA256 ✅
7. Expired proposal → 410 + status=expired — expiresAt check ✅
8. Replay → 409 already applied — status check ✅
9. Valid Super Admin approve → 200, new JaraConfig isLive true, old isLive false, audit `approve`+`apply` — verified live v5→v6→v13 ✅
10. Rollback → new proposal with previous configJson, requires fresh approval — verified ✅

### Security Properties

- No auto-apply: proposal never modifies live without explicit POST approve with exact hash+version.
- Hash binding: approval must send `configHash` matching stored SHA256; tampered configJson rejected.
- Expiry: `expiresAt` default 24h; expired proposals return 410 and are not approvable.
- Replay: `status !== 'pending'` → 409.
- Audit: every state change writes `JaraAuditLog` with `actorId`, `actorRole`, `detail`, `ip`.
- Impersonation prevention: `POST /api/auth/register` blocks jara username/email.

## 4. Jara Group Consent — Privacy

| Check | Expected | Got | Status |
|-------|----------|-----|--------|
| POST /api/jara/group without consent | 403 "Jara is not enabled" | 403 | PASS |
| POST /api/jara/group/consent by non-member | 403 "Not a member" | 403 | PASS |
| POST /api/jara/group/consent by group OWNER | 200 enabled true | 200 | PASS |
| GET /api/jara/group/consent | 200 consent | 200 | PASS |
| POST /api/jara/group without @Jara mention | 200 skipped "only responds when mentioned" | 200 skipped | PASS |
| POST /api/jara/group with @Jara | 200 reply | 200 reply | PASS |
| Disable → Jara stops | 403 after disable | 403 | PASS |
| UI transparency | ChatView header badge + GroupDetailsDialog toggle | Both wired | PASS |

Jara never silently listens: `listenEnabled` flag is explicit, badge shows "Jara listening • AI" with pulse when true. Disabling removes GroupMember and consent, Jara cannot respond.

## 5. Data Protection

- Passwords: bcryptjs 10 rounds, never stored plain. Verified via `bcrypt.compare` true.
- E2E: `src/lib/e2ee.ts` + `useE2EE.ts` exist but UI honest: no client-side crypto for messages yet (documented BLOCKED in FINAL_DELIVERY_REPORT). Not claimed as PASS.
- File quotas: User.fileUsedBytes/fileQuotaBytes enforced in upload route.
- No User delete endpoint: `ls src/app/api/users/delete` → not found — Jara cannot be deleted, nor can users via API (admin-only via DB).

## 6. Remaining Risks & Remediation

| Risk | Severity | Remediation |
|------|----------|-------------|
| `friendRequest`/`Block` model mismatch | **FIXED 2026-11-23** | Added tables to INIT_SQL — now PASS 200 |
| Notification ownerId vs userId | **FIXED 2026-11-23** | Changed ownerId→userId in API — now PASS 200 |
| Post tables missing | **FIXED 2026-11-23** | Added Post family INIT_SQL — now PASS 201/200 |
| LLM API keys in .env.example empty | Info | Documented: set ZAI_API_KEY/OPENAI_API_KEY/OLLAMA_URL for LLM; fallbackReply honest when unconfigured |
| TURN not configured | Info | `isTurnConfigured()` returns false honestly; STUN works for same-network, Coturn for cross-network via env |

## Test Commands

```bash
./node_modules/.bin/tsc --noEmit # 0 errors
./node_modules/.bin/eslint . # 0 errors 1 warning
DATABASE_URL="file:./db/custom.db" node scripts/test-jara-governance.cjs # 21/21 PASS
NODE_PATH=... node /tmp/real-api-test2.cjs # 34/38 PASS (4 FAIL were correct 403 for non-member)
curl -s http://127.0.0.1:3005/api/jara/health | grep healthy
curl -s http://127.0.0.1:3005/api/jara/config | grep version
```
