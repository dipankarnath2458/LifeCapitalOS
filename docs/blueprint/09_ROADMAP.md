# 09 — Development Roadmap

> **Doc:** Milestone plan for Phase 2. **Status:** Draft for review.
> **Related:** [Modules](./02_MODULES.md) · [Dependencies & risks](./10_DEPENDENCIES_RISKS.md)

Phase 2 is delivered in milestones **M0 → M8**. Each milestone is independently shippable, lands with
its migration + RLS + entitlement gate + audit + tests, and unblocks the next. Infrastructure
prerequisites come **before** the features that need them (see risks R-TEN, R-STORAGE, R-JOBS,
R-EMAIL, R-OBS in doc 10).

Sequencing is dependency-driven, not calendar-driven; sizes are relative (S/M/L).

---

## M0 — Foundation hardening (prerequisite) · size L

Pay down the V2 debts that would otherwise compound as module count grows. No new product surface.

| Item | Ref |
|---|---|
| Move refresh token to httpOnly cookie; access token in memory | V2 R1 (D2) |
| Stand up **Redis** (throttling) + **BullMQ worker** process | V2 R3 (D4), R-JOBS |
| **Object storage** service (S3/R2) abstraction | R-STORAGE |
| **Email** provider + `EmailOutbox` drain | R-EMAIL |
| **Observability**: structured logging, error reporting, metrics | V2 R6 (D10), R-OBS |
| **Encryption-key governance**: KMS, strict-mode decrypt, rotation plan | V2 risk #1, R-KEY |
| Consolidate runtime; retire serverless path + global `BigInt.toJSON` | V2 R2 (D3) |
| Split remaining "module-in-one-file" modules | V2 R4 (D5) |

**Exit criteria:** worker runs a trivial job; a file round-trips storage; an email sends via outbox;
logs/metrics visible; key rotation rehearsed in staging. **Delivers:** MOD-2.2 groundwork + infra for
all later milestones.

## M1 — Tenancy & firm shell · size L

The multi-tenant backbone. **Highest-leverage, must be first among features (R-TEN).**

- `Firm`, `Membership`, `Household`, `HouseholdMember`, `Entity` tables + enums + RLS (migration M1a/M1b)
- `FirmContextGuard`, `HouseholdScopeGuard`, firm-scoped Prisma layer
- Firm-scoped roles (doc 04); invitations for advisors
- `/api/firms`, `/api/households` (CRUD, assign), `/app` advisor shell + book overview + households list
- Add nullable `firmId`/`householdId` scoping columns to existing finance models; backfill

**Delivers:** MOD-1, MOD-2 (firm roles), MOD-3. **Exit:** an advisor can create a firm, a household,
members/entities, and see the book; no cross-tenant leakage (verified).

## M2 — Household wealth (balance sheet) · size M

Bring the V2 finance engine into household scope.

- Household-scoped wrappers for accounts, net worth, cashflow, debt (delegating to V2 services)
- **Multi-currency** aggregation to household base currency (R-FX) in `@lcos/core`
- Consolidated Family Balance Sheet + net-worth timeline UI (reusing `NetWorthChart`, `AllocationDonut`)
- Scheduled snapshots job per firm cadence

**Delivers:** MOD-4, part of MOD-5. **Exit:** a household shows a correct consolidated, multi-currency
balance sheet with history.

## M3 — Planning, scores & analysis surfacing · size M

- Household scores, early-warning, allocation drift, protection gap, goals — all surfaced per household
- Persist Top Actions per household (wire the V2 `Recommendation` table, MOD-5.6)
- Advisor household detail tabs (scores, allocation, protection, goals)

**Delivers:** rest of MOD-5. **Exit:** every household has live scores, signals, and persisted actions.

## M4 — AI agent fleet & orchestration · size L

- `AgentOrchestratorService` + `agents` queue + `AgentRun` table + entitlement keys
- Agents: wealth_analyst, allocation, protection (grounded, post-checked, fallback)
- `/api/agents/*`, `/app/households/:id/ai`, `/app/ai` book view
- Numeric post-check + golden-set evaluation in CI

