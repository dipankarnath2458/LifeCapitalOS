# Project Status

> Living snapshot of where the product is. **Updated after every merged PR** per the
> [AI Engineering Workflow](./docs/AI_ENGINEERING_WORKFLOW.md).
>
> **Last updated:** Post-M2 permanent architecture documentation — Module 2 complete; pre-Module-3 review.

## Current phase

**Phase 2 — Family Wealth OS.** Building the multi-tenant advisory product on the merged V2 foundation and
the [Phase 2 blueprint](./docs/blueprint/). Module 2 follows the
[M2 architecture reference](./docs/architecture/M2_HOUSEHOLD_WEALTH_ARCHITECTURE.md).

**Permanent V2 architecture documentation** (written after M2 shipped, reflects the implementation):
[System Architecture](./docs/architecture/SYSTEM_ARCHITECTURE_V2.md) ·
[Financial Kernel](./docs/architecture/FINANCIAL_KERNEL_ARCHITECTURE.md) ·
[AI Integration](./docs/architecture/AI_INTEGRATION_ARCHITECTURE.md) ·
[Extension Guidelines](./docs/architecture/EXTENSION_GUIDELINES.md) ·
[Financial Kernel ADR](./docs/architecture/ADR-FINANCIAL-KERNEL.md). These include the component/domain/data-flow/
snapshot-lifecycle/module-dependency diagrams, the future-module validation, and the pre-Module-3 review.

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
| #18      | M2-4  | Household cashflow & budget engine — transaction ledger (single source of truth), monthly summary/timeline, budget-vs-actual; multi-currency via `FxService` |
| #19      | M2-5  | Household debt & payoff engine — detailed liability ledger + payments, live summary/payoff (snowball/avalanche), immutable `DebtSnapshot` timeline (ADR-011) |
| _(this)_ | M2-6  | Financial Snapshot Contract (the **financial kernel**) — immutable, versioned, checksummed `FinancialSnapshot` composing M2-2…M2-5; the canonical read model every future module consumes (ADR-012) |

Planned next: M3 (planning, scores & analysis) consumes the Financial Snapshot.
(M2-8 scheduled snapshots deferred to M0 — the M2-6 contract is ready for the worker.)

## Health snapshot (merged `main` + this PR)

- **Migrations:** 11, apply cleanly from scratch; no drift (M2-6 adds the `SnapshotGeneratedBy`/
  `FinancialSnapshotStatus` enums and the `FinancialSnapshot` table — envelope + versioned JSON payload +
  checksum — all additive, with RLS lockdown on the new table; M2-2…M2-5 unchanged).
- **Build:** 3/3 packages (incl. Next.js web) · **Lint:** 4/4 · **`@lcos/core`:** 60/60 · **API e2e:** 92/92 (13 suites).
- **Vercel:** web preview builds/deploys on `apps/web` changes (M2-6 builds a preview); skipped otherwise.
- `main` is deployable.

## What's next

Module 2 is **feature-complete**: accounts (M2-2), net worth (M2-3), cashflow/budget (M2-4), debt (M2-5), the
Balance Sheet UI (M2-7), and now the **Financial Snapshot kernel (M2-6)** — the canonical read model. The next
phase is **M3 (planning, scores & analysis)**, whose modules (Financial Health Score, retirement, goals, tax…)
**consume the Financial Snapshot** rather than raw tables (ADR-012, §10 extension points). Scheduled snapshot
capture (M2-8) is deferred to the M0 worker (the contract is ready). Awaiting owner approval to begin M3.
