# Release — Life Capital OS V2 · Financial Kernel

> **Recommended tag:** `v2.0.0-financial-kernel` · **Line:** V2 (Family Wealth OS) · **Milestone:** Module 2
> complete · **Date:** 2026-07-15 · **State:** `main` clean, all Module 2 PRs merged, CI green, documentation
> complete.

---

## 1. Executive summary

Module 2 delivers the **Financial Kernel** of Life Capital OS V2 — the household financial engines (accounts,
net worth, cashflow, budget, debt) and, above them, the **immutable, versioned, checksummed Financial
Snapshot** that composes them into one **canonical read model**. This is the foundation the rest of the
platform is built on: every downstream module (scores, planning, AI, dashboards) **reads snapshots**, never
raw tables. The kernel is multi-currency, tenant-isolated, append-only, and reproducible by construction.

With this release the platform has a **stable financial contract** (`schemaVersion 1`) that future modules
depend on without coupling to internal schemas, and a complete permanent architecture blueprint (system,
kernel, AI, extension guidelines, governance, ADRs, onboarding).

## 2. Versioning choice — why `v2.0.0-financial-kernel`

Semantic Versioning `MAJOR.MINOR.PATCH[-prerelease]`:

- **`2` (MAJOR)** — the V2 line is a deliberate, breaking re-platform from the V1 retail app to a multi-tenant
  advisory product (firms → households, new tenancy, new data model). Major = 2.
- **`0.0`** — first stable cut of the V2 line's financial foundation; no prior 2.x public API to increment.
- **`-financial-kernel` (pre-release identifier)** — under SemVer, a `-suffix` denotes a **pre-release**:
  `2.0.0-financial-kernel` **precedes** a future `2.0.0` GA. That is intentional and honest: the **kernel** is
  complete and stable, but the **product** (Modules 3–8: planning, AI, vault, workflows, reporting, billing) is
  not — so we do **not** claim `2.0.0` GA yet. The label names the milestone this tag marks.

**Trade-off considered:** a bare `v2.0.0` would imply product GA (not reached); a `+financial-kernel` build-
metadata suffix wouldn't order as a milestone. The pre-release identifier is the correct SemVer expression of
"stable kernel, product still in progress." Subsequent milestones follow as `v2.0.0-<milestone>` until the
product reaches `v2.0.0`.

**How to cut the tag (after approval — not pushed by this change):**
```bash
git tag -a v2.0.0-financial-kernel <merge-commit> -m "Life Capital OS V2 — Financial Kernel (Module 2)"
git push origin v2.0.0-financial-kernel
```

## 3. Module 2 accomplishments (merged PRs)

| PR | Slice | Delivered |
| --- | --- | --- |
| #14 | M2-1 | FX conversion boundary in `@lcos/core` (`FxRateProvider`, `convertMinor`, `sumInBaseCurrency`) + M2 architecture reference + ADR-001…010 |
| #15 | M2-2 | Household Accounts — entity-owned, household-scoped CRUD; `Account` scope columns → relations; `userId` nullable |
| #16 | M2-3 | Household Net Worth — live consolidation + immutable `NetWorthSnapshot` + timeline; `FxService` (static/config) |
| #17 | M2-7 | Family Balance Sheet UI — reads immutable snapshots + accounts; no UI recompute |
| #18 | M2-4 | Cashflow & Budget engine — transaction ledger (single source of truth), summary/timeline, budget-vs-actual |
| #19 | M2-5 | Debt & Payoff engine — liability ledger + payments, summary/payoff (snowball/avalanche), immutable `DebtSnapshot` (ADR-011) |
| #20 | M2-6 | **Financial Snapshot kernel** — immutable, versioned, checksummed read model composing M2-2…M2-5 (ADR-012) |
| #21 | docs | Permanent V2 architecture blueprint (system, kernel, AI, extension guidelines, future-module contract, onboarding, consolidated ADR) |

**Verified health at release:** 11 migrations (clean `migrate reset`, **no drift**); build **3/3**; lint
**4/4**; `@lcos/core` **60/60**; API e2e **92/92** (13 suites); `main` deployable.

## 4. Financial Kernel overview

Five engines record facts; the kernel freezes them:

