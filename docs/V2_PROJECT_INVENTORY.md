# Life Capital OS — V2 Project Inventory

> **Author:** Lead Software Architect (analysis)
> **Branch:** `v2-foundation`
> **Scope:** Complete inventory of the existing (V1) codebase. Analysis only — no code was modified.
> **Method:** Verified against source (Prisma schema, Nest controllers, web app, `package.json`s, greps).

---

## 1. Tech stack

| Layer | Technology |
|---|---|
| Language | TypeScript (end-to-end) |
| Monorepo | pnpm workspaces + Turborepo |
| API | NestJS 10 + Express, Swagger/OpenAPI |
| ORM / DB | Prisma 5 + PostgreSQL 16 |
| Web | Next.js 14 (App Router), React 18, PWA |
| Styling / charts | Tailwind CSS 3, Recharts |
| Validation | Zod (`@lcos/core`), class-validator (API DTOs) |
| Auth | JWT (`@nestjs/jwt` + passport-jwt), Argon2id |
| AI | `@anthropic-ai/sdk` |
| Payments | Razorpay (REST + Node crypto HMAC; **no SDK**) |
| Rate limiting | `@nestjs/throttler` (in-memory) |
| Testing | Vitest (`@lcos/core`), Jest + Supertest (API e2e) |
| CI | GitHub Actions (build, lint, unit, migrate, e2e) |
| Deploy | Vercel (web), Railway (API + Postgres) |
| Local infra | docker-compose (Postgres + Redis) |

---

## 2. Folder structure

```
apps/
  api/    NestJS API — src/{auth,users,accounts,transactions,debts,goals,family,
          networth,insights,tools,ai,billing,aa,admin,common,config,prisma,health},
          prisma/{schema,migrations,seed}, test/ (e2e), api/index.js (serverless),
          main.ts (long-running), railway.json, vercel.json
  web/    Next.js — src/app/{/,login,onboarding,dashboard,billing,admin/*},
          src/components/ (22), src/lib/{api,admin,adminContext}
packages/
  core/   @lcos/core — money, domain/schemas, finance/*, scoring/*, assessment, entitlements
  config/ shared tsconfig presets
infra/    docker-compose (Postgres + Redis)
docs/     REQUIREMENTS, ARCHITECTURE, SECURITY, DEPLOYMENT, V2_ARCHITECTURE, this file
```

---

## 3. Frontend pages (Next.js App Router)

| Route | Purpose | Auth |
|---|---|---|
| `/` | Landing + public wealth tools + trust signals | Public |
| `/login` | Email (sign in/up) + Phone OTP tabs | Public |
| `/onboarding` | Guided first-run setup | User |
| `/dashboard` | Main app (balance sheet, charts, insights, goals, protection, family, AI) | User |
| `/billing` | Plans + subscribe/cancel | User |
| `/admin` | Admin home / metrics | Admin roles |
| `/admin/users` | User management (status, role, tier, overrides, export, erase) | Admin roles |
| `/admin/plans` | Plan editor (price, features, active) | ADMIN/SUPERADMIN |
| `/admin/flags` | Feature flags / remote config | ADMIN/SUPERADMIN |
| `/admin/audit` | Audit log viewer | Admin roles |
| `error.tsx`, `global-error.tsx` | Error boundaries | — |

---

## 4. Backend modules (NestJS)

`AuthModule`, `UsersModule` (profile), `AccountsModule`, `TransactionsModule`, `DebtsModule`,
`GoalsModule`, `FamilyModule`, `NetWorthModule`, `InsightsModule` (early warning), `ToolsModule`
(public calculators), `AiModule`, `BillingModule`, `AaModule` (Account Aggregator), `AdminModule`,
`HealthModule`, `CommonModule` (Crypto, Audit, RolesGuard, FinancialSnapshot), `PrismaModule`,
`ConfigModule` (global). Global guards: `JwtAuthGuard`, `ThrottlerGuard`.

---

## 5. Database models (Prisma, 17 models)

`User`, `Profile`, `FamilyMember`, `Account`, `Transaction`, `Debt`, `Goal`, `NetWorthSnapshot`,
`Recommendation`, `Plan`, `Subscription`, `FeatureOverride`, `FeatureFlag`, `Consent`,
`RefreshToken`, `OtpCode`, `AuditLog`.

- **Money:** `BigInt` minor units (paise/cents).
- **Encrypted PII:** `Profile.fullName`, `FamilyMember.name`, `User.totpSecret` (AES-256-GCM).
- **Enums:** `Role`, `PlanTier`, `AccountType`, `AssetClass`, `TransactionType`, `DebtType`,
  `GoalType`, `RiskTolerance`, `SubscriptionStatus`.
