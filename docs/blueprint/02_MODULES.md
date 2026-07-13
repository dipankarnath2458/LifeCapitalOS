# 02 — Modules & Submodules

> **Doc:** Phase 2 product surface. **Status:** Draft for review.
> **Related:** [PRD](./01_PRD.md) · [Navigation](./03_NAVIGATION.md) · [Data model](./05_DATA_MODEL.md)

Every module has a stable `MOD-*` ID used across the blueprint. **(V2)** marks capability that
already exists in the foundation and is reused/extended; **(NEW)** marks Phase 2 additions.

---

## Module map (at a glance)

```
Life Capital OS
├── MOD-1  Firm & Tenancy            (NEW)  — the multi-tenant shell
├── MOD-2  Identity, Auth & RBAC     (V2)   — extended with tenant + advisor roles
├── MOD-3  Household & Family        (V2→)  — households, members, legal entities
├── MOD-4  Wealth (Balance Sheet)    (V2→)  — accounts, net worth, cashflow, debt
├── MOD-5  Planning & Scores         (V2→)  — goals, scoring, early warning, allocation, protection
├── MOD-6  AI Agents & Orchestration (V2→)  — analyst, allocation, protection, doc, ops, report agents
├── MOD-7  Document Vault            (NEW)  — storage, classification, requests, retention
├── MOD-8  Tasks & Workflows         (NEW)  — tasks, templates, reviews, reminders
├── MOD-9  Notifications             (NEW)  — in-app + email, preferences, digests
├── MOD-10 Reporting & Analytics     (NEW)  — household reports, firm/book analytics
├── MOD-11 Client Portal             (NEW)  — scoped family experience + approvals + messaging
├── MOD-12 Billing & Entitlements    (V2→)  — firm-level plans, seats, gating
├── MOD-13 Compliance & Consent      (V2→)  — DPDP consent, AA, export/erasure at household scope
└── MOD-14 Platform Admin            (V2→)  — cross-tenant provisioning, plans, flags, trust & safety
```

---

## MOD-1 — Firm & Tenancy **(NEW)**

The multi-tenant shell every other module hangs off. See risk **R-TEN** (doc 10).

| Submodule | Purpose |
|---|---|
| 1.1 Firm registry | A `Firm` (tenant) record: name, brand, base currency, status, plan. |
| 1.2 Membership & seats | Which users belong to a firm and with what firm-role (advisor/analyst/support/owner). |
| 1.3 Book management | Assign/reassign households to advisors; ownership history. |
| 1.4 Firm settings | Branding for reports, default review cadence, notification defaults, feature toggles. |
| 1.5 Firm switching | A user in multiple firms can switch active firm context (rare; supported). |

**Depends on:** MOD-2. **Blocks:** everything household-scoped (MOD-3+).

## MOD-2 — Identity, Auth & RBAC **(V2, extended)**

Reuses V1 auth (OTP + email/password, Argon2id, rotating hashed refresh tokens, fresh-user JWT,
global deny-by-default guard). Phase 2 additions:

| Submodule | Purpose |
|---|---|
| 2.1 Auth flows | (V2) OTP, email/password, reset, change-password. |
| 2.2 Session hardening | (NEW) Move refresh token to httpOnly cookie (V2 refactor R1) before new clients. |
| 2.3 Firm-scoped roles | (NEW) A user's role is resolved **within a firm** (Membership), not just globally. |
| 2.4 Client identity | (NEW) Family members can be invited as **client** users with a scoped portal login. |
| 2.5 Invitations | (NEW) Invite advisor/analyst/support to a firm; invite a client to a household. |
| 2.6 2FA (TOTP) | (NEW) Wire the existing `User.totpSecret` field into a real TOTP flow. |

## MOD-3 — Household & Family **(V2 → extended)**

| Submodule | Purpose |
|---|---|
| 3.1 Household | (NEW) Group that owns everything for one family; belongs to a firm; assigned advisor. |
| 3.2 Members | (V2 `FamilyMember` → extended) People in the household; relationships; dependents. |
| 3.3 Legal entities | (NEW) Individual / HUF / Trust / LLP / Company that legally owns accounts. |
| 3.4 Household profile | (V2 `Profile` → household-scoped) income, expenses, risk, tax residency, currency. |
| 3.5 Relationships graph | (NEW) Who owns/benefits-from which entity/account; dependency links. |

