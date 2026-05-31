# Life Capital OS™ — Product Requirements & Architecture

> India's AI-powered **Wealth Health & Family CFO** platform. A secure web app
> (installable PWA) built so the same business logic powers Android & iOS apps,
> with a full-control admin panel and tasteful, multi-model monetization.

This document consolidates the four source blueprints (`Idea generation`,
`Complete Blueprint`, `Master Blueprint`, `PRD v1`) into one executable spec.

---

## 1. Vision & Positioning

Most firms sell products; better firms make plans; **Life Capital OS is a Financial
Operating System** — the central decision-making platform for a family's financial
life. It answers, in under 60 seconds and before asking for personal details:
*Am I financially secure? Am I on track? What should I do next?*

Positioning: **"India's First AI-Powered Wealth Health & Family CFO Platform"** —
not a mutual-fund distributor.

## 2. Target Users

Mass-affluent families, professionals, business owners, NRI families, pre-retirees
and retirees, plus wealth **advisors** who service them.

## 3. Customer Journey

```
Visitor → Wealth Health Check → Wealth Score → Registration →
Family Balance Sheet → AI Action Plan → Advisor Consultation →
Continuous Monitoring → Legacy & Family Planning
```

## 4. Functional Requirements (Modules)

### 4.1 Public Wealth Tools (lead-generation, no login)
- **Wealth Health Check** — 15–20 inputs → Wealth/Retirement/Risk/Protection/
  Emergency-Fund scores + overall score + Top Wealth Actions.
- **Asset Allocation Analyzer** — current vs recommended allocation + rebalancing.
- **Retirement Readiness** — required corpus, gap, monthly SIP.
- **Financial Freedom** — freedom number, years remaining.
- **Insurance Gap Analysis** — recommended cover, shortfall.
- **Goal Planning Engine** — required SIP per goal.

> Implemented in `@lcos/core` and exposed at `POST /api/tools/*` (public).

### 4.2 Personalized Platform (authenticated)
- **Profile & Family** — identity, dependents, income/expenses, risk tolerance,
  base currency, tax residency; family members.
- **Family Balance Sheet / Net Worth** — accounts (assets + liabilities),
  net-worth timeline via snapshots, solvency & FI ratios.
- **Cashflow & Budgeting** — transactions, categorization, savings rate, envelopes.
- **Debt Management** — snowball/avalanche payoff simulation, interest saved.
- **Goals & Scenario Planning** — goal tracking; *Future Wealth Simulator* (Phase 4).
- **Scores & Recommendations** — Life Capital Score, traffic-light Early Warning.

### 4.3 Next-Generation (later phases)
Wealth DNA, Wealth Stress Index, AI Second Opinion, Digital Twin, AI Wealth Coach,
AI Family CFO, Knowledge Vault, Legacy Readiness — see Roadmap.

### 4.4 Advisor & Admin
- **Advisor dashboard** — lead funnel, client scores, action plans, alerts.
- **Admin panel (full control)** — §7.

## 5. Scoring Framework

Wealth, Risk, Retirement, Protection, Liquidity/Debt, Family Readiness, Legacy, and
the composite **Life Capital Score** — each `0–100` with green/yellow/red bands.
Logic: `packages/core/src/scoring`.

## 6. Non-Functional Requirements

- **Security:** TLS, AES-256-GCM field-level PII encryption, RBAC, rotating refresh
  tokens, rate limiting, Helmet/OWASP hardening, append-only audit log.
- **Compliance (India-first, global-ready):** DPDP Act 2023 (consent ledger, data
  export & erasure), RBI Account Aggregator consent for financial data.
- **Performance & scale:** stateless API, Redis cache/jobs, horizontal scaling.
- **Cross-platform:** shared TypeScript core so web/iOS/Android stay in lock-step.

## 7. Admin Panel — Full Control

Backed by `apps/api` `/admin/*` (role-guarded) and surfaced in `apps/admin`:

