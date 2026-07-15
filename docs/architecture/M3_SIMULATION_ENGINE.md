# M3-3 — Financial What-if Simulation Engine — Design

> **Status:** Proposed (design + implementation in this PR). **Module:** M3-3. **Depends on:** M2-6
> (`FinancialSnapshot`, read-only), M3-1 (`computeFinancialHealthScore`), M3-2 (`explainFinancialHealth`).
> **Governed by:** [`FUTURE_MODULE_CONTRACT.md`](./FUTURE_MODULE_CONTRACT.md),
> [`KERNEL_GOVERNANCE.md`](./KERNEL_GOVERNANCE.md). **Additive only. No kernel/schema change. No persistence.
> No mutation of household data. Reuses the existing scoring + explanation, never re-implements them.**

## 1. Objectives

A reusable, pure **What-if Simulation Engine**: apply hypothetical financial decisions to an **immutable
Financial Snapshot** and show the effect on the household's Financial Health Score — **without touching
production data**. It answers, like an advisor: *what changed, why, which categories improved or weakened, by
how many points, the estimated financial impact, the highest-priority recommendation, and which single action
gives the biggest score gain.*

## 2. Guiding principles

- **Snapshot-driven & immutable.** Every simulation starts from an immutable snapshot payload (M2-6). The
  engine builds a **virtual (in-memory) snapshot**; it never writes, never persists, never mutates the kernel.
- **Reuse, don't duplicate.** Scoring is the M3-1 `computeFinancialHealthScore`; explanation is the M3-2
  `explainFinancialHealth`. The engine only **transforms a payload** and **diffs** results.
- **Pure & deterministic.** `simulate(payload, request)` is a pure function — same inputs ⇒ identical result.
  No IO, clock, randomness, or LLM.
- **Explainable.** The result is structured advisor output (category-by-category deltas + recommendations),
  not a bare number.
- **Extensible.** New scenario types register into a **scenario registry** without changing the engine.
- **Additive & backward-compatible.** New core module + new read-only API + optional UI. Nothing existing
  changes.

## 3. Domain model

```ts
type ScenarioType =
  | 'repay_debt' | 'increase_emergency_fund' | 'increase_sip' | 'buy_asset' | 'sell_asset'
  | 'reallocate' | 'increase_savings' | 'reduce_expenses' | 'improve_insurance'
  | 'retirement_contribution' /* …future */;

interface SimulationScenario { type: ScenarioType; params: Record<string, number | string>; label?: string; }

interface SimulationRequest {          // API adds the baseline selector (snapshotId?) at the service layer
  scenarios: SimulationScenario[];
}

interface CategoryImpact {             // one per health-score category
  key: string; label: string;
  before: number; after: number; delta: number;        // sub-score points
  bandBefore: string; bandAfter: string;
  direction: 'improved' | 'weakened' | 'unchanged';
}

interface RecommendationImpact {       // the advisor's next-best-actions (from the virtual explanation)
  id: string; title: string; affectedCategory: string;
  priority: string; estimatedScoreImprovement: number;
  financialImpact: { summary: string; gapMinor: number | null };
  recommendedAction: string; reasonCode: string;
}

interface ScenarioSummary {
  overallBefore: number; overallAfter: number; overallDelta: number;
  bandBefore: string; bandAfter: string;
  improved: string[]; weakened: string[];              // category keys
  narrative: string;                                   // deterministic advisor sentence
}

interface BestSingleAction {           // which one requested scenario alone helps most
  scenario: SimulationScenario; overallDelta: number; narrative: string;
}

interface SimulationMetadata {
  snapshotId: string; scoreModelVersion: string; simulationEngineVersion: string;
  scenarioTypes: ScenarioType[]; deterministic: true;
}

interface SimulationResult {
  metadata: SimulationMetadata;
  summary: ScenarioSummary;
  categoryImpacts: CategoryImpact[];
  topRecommendation: RecommendationImpact | null;      // highest priority after the change
  recommendations: RecommendationImpact[];
  bestSingleAction: BestSingleAction | null;           // greatest score improvement from a single action
}
```

## 4. Supported scenario types

