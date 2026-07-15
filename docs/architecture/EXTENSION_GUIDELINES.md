# Life Capital OS V2 — Extension Guidelines for Future Modules

> **Permanent reference** for building Module 3+ on top of the Financial Kernel **without redesign**. Companion
> to [`FINANCIAL_KERNEL_ARCHITECTURE.md`](./FINANCIAL_KERNEL_ARCHITECTURE.md),
> [`M2_FINANCIAL_SNAPSHOT_CONTRACT.md`](./M2_FINANCIAL_SNAPSHOT_CONTRACT.md), and the normative
> [`FUTURE_MODULE_CONTRACT.md`](./FUTURE_MODULE_CONTRACT.md) (what a module may READ / must not WRITE). Includes
> the validation of every planned future module (§4) and **explicit per-module extension points (§7)**.

## 1. The extension contract (rules every new module follows)

1. **Consume the kernel, don't re-aggregate.** For any consolidated financial figure, read a
   `FinancialSnapshot` (`FinancialSnapshotService.latest()` / `getById()` / `timeline()`), or the live
   `/current` preview. **Never** re-query `Account`/`Transaction`/`Debt` to recompute net worth, cashflow,
   debt, or FX — it's already in the payload, in the household base currency.
2. **Own your storage, additively.** A new module gets its **own** household-scoped table(s) (its inputs,
   assumptions, results). Migrations are **additive** (new tables / nullable columns; RLS lockdown on new
   tables) — never reshape M2 tables (ADR-010).
3. **Household-scope everything.** Mount routes at `/api/households/:id/<module>` under `HouseholdScopeGuard`.
   Reads for any in-scope member; writes gated `@FirmRoles(OWNER, ADVISOR, SUPPORT)` (ANALYST read-only).
   Audit every mutation (`AuditService`).
4. **Put math in `@lcos/core`.** Pure, browser-safe functions (like `computeRetirement`, `planGoal`,
   `simulateDebtPayoff` already there); services convert FX via `FxService` and call core. No math in
   controllers or the browser.
5. **Need a field the payload lacks? Extend the contract additively.** Add an **optional** field to the
   payload under the same `schemaVersion`, or bump to `schemaVersion N+1` with an `upgradePayload` entry —
   **never** rewrite old snapshots, and **never** reach around the kernel into raw tables.
6. **AI stays snapshot-only** (see [`AI_INTEGRATION_ARCHITECTURE.md`](./AI_INTEGRATION_ARCHITECTURE.md)).

## 2. Standard shape of a new module (mirror the M2 engines)

```
apps/api/src/households/household-<module>.controller.ts   # thin, guarded, @FirmRoles on writes
apps/api/src/households/household-<module>.service.ts       # reads FinancialSnapshotService + FxService + @lcos/core
apps/api/src/households/household-<module>.dto.ts           # class-validator DTOs
packages/core/src/finance/<module>.ts                      # pure math (+ test in finance.test.ts)
apps/api/prisma/migrations/<ts>_add_<module>/migration.sql # additive + RLS lockdown on new tables
apps/web/src/app/app/households/[id]/<module>/page.tsx      # presentation-only (composes @/ui)
apps/api/test/household-<module>.e2e-spec.ts                # scope/role, multi-currency, immutability
```

Register the controller/service in `HouseholdsModule`; wire a chip on the household detail page. This is
exactly how M2-4/M2-5/M2-6 were added.

## 3. Available payload fields (`schemaVersion 1`) — the consumer surface

| Field | Contents |
| --- | --- |
| `netWorth` | `assetsMinor, liabilitiesMinor, netWorthMinor, solvencyRatio` |
| `assets[]` / `liabilities[]` | per-account: `accountId, name, assetClass?, entityId?, nativeCurrency, nativeBalanceMinor, baseBalanceMinor` |
| `debt` | `totalOutstandingMinor, totalMonthlyPaymentMinor, weightedAvgRatePct, debtCount, byType[]` |
| `cashflowSummary` | `period, incomeMinor, expenseMinor, netMinor, savingsRate, byCategory[]` |
| `budgetSummary` | `period, exists, totalBudgetMinor, totalSpentMinor, overTotal` |
| `assetAllocation[]` | `assetClass, baseValueMinor, pct` |
| `currencyExposure[]` | `currency, baseValueMinor, pct` |
| `householdEquity` | `netWorthMinor, totalDebtMinor, reconciledEquityMinor` |
| `entityHoldings[]` | per-entity: `entityId, assetsMinor, liabilitiesMinor, debtOutstandingMinor, netMinor` |
| `relationships` | `memberCount, entityCount, entityIds[], accountIds[]` |

