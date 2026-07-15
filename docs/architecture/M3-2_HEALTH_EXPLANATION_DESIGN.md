# M3-2 — Explainable Financial Health Engine — Design

> **Status:** Proposed (design + implementation in this PR). **Module:** M3-2. **Depends on:** M3-1
> (`FinancialHealthScore`), M2-6 (`FinancialSnapshot`, read-only). **Governed by:**
> [`FUTURE_MODULE_CONTRACT.md`](./FUTURE_MODULE_CONTRACT.md), [`KERNEL_GOVERNANCE.md`](./KERNEL_GOVERNANCE.md).
> **Additive only. No kernel change. No snapshot-schema change. No DB schema change. Does not recompute or
> redesign the M3-1 scoring logic.**

## 1. Objective

Turn the Financial Health Score into an **Explainable Financial Health Engine**: for any score, deterministically
answer *why is the score what it is, which categories helped or hurt, the impact of each weakness, what to do,
how much each action would improve the score, and which action matters most* — as a **structured payload future
AI modules can consume**. No LLM, no generation, no persistence.

The explanation layer **only consumes an existing `FinancialHealthScore`** (produced by M3-1) plus its immutable
`FinancialSnapshot` (for financial-impact context). **It never calculates a score.**

## 2. Boundaries (what this is NOT allowed to do)

- ❌ Recompute or re-derive the score (must consume the M3-1 result).
- ❌ Modify the Financial Kernel, the snapshot schema, or the M3-1 scoring model/logic.
- ❌ Add or change any database table (explanations are computed on read, **not stored**).
- ❌ Call an LLM or any non-deterministic source.
- ✅ Add a **pure** `@lcos/core` function + a new **read-only** API surface that composes M3-1 + M2-6.

## 3. Inputs

- **`FinancialHealthScore`** (from M3-1): `overall`, `band`, `modelVersion`, `categories[]` (each: `key`,
  `label`, `weight`, `score`, `band`, `metric`, `reason`, `suggestion`), `drivers`.
- **`FinancialSnapshotPayload`** (from M2-6, immutable): used **only** for financial-impact context (e.g. the
  cash gap to a target liquidity), never to score.

The engine reads `categories[].weight` and `categories[].score` directly — it does **not** need the scoring
anchors, so it structurally cannot re-score.

## 4. Output — `HealthExplanation`

```jsonc
{
  "overall": 78, "band": "good", "modelVersion": "fhs-1.0.0",
  "summary": "Financial health is good at 78/100. Strongest: Debt Burden. Most impactful weakness: Diversification (−4.5 pts).",
  "categoryBreakdown": [
    { "key": "diversification", "label": "Diversification", "weight": 10, "score": 55, "band": "needs_attention",
      "pointsContributed": 5.5, "pointsLost": 4.5 }
    // … one per category
  ],
  "strengths": [ { "key": "debt_burden", "label": "Debt Burden", "score": 88, "reasonCode": "STRONG_DEBT_BURDEN" } ],
  "weaknesses": [ { "key": "diversification", "label": "Diversification", "score": 55, "impact": 4.5, "reasonCode": "HIGH_CONCENTRATION" } ],
  "recommendations": [
    {
      "id": "rec_diversification",
      "title": "Diversify across more asset classes",
      "description": "68% of assets sit in a single class, concentrating risk.",
      "affectedCategory": "diversification",
      "priority": "high", "priorityRank": 1,
      "estimatedScoreImprovement": 3.5,
      "financialImpact": { "summary": "Rebalance toward target weights", "gapMinor": null },
      "recommendedAction": "Spread holdings across equity, debt, gold and cash toward target weights.",
      "reasonCode": "HIGH_CONCENTRATION"
    }
  ],
  "priorityRanking": [ { "rank": 1, "affectedCategory": "diversification", "reasonCode": "HIGH_CONCENTRATION", "estimatedScoreImprovement": 3.5 } ],
  "potentialScoreImprovement": 9,   // capped so overall + improvement ≤ 100
  "potentialOverall": 87,
  "confidence": 0.9,                 // data-completeness of the underlying snapshot
  "reasonCodes": ["STRONG_DEBT_BURDEN", "HIGH_CONCENTRATION", "LOW_SAVINGS_RATE"]
}
```

Every **recommendation** carries: `title`, `description`, `affectedCategory`, `priority`, (`priorityRank`),
`estimatedScoreImprovement`, `financialImpact`, `recommendedAction`, `reasonCode`.

## 5. Deterministic method (answers the 8 questions)

Let `W = Σ weight` over categories (from the score itself).

1. **Why the score?** `summary` + `categoryBreakdown`, where each category's `pointsContributed = score·weight/W`
   and `pointsLost = (100−score)·weight/W`.