| Area | Capabilities |
|------|--------------|
| Users | search, suspend/reactivate, role change, **DPDP export & erase**, per-user feature overrides |
| Billing | plans/pricing CRUD, activate subscriptions, entitlement overrides |
| Config | global **feature flags** / remote config (no redeploy) |
| Monetization | toggle premium / marketplace / affiliate / white-label modules |
| Analytics | users, MAU, paid subs, conversion rate, net-worth snapshots |
| Trust & Safety | **append-only audit log** of every admin action |

Roles: `USER · ADVISOR · SUPPORT · ANALYST · ADMIN · SUPERADMIN`.

## 8. Monetization (tasteful, brand-safe)

- **Primary:** Freemium → **Premium** (₹499/mo) → **Family CFO** (₹1,999/mo).
- **Secondary (flag-gated, off by default):** advisor **marketplace**, **affiliate**
  products, **white-label** B2B tenants — surfaced only where they add value.
- **Engine:** single source of truth in `@lcos/core/entitlements`; `BillingService`
  resolves tier + overrides; Razorpay (web) + Play/App Store billing (mobile).

## 9. Architecture

```
Next.js Web (PWA)  ┐
React Native (Expo)├─►  NestJS API  ─►  PostgreSQL (Prisma)
Next.js Admin      ┘        │      ─►  Redis (cache, BullMQ jobs)
                            └─────►  @lcos/core (shared TS domain logic)
                            └─────►  Razorpay · Account Aggregator (abstracted)
```

- **Monorepo:** pnpm workspaces + Turborepo.
- **`packages/core`:** money, domain zod schemas, finance calculators, scoring,
  entitlements — reused by API, web and (later) mobile.
- See `ARCHITECTURE.md` and `SECURITY.md` for detail.

## 10. Data Model (canonical)

User · Profile · FamilyMember · Account · Transaction · Debt · Goal ·
NetWorthSnapshot · Recommendation · Plan · Subscription · FeatureOverride ·
FeatureFlag · Consent · RefreshToken · OtpCode · AuditLog. Source of truth:
`apps/api/prisma/schema.prisma`.

## 11. API Surface (Phase 0–2)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/tools/health-check` | public | Wealth Health Check |
| POST | `/api/tools/retirement` | public | Retirement readiness |
| POST | `/api/tools/asset-allocation` | public | Allocation analysis |
| POST | `/api/tools/insurance-gap` | public | Insurance gap |
| POST | `/api/auth/otp/request`·`/verify` | public | Phone/email OTP login |
| POST | `/api/auth/register`·`/login`·`/refresh` | public | Email auth + token rotation |
| GET  | `/api/auth/me` | user | Current user + tier |
| GET/PUT | `/api/profile` | user | Profile |
| CRUD | `/api/accounts` | user | Accounts |
| GET/POST | `/api/transactions` (+`/summary`) | user | Cashflow |
| GET/POST | `/api/debts` (+`/payoff-plan`) | user | Debt mgmt |
| GET/POST | `/api/net-worth/current·snapshot·timeline` | user | Balance sheet |
| GET/POST | `/api/billing/plans·entitlements·subscribe` | mixed | Monetization |
| * | `/api/admin/*` | admin | Full-control panel |

Full interactive docs: Swagger at `/api/docs`.

## 12. Roadmap

| Phase | Scope |
|-------|-------|
| 0 Foundation | monorepo, CI, docker, Prisma+seed, API skeleton, this doc |
| 1 Auth & Profile | OTP/email auth, RBAC, profile |
| 2 Core financials | accounts/net-worth, cashflow/budget, debt, web+admin shells |
| 3 Monetization | entitlements, Razorpay, plans/flags admin |
| 4 Investments/Goals/Scenarios | portfolio, Monte-Carlo simulator |
| 5 Gamification | streaks, badges, challenges, nudges |
| 6 Account Aggregator | AA provider integration + sync jobs |
| 7 Mobile | Expo app reusing `@lcos/core`; store billing |

**Phases 0–2 are implemented in this codebase.**

## 13. Success Metrics

Lead-conversion rate, MAU, AUM growth, client retention, advisor productivity, NPS,
premium conversion, ARPU.
