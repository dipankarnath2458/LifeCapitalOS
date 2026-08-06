# Security Review — Phase 0

**Date:** 2026-08-06 · **Scope:** the deployed system (API, web, database, deployment configuration)
**Method:** source review of `apps/api`, `apps/web`, `packages/core`, Prisma schema and migrations, CI, and deployment configuration; dependency audit triaged by production reachability.

> **One limit, stated up front.** The review environment's network policy blocks
> `lifecapitalos-api-production.up.railway.app`, so **no live production probing was
> possible**. Everything below is from source and configuration. The live half is delivered
> as [`scripts/verify-deployment.mjs`](../scripts/verify-deployment.mjs), which performs the
> external checks and must be run against production — see §6. **Until it has been run
> against production, the runtime posture is unverified.**

---

## 1. Summary

| Severity | Finding | Status |
| --- | --- | --- |
| **High** | Client IP not resolved behind the proxy — rate limiter shared one global bucket; audit trail recorded the proxy | **Fixed** |
| **Medium** | Swagger published a complete unauthenticated API map in production | **Fixed** (opt-in) |
| **Medium** | `CORS_ORIGINS` silently defaulted to localhost in production | **Fixed** (boot fails) |
| **Medium** | Per-attempt login diagnostics logged account existence and password length | **Fixed** in #41 |
| Low | JWT verification did not pin the signing algorithm | **Fixed** |
| **Medium** | No per-account lockout on repeated failed logins | **Open — recommended** |
| **Medium** | `next@14.2.35` carries unpatched advisories; fixes are in 15.x | **Open — decision needed** |
| Low | Rate limiting is in-memory, so it resets on deploy and is per-instance | Open — accepted for now |
| Low | Password policy is 8 characters + one digit | Open — recommended |

Nothing found indicates a compromise or data exposure. The two most serious items were
**availability and accountability** defects, not data leaks.

---

## 2. What is already right

Worth recording, because it is the reason the list above is short.

- **Money and PII.** Amounts are `BigInt` minor units (no float drift). Household, member and
  entity names and tax IDs are **AES-256-GCM encrypted at the application layer**; the key is
  never in the repo.
- **Database.** Every table has **RLS enabled with no policies**, so only the application's
  role can read or write. The database is on Railway's **private network** and is not
  reachable from the internet.
- **Tenant isolation.** `HouseholdScopeGuard` returns **404, not 403**, for out-of-scope
  resources — it does not confirm that an id exists to someone not entitled to see it.
- **Passwords** are hashed with **argon2**, never logged, never returned.
- **Refresh tokens** are opaque random values (not JWTs), stored **hashed**, and **rotated** on
  use; resetting or changing a password revokes every live session.
- **Account enumeration** is deliberately prevented on `/auth/forgot-password` and
  `/auth/verify-email/request` — identical responses whether or not the account exists.
- **One-time secrets** are returned only under `SANDBOX_RETURN_SECRETS`, which is
  **forced off in production** regardless of the flag, and the boot guard refuses dev secrets
  in production.
- **CORS** is an explicit allowlist plus a regex scoped to *both* the project prefix and the
  Vercel team slug; never `*`, and `credentials: true` is never paired with a wildcard.
- **Input validation** is a global `ValidationPipe` with `whitelist: true`, so unknown
  properties are stripped rather than passed through to Prisma.

---

## 3. Findings fixed in this review

### 3.1 Client IP was the proxy's, not the client's — **High**

`req.ip` is used by two things: the rate limiter's bucket key, and the audit trail's `ip`
column. Express only derives the real client from `X-Forwarded-For` when told how many proxy
hops to trust, and **`trust proxy` was never set**. The API runs behind Railway's edge, so:

- **The rate limiter bucketed every client in the world into one 120/min allowance.** That is
  worse than no limit: one noisy client throttles everyone, and an attacker's traffic is
  indistinguishable from legitimate traffic.
- **Every audited mutation** (firm create/update, membership changes, household net-worth
  writes) **recorded the proxy's address**, destroying the forensic value of the `ip` column.

**Fix:** `trust proxy` is now set from `TRUST_PROXY_HOPS` (default `1`). Proven from both
directions in `apps/api/test/trust-proxy.e2e-spec.ts`: with a trusted hop the audit row
records the client address; with `0` it ignores `X-Forwarded-For`, so a directly-exposed
deployment cannot be spoofed.

**Operational note:** trusting a hop means trusting that hop to set `X-Forwarded-For`. That
holds on Railway, where traffic cannot bypass the edge. If the process is ever exposed
directly, set `TRUST_PROXY_HOPS=0`.

### 3.2 Swagger published the whole API surface in production — **Medium**

`SwaggerModule.setup('api/docs', …)` ran unconditionally, so `/api/docs` and its JSON served
a complete, unauthenticated inventory of every endpoint, parameter and schema — including
admin routes. Not a vulnerability by itself; it removes all reconnaissance cost from finding
one.

**Fix:** gated behind `SWAGGER_ENABLED`. On by default outside production, **off by default
in production**, and re-enabled deliberately when needed. `docs/DEPLOYMENT.md` §7 records how.

### 3.3 `CORS_ORIGINS` silently defaulted to localhost — **Medium**

`CORS_ORIGINS` fell back to `http://localhost:3000` rather than to empty. A production deploy
with the variable unset therefore **booted, passed its health check, and rejected every real
browser** — which is precisely how this deployment lost logins twice.

