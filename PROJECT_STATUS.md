# Project Status

> Living snapshot of where the product is. **Updated after every merged PR** per the
> [AI Engineering Workflow](./docs/AI_ENGINEERING_WORKFLOW.md).
>
> **Last updated:** M2-4 (Household cashflow & budget engine) — Module 2 in progress.

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
| #15      | M2-2  | Household accounts (MOD-4.1): entity-owned, household-scoped CRUD; promote `Account` scope columns to relations; `Account.userId` relaxed to nullable |
| #16      | M2-3  | Household net worth + immutable snapshots + timeline (MOD-4.2), multi-currency via `FxService` (static/config `FxRateProvider`)                       |
| #17      | M2-7  | Family Balance Sheet UI (`/app/households/[id]/balance-sheet`) — reads immutable snapshots + accounts; no UI recompute                                |
| _(this)_ | M2-4  | Household cashflow & budget engine — transaction ledger (single source of truth), monthly summary/timeline, budget-vs-actual; multi-currency via `FxService` |

Planned next: M2-5 debt · M2-6 household FinancialSnapshot seam.
(M2-8 scheduled snapshots deferred to M0.)

## Health snapshot (merged `main` + this PR)

- **Migrations:** 9, apply cleanly from scratch; no drift (M2-4 adds the `adjustment` enum value, relaxes
  `Transaction.userId` to nullable, promotes `Transaction.householdId` to a relation, adds
  `baseCurrency`/`tags`/`status`/provenance columns, and creates the `Budget`/`BudgetLine` tables — all
  additive, with RLS lockdown on the new tables).
- **Build:** 3/3 packages (incl. Next.js web) · **Lint:** 4/4 · **`@lcos/core`:** 55/55 · **API e2e:** 77/77 (11 suites).
- **Vercel:** web preview builds/deploys on `apps/web` changes (M2-4 builds a preview); skipped otherwise.
- `main` is deployable.

## What's next

**M2-5 — Household debt & payoff**, then M2-6 (household FinancialSnapshot seam, which consumes the cashflow
engine's monthly summary). The Balance Sheet UI (M2-7) will pick up a debt section as it lands (documented
extension point). Awaiting owner approval to begin the next slice.
