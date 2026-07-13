# Life Capital OS — Version 2 Architecture Document

> **Status:** Analysis of the existing (V1) system as the foundation for V2.
> **Branch:** `v2-foundation`.
> **Scope:** This document only analyzes and documents. No production code is written or changed here.
> **Audience:** Engineers planning V2 modules; assumes familiarity with TypeScript, NestJS, Next.js, Prisma.

---

## 0. Executive summary

Life Capital OS is a **pnpm + Turborepo monorepo** in TypeScript end-to-end. A framework-agnostic
domain core (`@lcos/core`) holds all finance math, scoring, and entitlement logic and is reused by a
**NestJS REST API** (`apps/api`) and a **Next.js PWA** (`apps/web`, which also contains the admin panel).
PostgreSQL via Prisma is the system of record; PII is encrypted at the application layer.

The V1 foundation is **solid and worth keeping**: the domain core is pure and well-tested, auth is
modern (Argon2 + rotating refresh tokens + RBAC), and the data model is coherent. V2 work should
**build on the core, harden the edges** (token storage, deploy/runtime duality, doc drift, observability),
and add new modules through the existing module + entitlement patterns rather than reworking the base.

---

## 1. Existing folder structure

```
LifeCapitalOS/
├── apps/
│   ├── api/                         NestJS REST API (system of record access)
│   │   ├── api/index.js             Vercel serverless entrypoint (wraps Express)
│   │   ├── prisma/
│   │   │   ├── schema.prisma         Data model (source of truth for DB)
│   │   │   ├── migrations/           3 migrations incl. RLS lockdown
│   │   │   └── seed.ts               Plans, flags, admin + demo user (ts-node)
│   │   ├── src/
│   │   │   ├── app.factory.ts        Builds the Nest app (shared by local + serverless)
│   │   │   ├── app.module.ts         Root module; wires global guards
│   │   │   ├── main.ts               Long-running entrypoint (listen 0.0.0.0)
│   │   │   ├── auth/                  OTP + email/password, JWT strategy, guards, DTOs
│   │   │   ├── users/                 Profile controller/service
│   │   │   ├── accounts/              Accounts CRUD
│   │   │   ├── transactions/          Ledger + cashflow summary (module-in-one-file)
│   │   │   ├── debts/                 Debt CRUD + payoff plan (module-in-one-file)
│   │   │   ├── goals/                 Goals CRUD + SIP plan (module-in-one-file)
│   │   │   ├── family/                Family members
│   │   │   ├── networth/             Net-worth current/snapshot/timeline
│   │   │   ├── insights/             Early-warning (module-in-one-file)
│   │   │   ├── tools/                 Public lead-gen calculators
│   │   │   ├── ai/                    Wealth Coach + Second Opinion (Anthropic)
│   │   │   ├── billing/              Plans, entitlements, Razorpay + webhook
│   │   │   ├── aa/                    Account Aggregator (sandbox) (module-in-one-file)
│   │   │   ├── admin/                 Admin service/controller (users, plans, flags, audit)
│   │   │   ├── common/               Crypto, Audit, RolesGuard, decorators, FinancialSnapshot
│   │   │   ├── config/               Typed configuration + prod secret guard
│   │   │   ├── prisma/               PrismaService (module)
│   │   │   └── health/               /health (module-in-one-file)
│   │   ├── test/                     e2e specs (auth, auth-flows, admin-access, features)
│   │   ├── railway.json              Railway build/start/healthcheck (deploy config)
│   │   └── vercel.json               Vercel serverless config for the API
│   └── web/                          Next.js 14 App Router PWA
│       ├── src/app/                  Routes: /, /login, /onboarding, /dashboard,
│       │                             /billing, /admin/* , error boundaries
│       ├── src/components/           ~24 client components (charts, forms, modals, admin)
│       ├── src/lib/                  api.ts (fetch client), admin.ts, adminContext.tsx
│       └── vercel.json               Vercel build config (root dir apps/web)
├── packages/
│   ├── core/                        @lcos/core — money, schemas, finance, scoring, entitlements
│   └── config/                      Shared tsconfig presets
├── infra/                           docker-compose (Postgres + Redis) for local dev
├── docs/                            REQUIREMENTS, ARCHITECTURE, SECURITY, DEPLOYMENT (+ this file)
├── turbo.json, pnpm-workspace.yaml, package.json, .env.example, .github/workflows/ci.yml
```