All monetary values are **base-currency minor units**. Envelope adds `capturedAt`, `schemaVersion`,
`engineVersion`, `fxVersion`, `currency`, `checksum`, `status`.

## 4. Future-module validation

For each planned module: fields it consumes from the snapshot, additional snapshot fields it will eventually
need, and whether **today's** architecture supports it or needs an (additive) extension.

| Future module | Consumes (payload) | Additional snapshot fields eventually needed | Status |
| --- | --- | --- | --- |
| **Financial Health Score** | `netWorth.solvencyRatio`, `cashflowSummary.savingsRate`, `debt`, `assetAllocation`, `currencyExposure` | none | ✅ **Supported now** — pure function of one snapshot. **Recommended first M3 consumer.** |
| **Family Office Dashboard** | whole payload + `timeline()` | none | ✅ **Supported now** — reads latest snapshot + history directly. |
| **AI Wealth Advisor** | whole payload (+ envelope) | none (labels resolved separately) | ✅ **Supported now** — snapshot-grounded (see AI doc). |
| **What-if Scenarios** | any payload as base state (read-only) | none (deltas applied in-memory) | ✅ **Supported now** — scenario storage is the module's own. |
| **Risk Analytics** | `currencyExposure`, `assetAllocation`, `debt` (leverage), `householdEquity` | per-asset volatility/correlation → **market-data** (module's own, not kernel) | ✅ **Supported now** for exposure/leverage; deeper risk uses own market data. |
| **Forecasting** | `timeline()` (net worth / debt / savings series) + latest as start | more frequent periodic snapshots (scheduled capture, M0) | ✅ **Supported now**; richer accuracy improves with scheduled capture. |
| **Goal Planning** | `netWorth`, `cashflowSummary.savingsRate`, `assetAllocation` | none from kernel (goals are the module's own storage) | ✅ **Supported now** — `@lcos/core planGoal` exists; add a household `Goal` engine. |
| **Monte Carlo Simulation** | `netWorth`, `assetAllocation` (seed state) | assumption/volatility inputs → module config | ✅ **Supported now** — seeds from a snapshot; never mutates it. |
| **Retirement Planning** | `netWorth`, `cashflowSummary.savingsRate`, `assetAllocation`, `householdEquity` | **member ages / DOB** (payload has counts/ids, not demographics) | 🟡 **Minor extension** — add an additive `members` demographic summary to the payload, or read `HouseholdMember` alongside. `@lcos/core computeRetirement` exists. |
| **Insurance Analysis** | `cashflowSummary.incomeMinor`, `liabilities`, `debt`, `relationships` (dependents) | **dependent ages**; existing coverage (module's own) | 🟡 **Minor extension** — dependents' demographics (as above); `@lcos/core analyzeLifeInsuranceGap`/`emergencyFundTarget` exist. |
| **Estate Planning** | `entityHoldings`, `householdEquity`, `relationships`, `assets`/`liabilities` | **ownership %** / beneficiaries (multi-owner), trust structures, documents | 🟡 **Additive extension** — a `DebtOwner`/`AssetOwner` join for multi-owner (documented in M2-5 §3) + module storage; kernel base is sufficient. |
| **Tax Planning** | `cashflowSummary.byCategory` (income/expense mix), `debt`, `entityHoldings` | **deductible-interest flag** on debt; entity tax profiles; tax regime | 🟡 **Additive extension** — a `Debt.deductible` flag (noted M2-5 future) + tax metadata; both additive. |

**Summary:** **all twelve are supportable without redesign.** Seven are supported **today**; five need **small,
additive** extensions (member/dependent demographics into the payload; a multi-owner join; a
deductible-interest flag; scheduled capture for forecasting accuracy). **None** require changing an existing
table, breaking `schemaVersion 1`, or letting a consumer read raw tables.

## 5. Additive-extension playbook (when you do need a new payload field)

1. Add the field as **optional** in `packages/core/src/finance/financialSnapshot.ts`
   (`FinancialSnapshotPayload`). Consumers that don't need it ignore it.
2. Populate it in `HouseholdFinancialSnapshotService.compose()` by composing an **existing engine/service**
   (or a new engine you added) — never by re-aggregating raw tables a kernel already summarizes.
3. If the change is **breaking** (rename/remove/retype), bump `FINANCIAL_SNAPSHOT_SCHEMA_VERSION` and add an
   `upgradePayload(from, to)` entry; **do not** rewrite stored snapshots.
4. Add a core test (canonical/serialization) and an e2e test (composition + reproducibility).
5. Document the field in `M2_FINANCIAL_SNAPSHOT_CONTRACT.md` §3 and note the version in `PROJECT_MEMORY.md`.

## 6. Pre-Module-3 recommendations (carried from the system review)

Do these small, additive items before/early in M3 (details in
[`SYSTEM_ARCHITECTURE_V2.md`](./SYSTEM_ARCHITECTURE_V2.md) §9):

- Backfill `AuditLog.firmId` from metadata (compliance queries).
- Add `skip/take` pagination to account/transaction/debt lists (`{ total, data }`).
- Consider `Debt.accountId` so `householdEquity` reconciliation is exact.
- Ship **Financial Health Score** first — it validates the whole kernel contract with minimal surface.
- Land the **member-demographics** payload addition when Retirement/Insurance start (unblocks two modules at
  once).

## 7. Explicit extension points per named module

Each spec follows the same shape: **Reads** (snapshot fields it consumes), **Owns** (new household-scoped
tables it adds), **Core** (pure `@lcos/core` functions), **Payload extension** (additive field needed, if
any), **Route/UI**, **Status**. All follow the [`FUTURE_MODULE_CONTRACT.md`](./FUTURE_MODULE_CONTRACT.md):
read via `FinancialSnapshotService`, write only into own tables, never touch the kernel/engine data.

### Financial Health Score — ✅ supported today (recommended first M3 module)
- **Reads:** `netWorth.solvencyRatio`, `cashflowSummary.savingsRate`, `debt` (ratio vs `netWorth.assetsMinor`), `assetAllocation` (diversification), `currencyExposure`.
- **Owns:** `FinancialHealthScore` (householdId, snapshotId, score, subscores, computedAt).
- **Core:** new `computeFinancialHealthScore(payloadSubset)` — pure function of one snapshot.
- **Payload extension:** none.
- **Route/UI:** `GET/POST /households/:id/health-score`; a score card + history page.

### Family Office Dashboard — ✅ supported today
- **Reads:** whole payload + `timeline()`.
- **Owns:** none (pure read view) — optionally a `DashboardPreference`.
- **Core:** none (presentation).
- **Payload extension:** none.
- **Route/UI:** reads `latest` + `timeline`; a consolidated dashboard page.

### AI Wealth Advisor — ✅ supported today
- **Reads:** whole payload + envelope; grounds on a specific `snapshotId` (see [`AI_INTEGRATION_ARCHITECTURE.md`](./AI_INTEGRATION_ARCHITECTURE.md)).
- **Owns:** `AiConversation` / `AiRecommendation` (householdId, snapshotId, prompt, output).
- **Core:** none (LLM layer); recommendations are surfaced to humans, applied via normal write paths.
- **Payload extension:** none. Labels/PII resolved separately through the guarded decrypted boundary.
- **Route/UI:** `POST /households/:id/ai/*`; grounded chat/insights.

### What-if Scenarios — ✅ supported today
- **Reads:** any payload as the **base state** (read-only); applies hypothetical deltas in memory.
- **Owns:** `Scenario` (householdId, baseSnapshotId, deltas, results).
- **Core:** scenario transforms are pure functions over a payload; reuse `computeNetWorth`/`simulateDebtPayoff` etc.
- **Payload extension:** none (never mutates the base snapshot).
- **Route/UI:** `GET/POST /households/:id/scenarios`; scenario builder + compare.

### Risk Analytics — ✅ supported today (deeper risk uses own market data)
- **Reads:** `currencyExposure`, `assetAllocation`, `debt` (leverage = `debt.totalOutstandingMinor` / `netWorth.assetsMinor`), `householdEquity`.
- **Owns:** `RiskProfile` + optional `MarketData` (volatility/correlation — the module's own, not the kernel).
- **Core:** new `analyzeRisk(...)` (concentration, leverage, currency risk).
- **Payload extension:** none from the kernel; per-asset volatility is module-owned market data.
- **Route/UI:** `GET /households/:id/risk`; a risk panel.

### Forecasting — ✅ supported today (accuracy improves with scheduled capture)
- **Reads:** `timeline()` (net worth / debt / savings series) + `latest` as the starting state.
- **Owns:** `Forecast` (householdId, assumptions, projected series).
- **Core:** new `projectForecast(series, assumptions)`.
- **Payload extension:** none. Benefits from **scheduled snapshot capture** (M0 worker, deferred) for denser series.
- **Route/UI:** `GET/POST /households/:id/forecast`; projection chart.

### Goal Planning — ✅ supported today
- **Reads:** `netWorth.netWorthMinor`, `cashflowSummary.savingsRate`, `assetAllocation`.
- **Owns:** a household `Goal` engine (`Goal` rows: target, date, currentAmount, linked member/entity).
- **Core:** existing `planGoal` (already in `@lcos/core`).
- **Payload extension:** none (goals are the module's own storage). Optionally expose a `goalsSummary` in a future `schemaVersion` if dashboards want it consolidated.
- **Route/UI:** `GET/POST /households/:id/goals`; goal tracker.

### Monte Carlo Simulation — ✅ supported today
- **Reads:** `netWorth`, `assetAllocation` (seed state).
- **Owns:** `SimulationRun` (householdId, baseSnapshotId, params, distribution results).
- **Core:** new `runMonteCarlo(seed, params)` — pure; seeds from a snapshot, never mutates it.
- **Payload extension:** none from the kernel; volatility/return assumptions are module inputs.
- **Route/UI:** `POST /households/:id/simulations`; probability-of-success view.

### Retirement Planning — 🟡 minor additive extension
- **Reads:** `netWorth`, `cashflowSummary.savingsRate`, `assetAllocation`, `householdEquity`.
- **Owns:** `RetirementPlan` (householdId, memberId, targetAge, assumptions, projections).
- **Core:** existing `computeRetirement` / `financialFreedomNumber`.
- **Payload extension:** **member ages / DOB.** The payload has `relationships` (counts/ids) but not
  demographics. Add an additive `members[]` summary (`memberId, age|dateOfBirth, isDependent`) composed from
  `HouseholdMember` — additive to `schemaVersion 1` (optional field), unblocks Insurance too.
- **Route/UI:** `GET/POST /households/:id/retirement`.

### Insurance Analysis — 🟡 minor additive extension
- **Reads:** `cashflowSummary.incomeMinor`, `liabilities`, `debt`, `relationships` (dependents).
- **Owns:** `InsurancePolicy` (existing coverage) + computed coverage gap.
- **Core:** existing `analyzeLifeInsuranceGap` / `emergencyFundTarget`.
- **Payload extension:** **dependent demographics** — same additive `members[]` summary as Retirement.
- **Route/UI:** `GET/POST /households/:id/insurance`.

### Estate Planning — 🟡 additive extension
- **Reads:** `entityHoldings`, `householdEquity`, `assets`/`liabilities`, `relationships`.
- **Owns:** `EstatePlan`, `Beneficiary`, `TrustStructure`, plus a **multi-owner** join
  (`AssetOwner`/`DebtOwner`: entity/member ↔ asset with share %) — the extension noted in M2-5 §3.
- **Core:** estate roll-up helpers (pure).
- **Payload extension:** optionally an `ownership[]` breakdown once multi-owner exists (additive).
- **Route/UI:** `GET/POST /households/:id/estate`; documents attach via the Vault (M5).

### Tax Planning — 🟡 additive extension
- **Reads:** `cashflowSummary.byCategory` (income/expense mix), `debt`, `entityHoldings`.
- **Owns:** `TaxProfile` (regime, entity tax attributes), computed liability/optimizations.
- **Core:** existing `tax.ts` calculators.
- **Payload extension:** a **`Debt.deductible` flag** (additive column on M2-5 `Debt`, surfaced additively in
  `debt.byType` or a new `debt.deductibleInterestMinor`) + entity tax metadata (module-owned).
- **Route/UI:** `GET/POST /households/:id/tax`.

> Every extension above is **additive** (new tables / optional payload fields / additive columns) and obeys the
> [`FUTURE_MODULE_CONTRACT.md`](./FUTURE_MODULE_CONTRACT.md). None reshapes an M2 table, breaks `schemaVersion
> 1`, or reads raw tables to re-aggregate. The recurring **`members[]` demographic** addition unblocks
> Retirement **and** Insurance in one additive step.