2. **Which categories reduced it?** `weaknesses` = categories with `score < 75`, sorted ascending by score, each
   with `impact = pointsLost`.
3. **Which are strongest?** `strengths` = categories with `score ≥ 75`, sorted descending, `reasonCode STRONG_*`.
4. **Impact of each weakness?** `impact = pointsLost` (overall points that category costs).
5. **Recommended action?** a deterministic per-category template (`recommendedAction`, `title`, `description`)
   keyed by `category.key` + band; `financialImpact.gapMinor` derived from the snapshot when computable
   (liquidity, savings, debt); `null` otherwise (net worth, diversification).
6. **Estimated improvement?** `estimatedScoreImprovement = max(0, TARGET − score)·weight/W`, `TARGET = 90`
   (raise a weak category to "strong"). This is a **projection on the existing sub-score**, not a re-score.
   `potentialScoreImprovement = min(100 − overall, Σ improvements)`; `potentialOverall = overall + that`.
7. **Highest priority?** recommendations ranked by `estimatedScoreImprovement` desc → `priorityRank`,
   `priority` level (`high ≥ 5`, `medium ≥ 2`, else `low`); `priorityRanking[0]` is the top action.
8. **AI-consumable payload?** the whole `HealthExplanation` + `reasonCodes[]` (stable enum-like codes) — a
   structured, deterministic grounding object (AI reads it; it is not produced by AI).

**Confidence** = data completeness of the snapshot (deterministic): start 1.0; −0.2 `NO_INCOME_DATA` (income 0),
−0.15 `NO_EXPENSE_DATA` (expense 0), −0.2 `NO_ASSET_DATA` (no assets); clamp ≥ 0. It qualifies how much the
explanation can be trusted, without touching the score.

## 6. Reason codes (stable, enum-like)

`STRONG_<CATEGORY>` (strengths); weaknesses: `WEAK_SOLVENCY` / `NEGATIVE_NET_WORTH`, `HIGH_DEBT_BURDEN`,
`LOW_SAVINGS_RATE`, `INSUFFICIENT_EMERGENCY_FUND`, `HIGH_CONCENTRATION`; data: `NO_INCOME_DATA`,
`NO_EXPENSE_DATA`, `NO_ASSET_DATA`. Codes are the AI/automation contract — additive only.

## 7. API contract (read-only, additive)

Household-scoped under `HouseholdScopeGuard`; **all GET** (any in-scope member; no writes, nothing persisted).
Mounted under a distinct sub-path so it never collides with M3-1 routes.

| Method & path | Purpose |
| --- | --- |
| `GET /households/:id/health-score/explanation/current` | Explain the **live** current score (optional `?snapshotId=`). |
| `GET /households/:id/health-score/explanation/latest` | Explain the **latest persisted** score. |
| `GET /households/:id/health-score/explanation/:scoreId` | Explain a **specific persisted** score. |

Each obtains the score from the M3-1 service (`current`/`latest`/`getById`) — the explanation layer does **not**
compute it — fetches the referenced immutable snapshot from the kernel for context, and returns the
`HealthExplanation`. Returns `{ available: false }` when no snapshot/score exists.

## 8. Architecture & boundaries

- **Core:** `@lcos/core/finance/financialHealthExplanation.ts` — pure `explainFinancialHealth(score, payload)`.
- **API:** `HouseholdHealthExplanationService` depends only on `HouseholdHealthScoreService` (read score) +
  `HouseholdFinancialSnapshotService` (read snapshot) — never on engine repos, never on Prisma writes. A new
  `HouseholdHealthExplanationController`. **M3-1 files are untouched** except module registration.
- **No storage:** explanations are derived on read; nothing new persists → **no migration, no schema change**.

## 9. Testing

- **Core unit tests:** determinism (same inputs ⇒ identical explanation); strengths/weaknesses partition at 75;
  `pointsContributed + pointsLost == weight·100/W` per category; priority ordering by improvement;
  `potentialOverall ≤ 100`; confidence reductions + reason codes; recommendations only for weak categories;
  every recommendation has all required fields.
- **API e2e:** scope/role (reads open to in-scope members incl. analyst; out-of-scope 404); `current` vs
  `:scoreId`; `{available:false}` before any snapshot; explanation matches the score it explains.

## 10. Extension points

- New `reasonCode`s and per-category recommendation templates are additive.
- The `HealthExplanation` is the grounding contract for the **AI Wealth Advisor** (M4) — it narrates this
  payload; it never regenerates the numbers.
- A future `explanationVersion` can be stamped if templates change materially (mirrors `scoreModelVersion`
  discipline), without altering stored scores.