**Note (doc drift):** `docs/ARCHITECTURE.md` describes a separate `apps/admin/` React-Admin app and
Redis/BullMQ workers. **Neither exists in the code today** — admin lives inside `apps/web` under
`/admin`, and there is no Redis usage or background-job worker. See §8.

---

## 2. Existing database schema

Postgres via Prisma (`apps/api/prisma/schema.prisma`). Monetary amounts are **`BigInt` minor units**
(paise/cents). PII is encrypted at the app layer before persistence.

### Models
| Model | Purpose | Notable fields |
|---|---|---|
| `User` | Account root | `email?`, `phone?` (unique), `passwordHash?`, `role`, `status`, `totpSecret?` (enc), verification flags |
| `Profile` | 1:1 user profile | `fullName` (**enc**), `dateOfBirth?`, `baseCurrency`, income/expenses (BigInt), `riskTolerance`, `dependents`, protection flags (`hasTermCover`, `hasHealthInsurance`, `termLifeCoverMinor`) |
| `FamilyMember` | Dependents | `name` (**enc**), `relation`, `isDependent` |
| `Account` | Balance-sheet line | `type`, `assetClass?`, `currency`, `balanceMinor`, `isLiability`, AA linkage (`aaProvider`, `aaAccountRef`) |
| `Transaction` | Ledger | `accountId`, `type`, `amountMinor`, `category`, `occurredAt` |
| `Debt` | Liabilities detail | `principalMinor`, `annualInterestRatePct`, `minimumPaymentMinor` |
| `Goal` | Financial goals | `targetAmountMinor`, `currentAmountMinor`, `targetDate`, `expectedAnnualReturnPct` |
| `NetWorthSnapshot` | History timeline | assets/liabilities/netWorth minor, `capturedAt` |
| `Recommendation` | Top actions (persisted) | `scoreKey`, `priority`, `dismissed` |
| `Plan` | Monetization tiers | `tier` (unique), `priceMinor`, `features` (JSON), `active` |
| `Subscription` | 1:1 user sub | `planId`, `status`, `provider`, `providerSubscriptionId?`, `currentPeriodEnd?` |
| `FeatureOverride` | Per-user grants/revokes | unique `(userId, feature)`, `enabled` |
| `FeatureFlag` | Global remote config | `key` (unique), `enabled`, `payload?` (JSON) |
| `Consent` | DPDP/AA consent | `purpose`, `granted`, `version` |
| `RefreshToken` | Rotating sessions | `tokenHash` (unique), `expiresAt`, `revokedAt?` |
| `OtpCode` | OTP + reset tokens | `channel`, `target`, `codeHash`, `expiresAt`, `consumedAt?`, `attempts` |
| `AuditLog` | Append-only trail | `actorId?`, `actorRole?`, `action`, `entityType?`, `entityId?`, `metadata?`, `ip?` |

**Enums:** `Role` (USER, ADVISOR, SUPPORT, ANALYST, ADMIN, SUPERADMIN), `PlanTier` (free, premium,
family_cfo), `AccountType`, `AssetClass`, `TransactionType`, `DebtType`, `GoalType`, `RiskTolerance`,
`SubscriptionStatus`.

**Security posture:** migration `enable_rls_lockdown` turns on Row-Level Security with **no policies**
on every table, so Postgres is reachable only through Prisma's owner role (defeats accidental exposure
via Supabase/PostgREST). Cascade deletes are defined on user-owned relations; `AuditLog.actor` is an
optional relation (nulls on user delete).

---

## 3. Existing APIs

Global prefix `/api`. Every route requires a valid JWT unless marked `@Public()`. Swagger at `/api/docs`.