- **Accounts (M2-2)** — assets/liabilities, native currency, optionally entity-owned; basis of net worth.
- **Net Worth (M2-3)** — live consolidation (assets/liabilities/net worth/solvency) + immutable snapshots.
- **Cashflow & Budget (M2-4)** — the `Transaction` ledger (income/expense/transfer/adjustment) + budget-vs-actual.
- **Debt & Payoff (M2-5)** — detailed liability ledger + payments + payoff projection + immutable snapshots.
- **Financial Snapshot (M2-6)** — composes all of the above into one immutable, base-currency payload.

Detail: [`FINANCIAL_KERNEL_ARCHITECTURE.md`](../architecture/FINANCIAL_KERNEL_ARCHITECTURE.md),
[`SYSTEM_ARCHITECTURE_V2.md`](../architecture/SYSTEM_ARCHITECTURE_V2.md).

## 5. Major architectural decisions

- **Household as aggregate root** (ADR-001); one `HouseholdScopeGuard`, 404-not-403 (ADR-002).
- **FX only in the domain layer** — native at rest, convert at aggregation (ADR-003).
- **Immutable financial history** — snapshots append-only (ADR-004); append-only audit (ADR-005); encrypted
  PII (ADR-006).
- **Additive, backward-compatible migrations** — retail + advisory rows coexist (ADR-010).
- **Debt is a parallel ledger** to net-worth accounts; reconciled only in the kernel (ADR-011).
- **The snapshot is the canonical read model** — consumers/AI read snapshots, never raw tables (ADR-012).

Consolidated rationale: [`ADR-FINANCIAL-KERNEL.md`](../architecture/ADR-FINANCIAL-KERNEL.md).

## 6. Immutable snapshot model

- **Envelope:** `id`, `householdId`, `entityId?`, `capturedAt`, `snapshotVersion`, **`schemaVersion`**,
  `engineVersion`, `fxVersion`, `currency`, `generatedBy`, `checksum` (SHA-256 over **canonical** JSON),
  `status`, `provenance`, `payload`.
- **Payload (`schemaVersion 1`):** `netWorth`, `assets[]`, `liabilities[]`, `debt`, `cashflowSummary`,
  `budgetSummary`, `assetAllocation[]`, `currencyExposure[]`, `householdEquity`, `entityHoldings[]`,
  `relationships` (ids/counts only — **no PII**).
- **Guarantees:** append-only (no update/delete), reproducible (checksum + engine/FX versions), multi-currency
  resolved (base currency), reconciled (`householdEquity`). Proven by an e2e test asserting a stored snapshot
  is **byte-identical after later mutations**.

## 7. ADR summary

| ADR | Decision |
| --- | --- |
| 001 | Household is the aggregate root |
| 002 | `HouseholdScopeGuard` for tenant isolation (404-not-403) |
| 003 | FX conversion only inside the domain layer |
| 004 | Immutable financial snapshots (append-only) |
| 005 | Append-only audit log |
| 006 | Encryption-at-rest for sensitive PII |
| 007 | Small feature branches, one milestone per PR |
| 008 | Never merge without explicit approval |
| 009 | Keep `main` always deployable |
| 010 | Backward-compatible, additive migrations |
| 011 | Debt is a detailed ledger parallel to net-worth accounts |
| 012 | The Financial Snapshot is the canonical read model |

Full text: [`M2_HOUSEHOLD_WEALTH_ARCHITECTURE.md`](../architecture/M2_HOUSEHOLD_WEALTH_ARCHITECTURE.md) +
[`ADR-FINANCIAL-KERNEL.md`](../architecture/ADR-FINANCIAL-KERNEL.md).

## 8. Extension guidelines