Each is a **pure transform** `(payload, params) → payload` that adjusts *primitive* fields (asset balances,
liability balances, `debt` totals, `cashflowSummary.income/expense`); the engine then **re-derives** the
consumed aggregates (net worth, allocation, currency exposure, household equity, savings rate) so the virtual
payload is internally consistent for scoring. All amounts are **base-currency minor units** (the snapshot is
already base-normalized — no FX). Reductions clamp at 0 (can't sell/repay more than held/owed).

| Type | Params | Effect on the virtual snapshot |
| --- | --- | --- |
| `repay_debt` | `amountMinor` | cash −a; `debt.totalOutstanding` −a; `debt.totalMonthlyPayment` −pro-rata. (reconciled equity preserved; leverage ↓, liquidity ↓) |
| `increase_emergency_fund` | `amountMinor`, `fromClass='equity'` | move a from an investment class to cash (liquidity ↑, diversification shifts) |
| `buy_asset` | `assetClass`, `amountMinor`, `fromClass='cash'` | fromClass −a; assetClass +a (allocation shift) |
| `sell_asset` | `assetClass`, `amountMinor`, `toClass='cash'` | assetClass −a; toClass +a |
| `reallocate` | `fromClass`, `toClass`, `amountMinor` | fromClass −a; toClass +a (diversification/currency) |
| `reduce_expenses` | `monthlyAmountMinor` | expense −m (savings rate ↑) |
| `increase_savings` | `monthlyAmountMinor` | expense −m and cash +m (savings ↑, liquidity ↑) |
| `increase_sip` | `monthlyAmountMinor`, `assetClass='equity'` | expense −m and assetClass +m (savings ↑, allocation → equity) |
| `retirement_contribution` | `monthlyAmountMinor`, `assetClass='equity'` | as `increase_sip`, tagged retirement |
| `improve_insurance` | `monthlyPremiumMinor` | expense +premium. **Note:** insurance is not yet a scored category (`fhs-1.0.0`), so this currently costs savings; documented as an extension point — adding an insurance category to a future `scoreModelVersion` makes it improve the score. |

## 5. Simulation pipeline

```
Immutable Financial Snapshot (M2-6, read-only)
        ↓                       baseline payload
Scenario Builder  ── applies registered transforms (pure) ──►  Virtual Snapshot (in-memory, never persisted)
        ↓
Financial Health Score  ── M3-1 computeFinancialHealthScore(virtual) ──►  virtual score
        ↓
Explainable Health Engine ── M3-2 explainFinancialHealth(virtual score, virtual payload) ──►  virtual explanation
        ↓
Diff vs baseline (score + per-category)  ──►  Simulation Result (category impacts, recommendations, best action)
```

- **Baseline** = `computeFinancialHealthScore(baselinePayload)`; **virtual** = same function on the virtual
  payload. The engine reuses M3-1/M3-2 verbatim — it does not compute scores itself, only builds payloads and
  diffs.
- **Best single action** = for each requested scenario, simulate it **alone** and pick the max `overallDelta`
  (pure, deterministic).

## 6. Extension points

- **Scenario registry.** `DEFAULT_SCENARIO_REGISTRY: Record<ScenarioType, ScenarioTransform>`. A future module
  adds a scenario by providing a transform and passing an **extended registry** to `simulate(payload, request,
  { registry })` — **the engine code never changes** (open/closed).
- **Reused by later modules:** **Monte Carlo** (run many parametrised simulations over a snapshot), **Forecasting**
  (chain simulations across periods), **AI Wealth Advisor** (propose scenarios, narrate results). All are
  snapshot-only consumers of this engine.
- **Scoped scoring model:** simulations accept an optional `scoreModel` so a future `scoreModelVersion` (e.g.
  adding an insurance category) flows through without engine changes.

## 7. API design

Household-scoped under `HouseholdScopeGuard`; **read-only / non-mutating** (nothing persists), so available to
any in-scope member (incl. analyst). 404 out-of-scope.

| Method & path | Purpose |
| --- | --- |
| `POST /households/:id/simulation` | Body `{ snapshotId?, scenarios[] }`. Runs the simulation against the latest (or given) immutable snapshot; returns `SimulationResult`. Persists nothing. `{ available:false }` if no snapshot. |
| `GET /households/:id/simulation/scenario-types` | Lists supported scenario types + their param keys (UI discoverability). Static, deterministic. |

`POST` is used only to carry the structured scenario body — it is **not** a write. Every response includes
`snapshotId`, `scoreModelVersion`, `simulationEngineVersion`.

## 8. UI flow

Route `/app/households/[id]/simulation` (advisor workspace, presentation-only):
1. Pick one or more **scenarios** (type + amount) from the supported list.
2. **Run** → the page calls `POST …/simulation`.
3. Show **before → after** overall score (with band), a **category impact** table (▲/▼ with point deltas),
   the **best single action**, and the **top recommendation**. No simulation math in the browser.
Empty state prompts to capture a Financial Snapshot first.

## 9. Validation rules

- `scenarios` non-empty; each `type` ∈ registry; unknown type → 400.
- Amounts are non-negative integers (minor units); `assetClass`/`fromClass`/`toClass` ∈ the allowed set;
  `reallocate` requires `fromClass ≠ toClass`.
- Reductions **clamp at 0** (cannot sell/repay/spend beyond what exists) — deterministic, documented.
- A snapshot must exist for the household; otherwise `{ available:false, reason }`.
- The engine ignores unknown params defensively and never throws on in-range inputs.

## 10. Security model

- **Tenant isolation:** every route `HouseholdScopeGuard`-gated; out-of-scope → 404. Reads the immutable
  snapshot via the kernel service only.
- **No mutation, no persistence:** the engine builds an in-memory virtual payload; nothing is written to any
  table (no migration, no schema change). Household data is never altered.
- **RBAC:** non-mutating, so any in-scope member may simulate (incl. `ANALYST`). No new roles.
- **No PII:** the result carries ids, amounts, category keys, and templated text only.
- **Audit:** none required (no mutation); consistent with other read endpoints.

## 11. ADR

No kernel, schema, scoring, or explanation change is introduced, so **no kernel ADR is required** (per
`KERNEL_GOVERNANCE` G-5). This PR adds **ADR-013** to record the **virtual-snapshot simulation pattern**
(transient, in-memory, non-persisted payload transforms scored by reusing M3-1/M3-2) as the additive,
reusable foundation for Monte Carlo / Forecasting / What-if — a new *pattern*, not a kernel change.

## 12. Testing

- **Core:** determinism (same request ⇒ identical result); each scenario moves the expected category in the
  expected direction (repay_debt → debt_burden ↑; increase_emergency_fund → liquidity ↑; reduce_expenses →
  savings ↑; reallocate → diversification change); clamping (over-repay/over-sell); baseline unchanged
  (engine returns a new payload, input not mutated); best-single-action selects the max; unknown scenario
  rejected; multi-scenario composition.
- **API e2e:** scope gating (analyst may simulate, outsider 404); `{available:false}` before a snapshot; a
  scenario improves overall vs baseline; `scenario-types` lists the set; nothing persisted (a later snapshot/
  score read is unchanged).