**Delivers:** MOD-6 (analysis agents). **Depends on:** M2/M3 (grounding data), M0 (jobs).
**Exit:** an advisor runs analysis on demand and on schedule; runs are audited and cost-tracked.

## M5 — Document Vault · size M

- `Document`, `DocumentRequest` + storage integration + `docscan` queue
- Upload (presigned), classification, requests/fulfilment, versioning, retention, scoped access
- Document agent (classify/extract) as an opt-in enhancement (MOD-6.5)
- Advisor + portal document surfaces

**Delivers:** MOD-7, MOD-6.5. **Depends on:** M0 (storage/jobs), M1 (scope). **Exit:** an advisor
requests a doc, a client uploads it, it's scanned, classified, linked, and audited.

## M6 — Tasks, workflows & notifications · size M

- `Task`, `WorkflowTemplate`; task lifecycle, reminders, escalation
- `Notification`, `NotificationPreference`, `EmailOutbox`; in-app inbox + email + digests + preferences
- Ops agent drafting tasks from alerts (MOD-6.6); review-cadence scheduling
- EventBus fan-out wired across prior milestones' events

**Delivers:** MOD-8, MOD-9. **Depends on:** M0 (email/jobs), M1–M3 (events to notify on).
**Exit:** the ongoing wealth-management loop (doc 08 §2) runs end-to-end with reminders and alerts.

## M7 — Reporting & client portal · size L

- `Report` + `reports` queue + branded PDF rendering + report agent narrative (MOD-6.7)
- Household report, firm/book analytics, scheduled reports, export (DPDP-aware)
- `/portal/*` client experience: overview, balance sheet, goals, documents, approvals, messaging, consents
- `Approval`, `MessageThread`, `Message` tables + endpoints; client invitations (MOD-2.4)

**Delivers:** MOD-10, MOD-11. **Depends on:** M2–M6. **Exit:** a family logs into the portal, sees
their position, fulfils a document request, approves an action, and receives a branded report.

## M8 — Firm billing, compliance & admin polish · size M

- Firm-level plans/seats/usage + entitlement keys wired to all gated modules (MOD-12)
- Household-scoped consent, export, erasure; retention policies (MOD-13)
- Platform admin: firm provisioning, cross-tenant metrics, tenant-scoped audit viewer (MOD-14)
- 2FA (TOTP) wiring (MOD-2.6)

**Delivers:** MOD-12, MOD-13, MOD-14. **Exit:** firms are billed by seat/household; DPDP flows work at
household scope; platform admin manages tenants; every gated capability enforces its `FeatureKey`.

---

## Milestone → module coverage

| Milestone | Modules delivered |
|---|---|
| M0 | infra (storage, jobs, email, obs, keys) + MOD-2.2 |
| M1 | MOD-1, MOD-2 (firm roles), MOD-3 |
| M2 | MOD-4, MOD-5 (partial) |
| M3 | MOD-5 (complete) |
| M4 | MOD-6 (analysis agents) |
| M5 | MOD-7, MOD-6.5 |
| M6 | MOD-8, MOD-9, MOD-6.6 |
| M7 | MOD-10, MOD-11, MOD-6.7 |
| M8 | MOD-12, MOD-13, MOD-14, MOD-2.6 |

## Cross-milestone "definition of done" (every milestone)

1. Migration(s) + **RLS lockdown** on new tables; nullable→backfill→tighten where needed.
2. `FeatureKey` + `assertFeature` gate for any premium capability.
3. PII encrypted; every mutation audited with `firmId`.
4. Firm/household **isolation verified** (no cross-tenant read/write) — automated test.
5. Unit tests (`@lcos/core`) + service tests + e2e for the new surface (address V2 D8).
6. Swagger updated; docs in this blueprint reconciled if scope shifts.
7. No change to the V2 design system; screens compose existing primitives.
8. Deterministic AI fallback preserved for any agent feature.

## What is explicitly deferred beyond Phase 2

Native mobile (Expo), advisor marketplace, white-label multi-brand theming, live trade execution,
gamification — flags/entitlements may exist, but implementation is post-Phase-2 (PRD non-goals).