Future modules follow [`EXTENSION_GUIDELINES.md`](../architecture/EXTENSION_GUIDELINES.md): consume the kernel
(don't re-aggregate), own their storage additively (RLS-locked, household-scoped), put math in `@lcos/core`,
and extend the payload only additively (`schemaVersion` discipline). Explicit per-module extension points
(§7 there) are documented for all named future modules.

## 9. Future Module Contract

Binding on all Module 3+ work: [`FUTURE_MODULE_CONTRACT.md`](../architecture/FUTURE_MODULE_CONTRACT.md) — the
exact READ allowlist (snapshot envelope + payload fields via `FinancialSnapshotService`) and WRITE prohibitions
(never touch `FinancialSnapshot` or any M2 engine table; write only own additive tables). See also §Governance
below and [`KERNEL_GOVERNANCE.md`](../architecture/KERNEL_GOVERNANCE.md).

## 10. Known limitations

- **`AuditLog.firmId`** is populated via `metadata`, not consistently in the dedicated column (backfill
  pending).
- **`snapshotVersion`** is a best-effort ordinal (no unique constraint); `capturedAt+id` is authoritative.
- **`householdEquity` reconciliation** assumes debts aren't also liability accounts (no `Debt↔Account` link).
- **No cursor pagination** yet on account/transaction/debt lists or snapshot `assets[]`/`liabilities[]`.
- **FX is static/config only** — `fxVersion` records the rate set, not a historical rate table.
- **Per-entity snapshots** are reserved (envelope `entityId`), not yet captured (household-level in v1).
- **PII** is intentionally absent from the payload (ids/counts only); label resolution is a separate read.

## 11. Future roadmap

- **M3 — Planning, scores & analysis** (next): Financial Health Score first (pure snapshot consumer),
  then retirement/goals/tax/insurance.
- **M4 — AI agent fleet** (snapshot-grounded, per the AI contract).
- **M5 — Document Vault** · **M6 — Tasks/workflows/notifications** (unlocks scheduled snapshot capture) ·
  **M7 — Reporting & client portal** · **M8 — Firm billing/compliance/admin**.
- **M0 — Foundation hardening** (Redis/jobs, storage, email, observability, key governance) — enables
  scheduled captures, live FX, and pruning.

## 12. Supported downstream modules

Validated to plug in **without kernel redesign** (see
[`EXTENSION_GUIDELINES.md`](../architecture/EXTENSION_GUIDELINES.md) §4/§7):

- **Supported today (read-only snapshot consumers):** Financial Health Score, Family Office Dashboard, AI
  Wealth Advisor, What-if Scenarios, Risk Analytics, Forecasting, Goal Planning, Monte Carlo.
- **Supported via small additive extensions:** Retirement Planning & Insurance Analysis (member/dependent
  demographics into the payload), Estate Planning (multi-owner join), Tax Planning (deductible-interest flag).

## 13. Deferred capabilities

- **Scheduled snapshot capture** (month/quarter/year-end) → M0 job worker (contract ready).
- **Material-event auto-capture** → M6 event bus (hook points exist).
- **Live / historical FX provider** → swap `FxService` provider (no call-site changes).
- **Snapshot retention / pruning policy** → post-M0.
- **Payload pagination** for very large books → a future additive `schemaVersion`.
- **Per-entity snapshots** → reserved envelope field.

## 14. Release notes

**Added:** household financial engines (accounts, net worth, cashflow, budget, debt), immutable snapshot series
(`NetWorthSnapshot`, `DebtSnapshot`, `FinancialSnapshot`), the canonical Financial Snapshot contract
(`schemaVersion 1`), FX consolidation across `INR/USD/EUR/GBP/AED/SGD`, advisor UI pages (balance sheet,
cashflow, debt, financial snapshot), and the permanent V2 architecture blueprint (system, kernel, AI,
extension guidelines, future-module contract, onboarding, governance, ADRs).

**Changed (additive, backward-compatible):** promoted advisory scope columns to relations; relaxed
`userId` to nullable on advisory tables; extended `TransactionType` (+`adjustment`), `DebtType`
(+`business_loan`); added lifecycle/provenance columns. **No breaking schema changes.**

**Security:** RLS lockdown on every new table; `HouseholdScopeGuard` (404-not-403); write gate
`OWNER/ADVISOR/SUPPORT` (ANALYST read-only); append-only audit; encrypted PII; checksum tamper-evidence.

**Compatibility:** `schemaVersion 1` is now a **stable contract** — see Governance. Migrations are additive
and verified drift-free.

**Verification:** build 3/3 · lint 4/4 · `@lcos/core` 60/60 · API e2e 92/92 · 11 migrations, no drift.