## MOD-4 — Wealth: Family Balance Sheet **(V2 → extended)**

| Submodule | Purpose |
|---|---|
| 4.1 Accounts | (V2) Assets & liabilities; asset class; AA linkage. Now owned by entity, scoped to household. |
| 4.2 Net worth | (V2) Current balance sheet + snapshot timeline, per household. |
| 4.3 Cashflow & budget | (V2 core `evaluateBudget`, not yet surfaced) transactions, categorization, savings rate. |
| 4.4 Debt | (V2) Debts + snowball/avalanche payoff simulation. |
| 4.5 Multi-currency | (NEW) FX conversion to household base currency before aggregation (risk R-FX). |
| 4.6 Account Aggregator | (V2 abstracted/sandbox) consent + sync, per household, gated by flag + entitlement. |

## MOD-5 — Planning & Scores **(V2 → extended)**

All logic lives in `@lcos/core`; surfaced per household.

| Submodule | Purpose |
|---|---|
| 5.1 Goals | (V2) Goal tracking + required SIP; per household, linked to members. |
| 5.2 Scores | (V2) Life Capital Score + sub-scores (wealth/retirement/risk/protection/liquidity). |
| 5.3 Early warning | (V2) Traffic-light signals from the household's real snapshot. |
| 5.4 Asset allocation | (V2) Current vs. target allocation + drift + rebalancing bands. |
| 5.5 Protection | (V2) Insurance-gap analysis vs. dependents & liabilities. |
| 5.6 Recommendations | (V2 model exists, unused) persist Top Actions per household (wire the dead table). |
| 5.7 Scenario simulator | (NEW, later) Monte-Carlo "future wealth" projections (entitlement exists). |

## MOD-6 — AI Agents & Orchestration **(V2 → extended)**

Full detail in [doc 07](./07_AI_AGENTS.md). Reuses the V2 grounding pattern
(`FinancialSnapshotService` → `@lcos/core` → model, "never invent numbers").

| Submodule | Purpose |
|---|---|
| 6.1 Orchestration | (NEW) Run/queue agents, gate by entitlement, log to audit, handle fallback. |
| 6.2 Wealth Analyst agent | (V2 Wealth Coach → generalized) grounded household analysis + narrative. |
| 6.3 Allocation agent | (V2 Second Opinion → generalized) drift & rebalancing review. |
| 6.4 Protection agent | (NEW) insurance adequacy review. |
| 6.5 Document agent | (NEW) classify + extract key fields from uploads. |
| 6.6 Ops/Task agent | (NEW) draft follow-up tasks from alerts and reviews. |
| 6.7 Report agent | (NEW) draft report narratives. |
| 6.8 Agent run log | (NEW) every run recorded (agent, household, inputs hash, tokens, outcome). |

## MOD-7 — Document Vault **(NEW)**

Requires object storage (risk R-STORAGE) and background scanning (risk R-JOBS).

| Submodule | Purpose |
|---|---|
| 7.1 Upload | Presigned upload to S3/R2; size/type limits; virus scan on ingest. |
| 7.2 Classification | Type (statement/policy/will/deed/KYC/tax) + tags; optional AI classification (MOD-6.5). |
| 7.3 Linking & scope | Attach a document to household / member / entity / account / goal. |
| 7.4 Requests | Advisor creates a document request; client fulfills by upload; status tracked. |
| 7.5 Versioning & retention | Version history; retention policy; soft-delete + purge. |
| 7.6 Access & audit | Who can view a document (role + scope); every view/download audited. |

## MOD-8 — Tasks & Workflows **(NEW)**

| Submodule | Purpose |
|---|---|
| 8.1 Tasks | Assignee, due date, priority, status, linked household/document/goal. |
| 8.2 Workflow templates | Reusable checklists (onboarding, annual review, protection review). |
| 8.3 Review cycles | Scheduled recurring reviews per household per firm cadence. |
| 8.4 Reminders & escalation | Due-soon / overdue notifications; escalate to firm owner. |
| 8.5 Activity timeline | Per-household chronological log of tasks, docs, alerts, agent runs. |

## MOD-9 — Notifications **(NEW)**

Requires email provider (risk R-EMAIL) and job runner (risk R-JOBS).

