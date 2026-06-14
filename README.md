# Life Capital OS™

India's AI-powered **Wealth Health & Family CFO** platform — a secure, monetizable
web app (installable PWA) built so the same TypeScript core powers Android & iOS
apps, with a full-control admin panel built into the app for admin roles.

> Positioning: *"Know Your Financial Health in 5 Minutes."* Not a mutual-fund
> distributor — a **Financial Operating System** for a family's whole financial life.

## What's in this repo

This is a **pnpm + Turborepo monorepo** implementing **Phases 0–2** of the roadmap
(foundation, auth & profile, core financial modules) plus the full-control admin panel.

```
apps/
  api/      NestJS API (REST + Swagger, Prisma, JWT/RBAC, audit log)
  web/      Next.js user app (PWA) — landing, Wealth Health Check, dashboard,
            and the admin panel at /admin (users, plans, flags, audit) for admin roles
packages/
  core/     Shared TS: money, domain schemas, finance calculators, scoring, entitlements
  config/   Shared tsconfig presets
infra/      docker-compose (Postgres + Redis)
docs/       REQUIREMENTS.md · ARCHITECTURE.md · SECURITY.md
```

Key product modules from the blueprints — Wealth Health Check, Asset Allocation
Analyzer, Retirement Readiness, Insurance Gap, Goal Planning, Family Balance Sheet
(net worth), Debt payoff, scoring & Top Wealth Actions — live in `packages/core`
and are reused by the API and web app (and, in Phase 7, the mobile app).

## Quick start

```bash
# 1. Install
pnpm install

# 2. Start Postgres + Redis
pnpm infra:up

# 3. Configure env
cp .env.example .env
cp .env apps/api/.env        # API reads DATABASE_URL etc.

# 4. Database
pnpm db:generate
pnpm --filter @lcos/api exec prisma migrate dev --name init
pnpm db:seed                 # seeds plans, flags, admin + demo user

# 5. Run everything
pnpm dev                     # api :4000, web :3000
```

- API docs (Swagger): http://localhost:4000/api/docs
- Web app: http://localhost:3000
- Admin panel: http://localhost:3000/admin — sign in as an admin
  (`admin@lifecapitalos.dev` / `Admin@12345`); the **Admin** link appears in the
  dashboard only for admin roles.

## Build, test, verify

```bash
pnpm build         # turbo build across all packages
pnpm test          # unit tests (core finance + scoring + entitlements)
pnpm lint          # type-level checks
pnpm --filter @lcos/api test:e2e   # API smoke tests (needs DB)
```

## Tech stack

TypeScript everywhere · Next.js (web + admin, PWA) · NestJS API · Prisma + PostgreSQL ·
Redis (cache/jobs) · Razorpay + store-billing (abstracted) · India Account Aggregator
(abstracted, sandbox). Mobile via Expo/React Native reusing `@lcos/core` (Phase 7).

## Security & compliance

Field-level AES-256-GCM PII encryption, Argon2 passwords, rotating refresh tokens,
RBAC, rate limiting, Helmet, append-only audit log, DPDP (consent + export/erasure)
and RBI Account Aggregator consent. See [`docs/SECURITY.md`](docs/SECURITY.md).

## Roadmap

Phases 0–2 are implemented here. Next: 3 Monetization (Razorpay live), 4 Investments
/ Goals / Scenario simulator, 5 Gamification, 6 Account Aggregator, 7 Mobile apps.
Full detail in [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md).