**Fix:** `assertProductionConfig` now refuses to start in production when the allowlist is
empty or still only the localhost default, and reports every misconfiguration at once rather
than one per restart.

### 3.4 Login diagnostics leaked account state — **Medium** (fixed in #41)

`AuthService.login` carried logging marked *"TEMPORARY — remove after production auth
diagnosis"*, still running on every attempt and recording account existence, account status
and the submitted password's length. The password itself was never logged, but it made the
log an account-enumeration oracle for anyone able to read it. Removed.

### 3.5 JWT algorithm was not pinned — **Low**

`passport-jwt` was configured without `algorithms`, so verification accepted whatever the
token header claimed. With a symmetric secret the practical attack surface is small, but
pinning is free and removes the whole algorithm-confusion class. Now `['HS256']`, matching
what `issueTokens` signs.

---

## 4. Open findings and recommendations

### 4.1 No per-account lockout on failed logins — **Medium, recommended next**

The global limit is 120 requests/min/IP (now correctly per-client). One-time codes have a
tight per-target throttle (3 per 15 min), but **`/auth/login` has no per-account control**, so
a distributed attempt against a single known address is not slowed by anything account-scoped.

**Recommendation:** track consecutive failures per account and apply an increasing delay or
short lock, with the counter cleared on success. Deliberately *not* bundled into this PR: it
needs a schema field and its own tests, and a per-IP throttle tight enough to matter would
break the e2e suites, which run ~50 auth calls from one address in under a minute. Making
that trade quietly would be the wrong call.

### 4.2 `next@14.2.35` — **Medium, needs a decision**

Production dependency audit: **16 high, 22 moderate**. Triaged:

| Package | Reachable? | Assessment |
| --- | --- | --- |
| `next` | **Yes** | The bulk of the findings. Fixes are in **15.5.21**; no 14.x patch line covers them. |
| `multer` (via `@nestjs/platform-express`) | **No** | Grep confirms **no `FileInterceptor`, no `@UploadedFile`, no upload route.** The DoS advisories need a multipart endpoint. Not reachable. |
| `lodash` (via `@nestjs/config`) | Not as described | `_.template` code injection requires calling `_.template` with attacker input; `@nestjs/config` does not. |
| `js-yaml` (via `@nestjs/swagger`) | Reduced | Parses our own spec, not user input — and Swagger is now off in production. |
| `postcss`, `vite`, `esbuild`, `webpack`, `vitest`, `glob` | **No** | Build/dev-time only; not in the deployed runtime. |

Several Next advisories are specific to **self-hosted** deployments (Image Optimizer DoS,
middleware bypass, cache poisoning) and this app is on **Vercel**, which patches its own edge.
That lowers but does not eliminate exposure.

**Recommendation:** treat **Next 14 → 15** as its own milestone with its own PR and a full
smoke run — it is a major version with App Router and React version implications, and
attempting it inside a security-fix PR would put a risky migration on the critical path.

### 4.3 Rate limiting is in-memory — Low

Per-instance and reset on every deploy. Acceptable at one instance; revisit when the API
scales horizontally (`REDIS_URL` is already set in Railway but **no code uses Redis**).

### 4.4 Password policy — Low

Minimum 8 characters with one digit, no check against known-breached passwords. Reasonable
for launch; consider a breached-password check (k-anonymity range query) before wide release.

---

## 5. Deployment verification — **not yet performed against production**

The checks below could not be run from the review environment. `scripts/verify-deployment.mjs`
performs them; it is read-only and sends no request that creates data or email.

```bash
node scripts/verify-deployment.mjs \
  --api https://lifecapitalos-api-production.up.railway.app \
  --web https://lifecapitalos.com
```

It checks: health and database reachability; the security headers; that a preflight from the
real web origin returns 204 **with** the matching `Access-Control-Allow-Origin`; that an
unlisted origin gets 204 **without** one and **never a 404** (the exact Safari failure);
that Swagger is not exposed; that `/login` and `/forgot-password` load; and — the trap that
caused the preview outage — it **reads the API URL back out of the shipped JavaScript** to
confirm the bundle was built against the right API.

Verified in both directions locally: it passes a correct stack, and fails a web build baked
against the wrong API URL.

### Founder checklist (things only you can do)

- [ ] **Set `RESEND_API_KEY`** on Railway. Until then password-reset emails are written to the
      log instead of sent, so **no user can recover their account** (`docs/DEPLOYMENT.md` §4a).
- [ ] Confirm **`SANDBOX_RETURN_SECRETS` is unset or `false`** in Railway.
- [ ] Confirm **`CORS_ORIGINS`** lists the real web origins (the API now refuses to boot otherwise).
- [ ] **Rotate the database password** that was exposed earlier in development.
- [ ] **Change the seeded admin password** if it is still `Admin@12345`.
- [ ] **Enable Railway Postgres backups**, and confirm **`FIELD_ENCRYPTION_KEY` is backed up
      somewhere safe** — losing it makes every encrypted name and tax ID permanently unreadable.
- [ ] **Monitor Railway credits** — they gate the API *and* the database.
- [ ] Run the verification script above and attach the output.

---

## 6. Re-review triggers

Run this review again before: enabling file uploads (makes `multer` reachable), adding a
second API instance (in-memory rate limiting stops being sufficient), exposing any endpoint
that accepts a URL from a user (SSRF), or upgrading Next.js.