- **RLS:** all tables have Row-Level Security enabled with no policies (Prisma-owner access only).

---

## 6. API endpoints

Prefix `/api`; JWT required unless marked Public. Swagger at `/api/docs`.

- **auth:** `POST otp/request`*, `POST otp/verify`*, `POST register`*, `POST login`*, `POST refresh`*,
  `POST logout`, `POST change-password`, `POST forgot-password`*, `POST reset-password`*, `GET me`
- **profile:** `GET /profile`, `PUT /profile`
- **accounts:** `GET`, `POST`, `PATCH :id`, `DELETE :id`
- **transactions:** `GET`, `GET summary`, `POST`
- **debts:** `GET`, `POST`, `GET payoff-plan`
- **goals:** `GET`, `POST`, `DELETE :id`
- **family:** `GET`, `POST`, `DELETE :id`
- **net-worth:** `GET current`, `POST snapshot`, `GET timeline`
- **insights:** `GET early-warning`
- **tools*** (public): `POST health-check`, `POST retirement`, `POST asset-allocation`,
  `POST insurance-gap`, `GET wealth-dna/questions`, `POST wealth-dna`
- **ai:** `POST coach`, `GET second-opinion`
- **billing:** `GET plans`*, `GET entitlements`, `POST subscribe`, `POST cancel`, `POST razorpay/webhook`*
- **aa:** `POST consent/initiate`, `POST sync`, `GET status`
- **admin** (RolesGuard): `GET users`, `PATCH users/:id/status`, `PATCH users/:id/role`,
  `GET/POST/DELETE users/:id/feature-override(s)`, `PUT users/:id/subscription`, `GET users/:id/export`,
  `DELETE users/:id`, `GET/PUT plans`, `GET/PUT flags`, `GET features`, `GET metrics`, `GET audit`
- **health:** `GET /health`*

`*` = `@Public()`.

---

## 7. Authentication flow

- **OTP (passwordless):** hashed 6-digit code (5-min TTL, ≤5 attempts, per-target send throttle);
  verify → upsert user by channel → issue tokens.
- **Email + password:** Argon2id; DTO rules (≥8 chars, contains a digit).
- **Password lifecycle:** change (verify current, revoke sessions), forgot → reset (hashed token,
  30-min TTL, revoke sessions).
- **Tokens:** JWT access `{sub, role}` (15m, re-fetches user → fresh role/status); random refresh
  stored as SHA-256 hash, **rotated** on refresh, revoked on logout.
- **Guards:** global deny-by-default JWT + throttler; opt-in RBAC (`@Roles`).
- **Boot guard:** `assertProductionConfig` crashes if prod uses dev secrets.
- **Delivery:** OTP/reset codes are **not actually sent** (see §12) — echoed only when
  `SANDBOX_RETURN_SECRETS=true`.
- **Web session store:** `localStorage` (`lcos_access`, `lcos_refresh`).

---

## 8. Environment variables

