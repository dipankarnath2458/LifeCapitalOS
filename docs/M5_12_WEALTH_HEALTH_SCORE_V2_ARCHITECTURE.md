# M5.12 — Wealth Health Score v2: protection and retirement count

> **Model version:** `fhs-1.0.0` → **`fhs-2.0.0`**.
> **Scope:** a deliberate scoring-model change. **No migration. No kernel contract change.**
> Follows the boundary set in `docs/M5_12_SCORING_CHECKPOINT.md`.

---

## 1. The defect

A family can be entirely uninsured and badly behind on retirement and still score 90.

The score has weighted exactly five categories since M3-1 — net worth, debt, savings, liquidity,
diversification — and both M5.9 and M5.10 measured the consequence rather than fixing it:
recording no insurance at all moved the score 90 → 90. It is the largest remaining honesty gap in
the product's headline number, and since M5.9 and M5.10 there is finally real data behind both.

## 2. The decision that shapes everything: only score what the family told us

The tempting implementation scores protection as zero when a household has recorded nothing. That
is the **#67 defect wearing a different hat** — asserting an absence we were never told, except
this time it would lower the number the family is judged by.

So: **a category is scored only when its facts are known. Otherwise it is omitted.**

The aggregation already supports this exactly. `computeFinancialHealthScore` divides by the weight
of the categories it actually produced:

```ts
const totalWeight = categories.reduce((s, c) => s + c.weight, 0);
const overall = round(Σ(score × weight) / (totalWeight || 1));
```

Omitting a category renormalises the rest — no special case, no zero, no invented fact.

## 3. The weights, and why an unchanged family's score does not move

The five existing categories are scaled by **0.7**, and the 30 points released are split evenly
between the two new ones:

| Category | `fhs-1.0.0` | `fhs-2.0.0` |
|---|---|---|
| Net Worth & Solvency | 25 | **17.5** |
| Debt Burden | 25 | **17.5** |
| Savings | 20 | **14** |
| Emergency Liquidity | 20 | **14** |
| Diversification | 10 | **7** |
| **Protection** | — | **15** |
| **Retirement** | — | **15** |
| Total | 100 | 100 |

Scaling all five by the *same* factor buys a property worth having. For a household that has
recorded neither protection nor retirement, both new categories are omitted, and renormalising the
remaining 70 restores the original proportions exactly:

```
Σ(score × 0.7·w₀) / 70  ≡  Σ(score × w₀) / 100
```

**Their score under `fhs-2.0.0` is identical to `fhs-1.0.0`, to the integer.** Only families who
have actually told us about their cover or their retirement plan see a change — which is the
honest place for a change to appear. This is asserted as a test, not just claimed.

`protection: 15` / `retirement: 15` is the tunable product decision in this milestone. For
reference, V1's separate engine (`core/scoring/scores.ts`) weights protection at 20. The model is
data — changing the split is an edit to `DEFAULT_FINANCIAL_HEALTH_MODEL` plus a version bump, not
a change to any logic.

## 4. How the new facts reach the scorer — one path, no second loader

The scorer took only `(payload, model)`, and protection and retirement are **not in the payload**
— the snapshot contract is frozen, and neither is a kernel fact. They are module-owned
assumptions, resolved from the Protection and Retirement stores.

```
Protection / Retirement stores
  └─ HouseholdAssumptionsService.resolve(householdId)     ← extracted in this milestone
      └─ deriveHealthFacts(payload, assumptions)          ← @lcos/core, composes existing calculators
          └─ computeFinancialHealthScore(payload, model, facts)
```

Three deliberate choices:

1. **`HouseholdAssumptionsService` is extracted** from `HouseholdIntelligenceService`. Two
   services now need module-owned assumptions, and "every caller must remember" is precisely the
   M5.9 defect. One loader, two consumers, nothing to forget.
2. **`deriveHealthFacts` lives in core and invents no maths.** It composes
   `analyzeLifeInsuranceGap` and `computeRetirement` — the same functions the intelligence layer
   already uses — and returns scalars. The scorer performs no finance of its own.
3. **The scorer stays pure.** `(payload, model, facts) → score`, deterministic, no IO.

## 5. Unknown, per category

| Situation | Protection | Retirement |
|---|---|---|
| Nothing recorded | omitted | omitted |
| Recorded | scored | scored |
| Recorded, but no income and no dependants | omitted — there is nothing to protect against | — |
| A plan exists but no contribution stated | — | scored on corpus alone; the projection is not invented |

**Retirement is scored only when the family has stated a plan.** The intelligence layer falls back
to documented default assumptions (retire at 60, 25 years, 6% inflation…) so it can always show
*something*; scoring a family's headline number against assumptions they never gave us — and
lowering it — is a different matter entirely. Defaults inform; they do not judge.

## 6. The metrics

**Protection** — two sub-scores, averaged, each dropped when unknown:
- *Cover ratio*: existing term cover ÷ recommended cover from `analyzeLifeInsuranceGap`
  (15× income + liabilities with dependants, 10× without). Anchors 0 → 0, 1 → 100.
- *Health insurance*: stated yes → 100, stated no → 0.

**Retirement** — readiness: projected corpus at retirement ÷ required corpus, from
`computeRetirement`. Anchors 0 → 0, 1 → 100. Uses the projection including contributions when the
family has stated one, so the measure reflects the trajectory they are actually on.

## 7. Double counting — named, bounded, not eliminated

The checkpoint flagged this and it is real: retirement readiness is derived from investable assets,
which `net_worth` already scores. A family with a large corpus gains in both places.

What this milestone does about it:

- **Goals stay out of the score.** They are an intention, and they remain a risk signal (M5.11).
  Scoring them would have been the third derivation of the same assets.
- **Protection is restricted to insurance cover.** It does not fold in the emergency fund, which
  `liquidity` already scores.
- **Retirement is weighted at 15, not higher**, precisely because part of it is already counted.
- The overlap is documented here rather than hidden. Eliminating it entirely would mean scoring
  retirement on contribution behaviour alone, which would tell a family with a full corpus and no
  monthly SIP that they are failing. That is worse.

## 8. The version boundary in the score history

`HouseholdHealthScoreService.timeline()` returns every stored score with its `scoreModelVersion`,
oldest→newest, and nothing marks where the model changed. After this milestone a family's line
will step — and read as a change in their finances rather than a change in what we measure.

Stored scores are immutable records and are **not** recomputed. Instead the timeline is now
explicit about the boundary: each point carries `modelVersion`, and the first point under a new
version is flagged `modelChanged: true` so a chart can break or annotate the line rather than
drawing a continuous one across two definitions.

## 9. Tests rewritten on purpose

The M5.11 pins existed to make this change deliberate. They fired:

| Test | Change |
|---|---|
| *"scores exactly five categories, with these weights"* | now pins seven and the new weights |
| *"does NOT score protection or retirement"* | inverted — it now pins that they ARE scored |
| *"pins the model version"* | `fhs-2.0.0` |
| *"weights sum to 100"* | unchanged, and still passing — the re-weighting is arithmetically sound |

New pins: the renormalisation identity (§3), unknown-is-omitted-not-zero (§2), each new category
moving the score in the right direction, and simulation deltas staying honest.

## 10. What this milestone does NOT do

- **No migration**, no schema change, no kernel contract change.
- **Does not recompute or rewrite stored scores.** History stays as it was recorded.
- **Does not change the Financial Snapshot.**
- **Does not score goals.**
- **Does not change the bands** (`at_risk` < 40 ≤ `needs_attention` < 60 ≤ `fair` < 75 ≤ `good`
  < 90 ≤ `excellent`). One redefinition at a time.