| Submodule | Purpose |
|---|---|
| 9.1 In-app inbox | Bell + notifications center; read/unread; deep links. |
| 9.2 Email transactional | Alerts, task reminders, approvals, report-ready, invitations. |
| 9.3 Preferences | Per-user channel + category opt-in/out; quiet hours. |
| 9.4 Digests | Advisor daily book digest; client periodic summary. |
| 9.5 Event bus | Domain events (alert raised, task due, report ready) fan out to channels. |

## MOD-10 — Reporting & Analytics **(NEW)**

| Submodule | Purpose |
|---|---|
| 10.1 Household report | Branded PDF/web: balance sheet, scores, goals, allocation, actions, narrative. |
| 10.2 Report builder | Choose sections, period, entities; brand with firm logo (MOD-1.4). |
| 10.3 Scheduled reports | Generate on cadence via job; deliver via notification. |
| 10.4 Firm/book analytics | Households, AUM proxy, at-risk count, activity, advisor productivity. |
| 10.5 Export | CSV/PDF export at household and firm scope (respects DPDP export, MOD-13). |

## MOD-11 — Client Portal **(NEW)**

A calm, read-mostly surface for the family, sharing `@lcos/core` and the design system.

| Submodule | Purpose |
|---|---|
| 11.1 Family overview | Scoped balance sheet, net-worth trend, scores, goals. |
| 11.2 Documents | View shared documents; fulfill document requests by upload. |
| 11.3 Approvals | Approve/decline a proposed action or plan from the advisor. |
| 11.4 Messaging | Secure thread with the assigned advisor. |
| 11.5 Consents | View/grant/revoke consents (DPDP, AA) relevant to the household. |

## MOD-12 — Billing & Entitlements **(V2 → extended)**

| Submodule | Purpose |
|---|---|
| 12.1 Firm plans | (NEW) Plans priced per-seat / per-household tiers, above the existing user tiers. |
| 12.2 Entitlement engine | (V2) `@lcos/core/entitlements` + `assertFeature`; add firm-scoped keys. |
| 12.3 Seats & usage | (NEW) Track advisor seats and household counts against plan limits. |
| 12.4 Payments | (V2 Razorpay) firm-level billing; webhook-driven activation. |
| 12.5 Overrides | (V2) per-firm / per-user feature overrides (admin). |

## MOD-13 — Compliance & Consent **(V2 → extended)**

| Submodule | Purpose |
|---|---|
| 13.1 Consent ledger | (V2 `Consent`) per household/member, per purpose, versioned. |
| 13.2 Account Aggregator | (V2) financial-linking consent, gated. |
| 13.3 Data export | (V2 admin export → household scope) DPDP export bundle. |
| 13.4 Erasure | (V2 admin erasure → household scope) right-to-be-forgotten. |
| 13.5 Retention policy | (NEW) document + data retention windows per firm/regulation. |

## MOD-14 — Platform Admin **(V2 → extended)**

| Submodule | Purpose |
|---|---|
| 14.1 Firm provisioning | (NEW) create/suspend firms; assign firm plan; impersonation guardrails. |
| 14.2 Users & roles | (V2) cross-tenant user management, status, role. |
| 14.3 Plans & flags | (V2) plan editor, feature flags / remote config. |
| 14.4 Metrics | (V2 → extended) cross-tenant platform metrics. |
| 14.5 Trust & safety | (V2) append-only audit viewer; abuse/erasure controls. |

---

## Module dependency summary

```
MOD-2 Auth ─► MOD-1 Firm/Tenancy ─► MOD-3 Household ─► MOD-4 Wealth ─► MOD-5 Planning/Scores
                    │                     │                                   │
                    │                     ├─► MOD-7 Documents (needs storage)  │
                    │                     ├─► MOD-8 Tasks                      │
                    │                     ├─► MOD-6 AI Agents ◄────────────────┘ (grounds on 4+5)
                    │                     └─► MOD-11 Client Portal
                    ├─► MOD-9 Notifications (needs email+jobs)  ◄── used by 6,7,8,10
                    ├─► MOD-10 Reporting (needs jobs)           ◄── consumes 4,5,6
                    ├─► MOD-12 Billing/Entitlements (gates all)
                    ├─► MOD-13 Compliance
                    └─► MOD-14 Platform Admin
```

Build order is formalized in [doc 09 Roadmap](./09_ROADMAP.md) and [doc 10 Implementation order](./10_DEPENDENCIES_RISKS.md).