`DATABASE_URL`, `PORT`, `NODE_ENV`, `CORS_ORIGINS`, `SANDBOX_RETURN_SECRETS`, `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL_DAYS`, `FIELD_ENCRYPTION_KEY`,
`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `RAZORPAY_KEY_ID/KEY_SECRET/WEBHOOK_SECRET/SANDBOX`,
`AA_PROVIDER/API_KEY/SANDBOX`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `NEXT_PUBLIC_API_URL`,
`REDIS_URL` (**declared but unused by code**).

---

## 9. Third-party integrations

| Integration | Status | Notes |
|---|---|---|
| **Anthropic (Claude)** | Implemented, optional | Wealth Coach + Second Opinion; graceful fallback without key |
| **Razorpay** | Implemented, sandbox default | Order create + webhook HMAC; live only with `rzp_live` keys |
| **India Account Aggregator (Setu)** | Abstracted, sandbox only | Consent + sync returns deterministic sample accounts; live fetch throws |
| **PostgreSQL** | Implemented | System of record |
| **Vercel / Railway** | Deploy targets | web / API+DB |
| **Redis** | **Not integrated** | `REDIS_URL` + docker-compose exist; no code uses it |
| **Email / SMS provider** | **Not integrated** | See §12 |
| **File storage (S3/blob)** | **Not integrated** | See §13 |

---

## 10. AI integrations

- **SDK:** `@anthropic-ai/sdk`; model from `ANTHROPIC_MODEL` (default `claude-sonnet-4-6`).
- **Wealth Coach** (`POST /ai/coach`): grounds Claude in the user's real `FinancialSnapshot`
  (net worth, scores, top actions); system prompt enforces educational/SEBI-safe guidance;
  snapshot block uses prompt caching. Falls back to a deterministic answer when no key.
- **Second Opinion** (`GET /ai/second-opinion`): deterministic allocation drift from `@lcos/core`
  + optional LLM narrative review.
- **Gating:** both require the `ai_recommendations` (premium) entitlement.
- **Safety:** "never invent numbers not in the snapshot"; degrades gracefully, never hard-fails.

---

## 11. Billing system

- **Plans** (`Plan`): free / premium / family_cfo; price in minor units; `features` JSON (data-driven).
- **Entitlements engine** (`@lcos/core`): tier cascade + plan-table features + per-user overrides;
  single gate `BillingService.assertFeature`.
- **Subscriptions** (`Subscription`, 1:1 user): sandbox activates immediately; live mode creates a
  Razorpay order and waits for the webhook.
- **Webhook** (`POST /billing/razorpay/webhook`): raw-body HMAC verified; idempotent apply
  (activate / past_due).
- **Admin:** comp/set tier directly, edit plan price/features/active, per-user feature overrides.
- **Cancel:** entitlements fall back to free.

---

## 12. Email system

**NOT IMPLEMENTED.** No email library or provider (no nodemailer/SendGrid/SES/Postmark/Resend in
dependencies). `auth.service` comments state "in production this dispatches via SMS/email provider,"
but no transport exists — OTP codes and password-reset tokens are only returned in the API response
when `SANDBOX_RETURN_SECRETS=true`. **V2 must add an email/SMS delivery provider** for any real
passwordless/reset flow, verification emails, receipts, or notifications.

---

## 13. Storage system

**NOT IMPLEMENTED.** No object storage / file upload (no `@aws-sdk`, multer, Cloudinary, etc.). All
data lives in Postgres. There is no document store despite the roadmap's "Knowledge Vault" premium
feature. **V2 must add blob storage** (S3/R2/GCS) before any document/upload feature.

---

## 14. Current dashboard (`/dashboard`)

Client-rendered SPA composed of: **Net Worth / Assets / Liabilities** stat tiles, **NetWorthChart**
(timeline), **AllocationDonut**, **Accounts** list + **AddAccount**, **EarlyWarning** (traffic-light
signals), **Goals** (with SIP plans), **Protection** (insurance flags), **Family** (members),
**WealthCoach** (AI chat), **SecondOpinion** (AI allocation review). Admin link shown only for admin
roles; first-run users are redirected to `/onboarding`.

---

## 15. Admin features

User management (search/paginate, suspend/reactivate, role change [SUPERADMIN], set plan tier/comp),
per-user feature overrides (grant/revoke/clear), **DPDP data export**, **erasure** [SUPERADMIN],
plan editor (price/features/active), feature-flag/remote-config editor, platform metrics
(users, MAU, paid subs, conversion), append-only **audit log** viewer. All mutations audited; RBAC
enforced server-side (`RolesGuard`), with SUPPORT/ANALYST read-tier and ADMIN/SUPERADMIN for
destructive actions.

---

## 16. User features

Auth (OTP + email/password, reset, change password), profile (income, expenses, risk, dependents,
protection), accounts CRUD (assets/liabilities), transactions + cashflow summary, debts + payoff plan
(snowball/avalanche), goals + SIP planning, family members, net-worth balance sheet + timeline
snapshots, Wealth Health scoring + Top Actions, Early Warning signals, AI Wealth Coach + Second
Opinion (premium), public no-login tools (Health Check, Retirement, Asset Allocation, Insurance Gap,
Wealth DNA), billing (plans, subscribe/cancel), Account Aggregator linking (premium + flag).

---

## 17. Components that are production-ready

- **`@lcos/core`** — money, finance calculators, scoring, entitlements; pure, framework-free, 40+ tests.
- **Auth subsystem** — Argon2id, rotating hashed refresh tokens, fresh-user JWT validation, RBAC.
- **Security primitives** — `CryptoService`, append-only `AuditService`, RLS lockdown, prod secret
  guard, raw-body HMAC webhook verification.
- **`FinancialSnapshotService`** — clean aggregation seam feeding scoring/early-warning/AI.
- **Entitlement gating** (`assertFeature`) and **admin subsystem** (audited, RBAC).
- **Accounts service** — proper ownership checks + `serialize()` boundary.
- **CI pipeline + railway.json** — reproducible build/test/deploy.

---

## 18. Components that require refactoring

- **Web session storage** — access + refresh in `localStorage` → move refresh to httpOnly cookie.
- **Dual API runtime** — serverless (`api/index.js` + `apps/api/vercel.json`) kept alongside the
  long-running server that's actually deployed on Railway; consolidate.
- **`BigInt.toJSON` global patch** — replace with an explicit serialization boundary (precision risk).
- **"Module-in-one-file"** — `transactions`, `debts`, `goals`, `insights`, `health`, `aa` mix
  controller+service+module in one file; split for testability (ai already split).
- **In-memory throttler** — swap for Redis-backed once multi-instance.
- **`crypto.decrypt` plaintext tolerance** — should fail loudly on parse error, not return raw.
- **Net-worth aggregation** — sums mixed-currency balances with no FX conversion.
- **Docs** — `docs/ARCHITECTURE.md` describes non-existent `apps/admin/` app + Redis/BullMQ workers.

---

## 19. Dead code / unused assets (verified)

| Item | Evidence |
|---|---|
| **`Recommendation` model** | Never written by any code path (no `.recommendation.create/upsert`) — dead table |
| **`User.totpSecret`** | Encrypted field exists; **no 2FA/TOTP implementation** anywhere |
| **`REDIS_URL` + docker-compose Redis** | No code references Redis |
| **`nestjs-zod` dependency** | Declared in `apps/api` deps; **unused in `src`** |
| **Serverless API path** | `apps/api/api/index.js` + `apps/api/vercel.json` unused now that Railway hosts the API |
| **Core exports not wired to any route/UI** | `financialFreedomNumber`, `financialIndependenceRatio`, `computeLiquidity`, `evaluateBudget`, `section80CStatus`, `capitalGainsTaxMinor`, `emergencyFundTarget` — built & unit-tested but 0 references in `apps/` (library-ready, not yet used) |

*(The unused core functions are intentional library surface, not bugs — listed so V2 either wires or prunes them.)*

---

## 20. Duplicate code (verified)

- **`monthsBetween` helper** duplicated in `apps/api/src/goals/goals.module.ts` and
  `apps/api/src/common/financial-snapshot.service.ts` → extract to a shared util.
- **`API_URL` constant** duplicated in `apps/web/src/lib/api.ts` and `apps/web/src/lib/admin.ts`.
- **BigInt `serialize` pattern** re-implemented inline across services (accounts has a helper; debts,
  transactions, networth, etc. map manually) → centralize.
- **Entitlement reconstruction idiom** was duplicated across ai/aa; now consolidated in `assertFeature`
  (kept here as a resolved example of the pattern to avoid).

---

## 21. Missing features (gaps vs product vision / roadmap)

- **Email/SMS delivery** (OTP, reset, verification, receipts, notifications) — no provider.
- **File/object storage** and the **Knowledge Vault** premium feature — no backend.
- **Two-factor auth (TOTP)** — schema field only.
- **Background jobs / scheduling** (auto net-worth snapshots, AA auto-sync, notifications) — no queue.
- **Scenario / Monte-Carlo simulator** (`scenario_simulator` entitlement exists; no implementation).
- **Advanced analytics** (`advanced_analytics` entitlement; no implementation).
- **Advisor consultation / marketplace** and **white-label** (flags exist; no implementation).
- **Gamification** (`gamification.enabled` flag; no streaks/badges code).
- **Multi-currency FX conversion.**
- **Budget UI** (envelope budgeting exists in core `evaluateBudget`; no route/screen).
- **Recommendation persistence** (model exists; scoring returns in-memory only).
- **Mobile app** (Expo/React Native, roadmap Phase 7).
- **Live Razorpay + live Account Aggregator** wiring.
- **Observability** (structured logging, metrics, tracing, error reporting).
- **Notifications** (in-app / push / email).

---

## 22. Technical risks

1. **Encryption-key governance (highest).** `FIELD_ENCRYPTION_KEY` is permanent; rotation breaks
   existing PII, and `decrypt` silently returns junk. Need KMS + rotation/re-encryption + strict mode
   before encrypting more fields.
2. **No delivery channel for auth secrets.** Passwordless/reset is non-functional in production until
   email/SMS is integrated (§12) — a launch blocker for real users.
3. **No background-job infra.** Compute-heavy V2 features would run in the request path.
4. **Money precision & FX.** `Number` serialization ceiling + no cross-currency conversion.
5. **Session/XSS exposure.** Refresh tokens in `localStorage`; risk grows with new clients.
6. **RLS + migration discipline.** Every new table must be locked down and migrated on deploy, or it's
   exposed via PostgREST.
7. **Entitlement/flag drift.** Gating spans DB plan features + code defaults + overrides; new premium
   modules must add a `FeatureKey` **and** an `assertFeature` gate.
8. **Observability gap.** Blind production debugging (as seen during initial deploy).
9. **Thin service tests + seed-dependent e2e.** Regressions can slip; seeding is a manual/fragile step.
10. **No multi-tenancy** despite white-label ambitions — expensive to retrofit later.
11. **Dual deploy paths** (serverless + long-running) double the maintenance and drift surface.

---

*Inventory only. No application code was modified in producing this document.*