**Auth (`/api/auth`)** — `POST otp/request`, `POST otp/verify`, `POST register`, `POST login`,
`POST refresh`, `POST logout`, `POST change-password`, `POST forgot-password`, `POST reset-password`,
`GET me`. (Public: otp/*, register, login, refresh, forgot/reset.)

**Profile (`/api/users` / profile)** — `GET` profile, `PUT` profile (upsert; encrypts `fullName`).

**Accounts (`/api/accounts`)** — `GET`, `POST`, `PATCH :id`, `DELETE :id` (ownership-checked).

**Transactions (`/api/transactions`)** — `GET`, `GET summary` (cashflow), `POST` (account ownership-checked).

**Debts (`/api/debts`)** — `GET`, `POST`, `GET payoff-plan` (snowball vs avalanche).

**Goals (`/api/goals`)** — `GET` (each enriched with SIP plan), `POST`, `DELETE :id`.

**Family (`/api/family`)** — CRUD for family members.

**Net worth (`/api/net-worth`)** — `GET current`, `POST snapshot`, `GET timeline`.

**Insights (`/api/insights`)** — `GET early-warning` (traffic-light report from real snapshot).

**Tools (`/api/tools`, all Public)** — `POST health-check`, `POST retirement`, `POST asset-allocation`,
`POST insurance-gap`, `GET wealth-dna/questions`, `POST wealth-dna`. Lead-gen, no login required.

**AI (`/api/ai`)** — `POST coach`, `GET second-opinion`. Gated on `ai_recommendations` entitlement;
degrades to deterministic output when no `ANTHROPIC_API_KEY`.

**Billing (`/api/billing`)** — `GET plans` (Public), `GET entitlements`, `POST subscribe`,
`POST cancel`, `POST razorpay/webhook` (Public; HMAC-verified raw body).

**Account Aggregator (`/api/aa`)** — `POST consent/initiate`, `POST sync`, `GET status`.
Gated on both the `aa.enabled` flag and the `account_aggregation` entitlement.

**Admin (`/api/admin`, RolesGuard)** — `GET users`, `PATCH users/:id/status`, `PATCH users/:id/role`
(SUPERADMIN), feature-override get/set/clear, `PUT users/:id/subscription`, `GET users/:id/export`
(DPDP), `DELETE users/:id` (SUPERADMIN erasure), `GET/PUT plans`, `GET/PUT flags`, `GET features`,
`GET metrics`, `GET audit`.

**Health (`/api/health`, Public)** — liveness + `db` up/down.

---

## 4. Authentication flow

**Two credential paths, one token model.**

1. **Phone/Email OTP (passwordless):** `otp/request` creates a hashed 6-digit `OtpCode`
   (5-min TTL, per-target windowed throttle). `otp/verify` checks the hash (max 5 attempts),
   then **upserts** the user by channel and issues tokens. Dev codes are only echoed when
   `SANDBOX_RETURN_SECRETS=true` (never in production).
2. **Email + password:** `register` (Argon2id hash) / `login`. Password rules enforced by DTO
   (min 8, must contain a digit).
3. **Password lifecycle:** `change-password` (verifies current, revokes all sessions),
   `forgot-password` → `reset-password` (hashed reset token, 30-min TTL, revokes sessions).

**Token model:**
- **Access token:** JWT `{ sub, role }`, short TTL (15m), `Bearer` header. Validated by
  `JwtStrategy`, which **re-fetches the user** and rejects non-`active` accounts (role/status always fresh).
- **Refresh token:** 48-byte random, stored **only as SHA-256 hash**; `refresh` **rotates**
  (revokes old, issues new pair); `logout` revokes.

**Guards (global):** `JwtAuthGuard` (deny-by-default, honors `@Public()`) + `ThrottlerGuard`.
`RolesGuard` (opt-in via `@Roles()`) enforces admin RBAC. Config guard `assertProductionConfig`
crashes boot if prod still uses dev secrets.

**Web session:** access + refresh stored in `localStorage` (`lcos_access`, `lcos_refresh`); attached
as `Authorization` header by `lib/api.ts`. (See §8 — XSS exposure.)

---

## 5. Current frontend architecture

- **Next.js 14 App Router**, React 18, Tailwind, Recharts. Shipped as an installable **PWA**
  (`manifest.webmanifest`). `@lcos/core` is transpiled into the web build for shared types/math.
- **Client-heavy:** pages are `'use client'` and fetch from the API at runtime via a thin
  `lib/api.ts` (`apiGet/apiPost/apiPut/apiDelete`) using `NEXT_PUBLIC_API_URL`. No server components
  hitting the DB, no server actions — the web app is effectively an SPA over the REST API.
- **Routing:** `/` (landing + public tools), `/login` (email + phone tabs), `/onboarding`,
  `/dashboard` (balance sheet, charts, early warning, goals, protection, family, AI coach/second
  opinion), `/billing`, `/admin/*` (users, plans, flags, audit). `error.tsx` + `global-error.tsx`
  boundaries.
- **Admin gating:** `/admin/layout.tsx` calls `/auth/me`, redirects non-admins client-side; the API's
  `RolesGuard` is the real boundary (client is UX only). `lib/admin.ts` centralizes admin fetch + 401/403
  handling; `adminContext.tsx` shares the role to pages.
- **Components (~24):** charts (`NetWorthChart`, `AllocationDonut`), forms (`AddAccount`, `Goals`,
  `Protection`, `Family`, `RetirementCalculator`, `InsuranceGap`), primitives (`Modal`, `Toast`,
  `Skeleton`, `NumberField`, `Pager`, `Status`), AI (`WealthCoach`, `SecondOpinion`), admin
  (`AdminShell`, `FeatureOverrides`).

---

## 6. Backend architecture

- **NestJS 10 + Express**, modular by domain. Root `AppModule` wires `ConfigModule`, `ThrottlerModule`
  (in-memory), Prisma, and every feature module. Two global `APP_GUARD`s: JWT then Throttler.
- **Two entrypoints, one app factory:** `app.factory.ts` builds the app (security headers, CORS,
  global `ValidationPipe` with whitelist+transform, Swagger). `main.ts` runs a **long-running** server
  (Railway); `api/index.js` wraps the compiled app as a **Vercel serverless** function. `BigInt.toJSON`
  is globally patched to serialize as `Number`.
- **Cross-cutting services (`common/`):**
  - `CryptoService` — AES-256-GCM field encryption (`iv:tag:ciphertext` hex) + SHA-256 hashing.
  - `AuditService` — append-only writes to `AuditLog`.
  - `RolesGuard`, decorators (`@Roles`, `@Public`, `@CurrentUser`).
  - `FinancialSnapshotService` — **the key aggregation layer**: assembles one `FinancialSnapshot`
    from profile/accounts/debts/goals and maps it into the core's `ScoreInput` / `EarlyWarningInput`,
    so scoring, early-warning, and the AI coach all reason from identical real data.
- **Domain services** are thin: validate DTO → call `@lcos/core` pure function → read/write via Prisma →
  serialize `BigInt`. Entitlement gating is centralized in `BillingService.assertFeature`.
- **Persistence:** `PrismaService` deliberately does **not** throw on a failed connect at boot (so
  serverless health checks still return), logging instead.

**`@lcos/core` (shared, platform-agnostic, no Node/DOM deps):** `money` (integer minor units +
formatting), `domain/schemas` (Zod), finance calculators (`networth`, `retirement`, `debt`, `goals`,
`assetAllocation`, `cashflow`, `insurance`, `tax`), scoring (`scores`, `earlyWarning`,
`recommendations`), `assessment/wealthDna`, and the `entitlements` engine (tier cascade + plan-driven
features + overrides). Covered by 40+ unit tests.

---

## 7. Reusable components (assets V2 should lean on)

- **`@lcos/core`** — the crown jewel. Pure, tested, framework-free. Reuse for API, web, and future
  mobile. New finance/scoring belongs here, not in services.
- **`FinancialSnapshotService`** — single source of derived financial truth; any new analytics module
  should consume it rather than re-querying/re-deriving.
- **Entitlement engine + `BillingService.assertFeature`** — the one way to gate a feature by tier +
  per-user override. New premium modules plug in by adding a `FeatureKey` and a gate call.
- **`CryptoService` / `AuditService`** — reuse for any new PII or any new admin mutation.
- **`FeatureFlag` model** — global rollout switches already exist; use for staged V2 launches.
- **Guards + decorators** (`@Public`, `@Roles`, `@CurrentUser`) — consistent auth wiring for new routes.
- **Web primitives** (`Modal`, `Toast`, `Skeleton`, `NumberField`, `Pager`, chart wrappers) and
  `lib/api.ts` / `lib/admin.ts` — reuse for new screens.
- **Public tools pattern** (`tools.controller`) — template for new no-login lead-gen calculators.

---

## 8. Technical debt

| # | Item | Where | Impact |
|---|---|---|---|
| D1 | **Doc drift** — `docs/ARCHITECTURE.md` claims `apps/admin/` (React-Admin) and Redis/BullMQ workers that don't exist | docs vs code | Misleads planning; V2 should reconcile docs to reality |
| D2 | **Tokens in `localStorage`** (access + refresh) | web `lib/api.ts`, `login` | XSS can exfiltrate sessions; refresh token especially sensitive |
| D3 | **Dual runtime (serverless + long-running)** maintained in parallel; `BigInt.toJSON` global patch; serverless needs compiled `dist` | `api/index.js`, `app.factory.ts` | Two deploy paths to keep working; precision loss above ~9e15 paise |
| D4 | **In-memory throttler & no cache/queue layer** despite infra/docs implying Redis/BullMQ | `app.module.ts`, `infra/` | Rate limits don't span instances; heavy compute would run in-request |
| D5 | **"Module-in-one-file"** pattern (aa, ai split done; transactions/debts/goals/insights/health still inline controller+service+module) | those modules | Harder to test/navigate; inconsistent with the rest |
| D6 | **`crypto.decrypt` tolerates plaintext** (returns raw on parse failure) | `CryptoService` | A key/rotation error can surface ciphertext-looking junk instead of failing loudly |
| D7 | **No multi-currency FX** — `Money` assumes same currency; net worth sums mixed-currency balances as if identical | core + `networth.service` | Wrong totals if a user mixes currencies (schema allows it) |
| D8 | **Thin API unit-test coverage** — strong `@lcos/core` unit tests + a few API e2e, but services themselves largely untested | `apps/api` | Regressions in services can slip through |
| D9 | **Seed is required for e2e/admin but is a manual/one-off step**; `ts-node` seed at runtime is fragile | `prisma/seed.ts`, CI | Environment-specific breakage (already bit CI once) |
| D10 | **No structured observability** (no request logging/metrics/tracing/error reporting) | API-wide | Hard to debug production (as seen during deploy) |
| D11 | **Emergency-fund vs liquidity definitions diverge**; `Recommendation` table modeled but not written by the scoring path | snapshot service, `Recommendation` | Minor correctness/among-metrics inconsistency; near-dead table |

---

## 9. Which parts should remain unchanged

- **`@lcos/core`** — money model (integer minor units), finance calculators, scoring, entitlement
  engine. Stable, pure, tested. **Extend, don't rewrite.**
- **Prisma data model** for existing domains (User/Profile/Account/Transaction/Debt/Goal/NetWorth…).
  Coherent and normalized; add tables for new modules rather than reshaping these.
- **Auth model** — Argon2id, rotating hashed refresh tokens, JWT-with-fresh-user-lookup, global
  deny-by-default guard, RBAC. Modern and correct.
- **Security primitives** — field encryption, append-only audit log, RLS lockdown, prod secret guard,
  raw-body HMAC webhook verification.
- **Entitlement gating pattern** and the **FinancialSnapshotService** aggregation seam.
- **Monorepo + Turborepo + pnpm** layout and the shared `config` presets.

---

## 10. Which parts should be refactored (for V2)

- **R1 — Session storage (from D2):** move refresh tokens to an `httpOnly`, `Secure`, `SameSite`
  cookie; keep access tokens in memory. Removes the biggest XSS blast radius before new surfaces ship.
- **R2 — Consolidate runtime (from D3):** pick **one** primary deploy target (long-running on Railway is
  already working) and treat serverless as optional; replace the global `BigInt.toJSON` patch with an
  explicit serialization boundary (a `serialize()` helper already exists in `accounts.service`).
- **R3 — Introduce a real cache/queue layer (from D4):** add Redis-backed throttling and a job runner
  (BullMQ) **before** compute-heavy V2 modules (scenario simulator, AA sync, scheduled snapshots), so
  they don't run in the request path. Update `infra`/docs to match.
- **R4 — Normalize module structure (from D5):** split the remaining inline modules into
  `*.controller.ts` / `*.service.ts` / `*.module.ts` for consistency and testability.
- **R5 — Multi-currency (from D7):** add an FX/base-currency conversion boundary in `@lcos/core` and
  convert to `baseCurrency` before aggregation. Required if V2 targets NRIs/mixed portfolios.
- **R6 — Observability (from D10):** add structured request logging, error reporting, and health/metrics
  before scaling module count — deployment pain in V1 was largely a visibility problem.
- **R7 — Reconcile docs (from D1)** and make the seed deterministic/idempotent and part of the
  release process, not a manual step (from D9).
- **R8 — Test depth (from D8):** add service-level unit tests and expand e2e as new modules land.

---

## 11. Risks to resolve BEFORE adding new modules

1. **Encryption key governance (highest).** `FIELD_ENCRYPTION_KEY` is permanent — any rotation makes
   existing PII unreadable, and `decrypt` silently returns junk (D6). Establish KMS-managed keys, a
   rotation/re-encryption strategy, and strict-mode decryption **before** encrypting more fields.
2. **Migrations + RLS discipline.** RLS lockdown means every new table must also be locked down or it's
   exposed via PostgREST; every schema change must ship a migration and be applied on deploy. Bake this
   into the module checklist.
3. **No background-job infrastructure.** V2's likely features (scenario Monte-Carlo, AA auto-sync,
   scheduled net-worth snapshots, notifications) will overwhelm the request path without R3. Stand up
   the queue first.
4. **Money precision & FX (D3/D7).** Confirm the `Number`-serialization ceiling and add FX conversion
   before any module that sums cross-currency or very large values.
5. **Auth surface expansion.** New clients (mobile, third-party) will multiply the `localStorage`
   token risk; do R1 first. Also confirm the OTP passwordless path's intended behavior (an email-OTP
   login succeeds for a password account) is acceptable as new channels are added.
6. **Entitlement/flag consistency.** Gating lives in three coordinated places (tier features in the DB,
   the code-default cascade, per-user overrides). New premium modules must add a `FeatureKey` **and**
   an `assertFeature` gate, or access control drifts.
7. **Observability gap (D10).** Adding modules without logging/metrics repeats V1's blind debugging.
8. **Test + CI coverage (D8/D9).** Thin service tests + a seed-dependent e2e suite mean new modules can
   regress silently; strengthen the safety net alongside feature work.
9. **Multi-tenant/white-label ambition.** Flags exist for `whitelabel`/`marketplace` but there is no
   tenant isolation in the data model — decide early whether V2 needs tenancy, as retrofitting it later
   is expensive.

---

## Appendix A — Tech stack (as built)

TypeScript · pnpm + Turborepo · NestJS 10 + Express · Prisma 5 + PostgreSQL 16 · Next.js 14 (App Router,
PWA) · Tailwind + Recharts · Zod · class-validator · Argon2id · `@anthropic-ai/sdk` (Wealth Coach) ·
Razorpay (REST + HMAC, no SDK) · India Account Aggregator (abstracted, sandbox) · Jest (e2e) + Vitest
(core) · Deploy: Vercel (web) + Railway (API + Postgres).

## Appendix B — Environment variables (from `.env.example` + config)

`DATABASE_URL`, `PORT`, `NODE_ENV`, `CORS_ORIGINS`, `SANDBOX_RETURN_SECRETS`, `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL_DAYS`, `FIELD_ENCRYPTION_KEY`,
`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `RAZORPAY_*`, `AA_*`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`,
`NEXT_PUBLIC_API_URL`. (`REDIS_URL` is present in env/infra but **not used** by any code today.)

---

*This document is analysis only; no application code was modified in producing it.*
