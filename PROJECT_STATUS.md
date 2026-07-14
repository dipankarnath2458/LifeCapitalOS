# Project Status

> Living snapshot of where the product is. **Updated after every merged PR** per the
> [AI Engineering Workflow](./docs/AI_ENGINEERING_WORKFLOW.md).
>
> **Last updated:** M2-2 (Household accounts) — Module 2 in progress.

## Current phase

**Phase 2 — Family Wealth OS.** Building the multi-tenant advisory product on the merged V2 foundation and
the [Phase 2 blueprint](./docs/blueprint/). Module 2 follows the
[M2 architecture reference](./docs/architecture/M2_HOUSEHOLD_WEALTH_ARCHITECTURE.md).

## Milestone progress

| Milestone | Scope                                                                            | Status               |
| --------- | -------------------------------------------------------------------------------- | -------------------- |
| M0        | Foundation hardening (Redis/jobs, storage, email, observability, key governance) | ⏳ not started       |
| **M1**    | **Tenancy & firm shell**                                                         | ✅ complete (#6–#12) |
| **M2**    | **Household wealth (Family Balance Sheet) + multi-currency**                     | 🔨 in progress       |
| M3        | Planning, scores & analysis surfacing                                            | ◻️                   |
| M4        | AI agent fleet & orchestration                                                   | ◻️                   |
| M5        | Document Vault                                                                   | ◻️                   |
| M6        | Tasks, workflows & notifications                                                 | ◻️                   |
| M7        | Reporting & client portal                                                        | ◻️                   |
| M8        | Firm billing, compliance & admin polish                                          | ◻️                   |

### Module 1 — delivered PRs (#6–#12)

Tenancy schema (RLS) · `FirmContextGuard` + `/api/firms` · membership & advisor invitations ·
households CRUD + `HouseholdScopeGuard` · household members & entities · advisory scoping columns (M1b) ·
advisor `/app` workspace shell.

### Module 2 — progress

| PR       | Slice | Summary                                                                                                                                               |
| -------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| #14      | M2-1  | FX conversion boundary in `@lcos/core` (`FxRateProvider`, `convertMoney`, `sumInBaseCurrency`) + M2 architecture reference (+ ADRs)                   |
| _(this)_ | M2-2  | Household accounts (MOD-4.1): entity-owned, household-scoped CRUD; promote `Account` scope columns to relations; `Account.userId` relaxed to nullable |

Planned next: M2-3 net worth + snapshots (multi-currency) · M2-4 cashflow · M2-5 debt · M2-6 household
FinancialSnapshot seam · M2-7 Family Balance Sheet UI. (M2-8 scheduled snapshots deferred to M0.)

## Health snapshot (merged `main` + this PR)

- **Migrations:** 7, apply cleanly from scratch; no drift.
- **Build:** 3/3 packages · **Lint:** 4/4 · **`@lcos/core`:** 54/54 · **API e2e:** 65/65 (9 suites).
- **Vercel:** web preview builds/deploys on `apps/web` changes; skipped otherwise.
- `main` is deployable.

## What's next

**M2-3 — Household net worth + snapshots (multi-currency).** FX-convert each household account to the
household base currency (via M2-1) then `computeNetWorth`; on-demand `NetWorthSnapshot` capture + timeline,
scoped to the household. Depends on M2-1 (FX) + M2-2 (accounts). Awaiting owner approval after M2-2 merges.
