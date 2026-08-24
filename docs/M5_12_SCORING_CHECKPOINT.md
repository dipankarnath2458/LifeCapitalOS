# Architecture checkpoint before M5.12 — Wealth Health Score v2

> **Status: SUPERSEDED — M5.12 is implemented.** This document is kept as the record of what was
> known *before* the milestone, and of the design boundary it was held to. The decisions it
> recommended were followed; see `docs/M5_12_WEALTH_HEALTH_SCORE_V2_ARCHITECTURE.md` for what was
> actually built, and note that §1–§3 below describe `fhs-1.0.0`, which is now history.
> **Written at:** `8de6932` (M5.11 merged into the working branch, not yet into `main`).
> Every figure below was read from source at that commit, not from memory or a roadmap.

---

## 1. Current score categories

`packages/core/src/finance/financialHealth.ts:41-49` — exactly five:

| Key | Label |
|---|---|
| `net_worth` | Net Worth & Solvency |
| `debt_burden` | Debt Burden |
| `savings` | Savings |
| `liquidity` | Emergency Liquidity |
| `diversification` | Diversification |

## 2. Current weights

| Category | Weight |
|---|---|
| `net_worth` | 25 |
| `debt_burden` | 25 |
| `savings` | 20 |
| `liquidity` | 20 |
| `diversification` | 10 |
| **Total** | **100** |

## 3. Current score version

`FINANCIAL_HEALTH_MODEL_VERSION = 'fhs-1.0.0'` (`financialHealth.ts:11`).

It is **persisted per score**, not merely computed: `FinancialHealthScore.scoreModelVersion`
(`schema.prisma:469`), alongside `overall`, `band`, `categories` and `drivers`. Stored rows are
historical records — a model change does **not** rewrite them.

## 4. What M5.11 does

- `HouseholdGoalsService.assumptionsFor(householdId)` returns per-goal slippage in `[0,1]`, or
  `undefined` when the household has no goals.
- `HouseholdIntelligenceService.resolveAssumptions()` loads it alongside insurance and retirement,
  so no call site can forget it.
- The layer passes it to `EarlyWarningInput.goalSlippage`, producing the **Goal Progress** signal
  (bands: ≥0.15 yellow, ≥0.30 red) in `intelligence.risk`.
- The slippage definition lives once, in `@lcos/core` (`planGoalAsOf`), and all three call sites —
  retail goals list, retail early-warning input, household goals — use it.
- `GET /households/:id/goals` returns an additive `plan` per goal; the web renders it and computes
  nothing.

## 5. What M5.11 deliberately does NOT do

- **Does not touch the Wealth Health Score.** `financialHealth.ts` is untouched on this branch.
- **Does not touch the Financial Snapshot.** `financialSnapshot.ts` and `kernelContract.test.ts`
  are untouched; `snapshot.payload.goals` is still `undefined`, asserted by e2e.
- **No migration.** The migrations tree is byte-identical to `main`.
- **Does not alter Protection or Retirement.** No file of either was modified.
- **Does not make "no goals" look like "on track"** — `undefined`, never `[]`.

## 6. How Goals currently enter Financial Intelligence

```
Goal rows (household-scoped)
  └─ HouseholdGoalsService.assumptionsFor()      // planGoalAsOf → slippage[]; undefined if none
      └─ HouseholdIntelligenceService.resolveAssumptions()
          └─ IntelligenceAssumptions.goals.slippage
              └─ EarlyWarningInput.goalSlippage   // only when non-empty
                  └─ computeEarlyWarning → signal 'goal_slippage'
                      └─ intelligence.risk.topRisks   (and, via `risk`, the AI coach)
```

Goals are an **assumption**, not a kernel fact. They never enter the immutable snapshot.

## 7. What M5.12 will need to change

1. **Add categories to `DEFAULT_FINANCIAL_HEALTH_MODEL`** and **re-weight the existing five** —
   weights must still total 100, so adding protection and retirement necessarily *takes weight
   away* from net worth, debt, savings, liquidity and diversification. That is the product
   decision, not the code.
2. **Bump `FINANCIAL_HEALTH_MODEL_VERSION`** (`fhs-2.0.0`).
3. **Add anchors** for the new categories — the model is anchor-interpolated, so each new category
   needs an explainable scale, not just a weight.
4. **Feed the new inputs.** Protection and retirement already reach the layer as assumptions; the
   score function currently receives the payload, so M5.12 must decide how the scorer sees
   module-owned inputs *without* giving it a second data path into the database.
5. **Extend the M3-2 explanation engine** so the new categories produce recommendations; a scored
   category with no explanation is a number a family cannot act on.
6. **Decide what the score timeline shows across a version boundary** — see §9.

## 8. Tests M5.12 is expected to intentionally rewrite

These will fail **by design**. Each was written to make the change deliberate:

| Test | Why it fails |
|---|---|
| `finance.test.ts` → *"scores exactly five categories, with these weights"* | The category list changes |
| `finance.test.ts` → *"does NOT score protection or retirement…"* | That is precisely what M5.12 reverses |
| `finance.test.ts` → *"pins the model version…"* | The version bumps |
| `finance.test.ts` → *"weights sum to 100"* | Should still pass — if it fails, the re-weighting is wrong |
| `household-goals.e2e-spec.ts` → the `wealthHealth.data.overall` unchanged assertion | Only if M5.12 also scores goals |

Likely to need review, not necessarily rewriting: `household-health-score.e2e-spec.ts`,
`household-health-explanation.e2e-spec.ts`, `household-dashboard.e2e-spec.ts`,
`wealth-check-idempotency.e2e-spec.ts`, `financialIntelligence.test.ts`,
`household-ai.service.spec.ts`.

## 9. Risk: double counting, and a trend that lies

**Double counting is the central modelling risk**, and it is concrete:

- **Retirement vs Savings vs Net Worth.** The retirement projection is derived from investable
  assets and the savings rate. Scoring "retirement readiness" alongside `savings` and `net_worth`
  counts the same underlying facts up to three times, so a family with a large corpus gains twice
  and a family with none is penalised twice.
- **Protection vs Liquidity.** The emergency-fund figure already drives `liquidity`. If a
  protection category folds in emergency-fund adequacy, it double counts; it should be restricted
  to insurance cover.
- **Goals vs everything.** Goal slippage is computed from current savings growing to a target — it
  is a re-projection of assets the score already counts. **Recommendation: goals should stay a
  signal and stay out of the score**, or enter only as a *behavioural* measure (is a plan stated
  and being funded), never as an asset-derived one.
- **The early-warning system already covers all three.** `risk` reports concentration, liquidity,
  emergency fund, debt, insurance and goal progress. If the score absorbs the same facts, a family
  sees one problem reported twice with different arithmetic behind each.

**The trend risk.** `HouseholdHealthScoreService.timeline()` returns every stored score
oldest→newest and includes `scoreModelVersion` per row, but **does not segment or warn**. The
version is shown as text beside the current score (`/household` footer; advisor health-score page)
and nowhere on the history. After a version bump, a family's score line will step — and the step
will read as a change in their finances rather than a change in what we measure. M5.12 should
decide explicitly: break the line at the version boundary, label it, or recompute history under
the new model (which contradicts the stored-record semantics, so probably not).

## 10. Recommended design boundary for M5.12

1. **Score facts, signal behaviour.** Protection and retirement are *states* (covered or not,
   on track or not) and belong in the score. Goals are an *intention* and should stay a risk
   signal — this also keeps M5.11 stable rather than immediately revisited.
2. **Each fact contributes to exactly one category.** Write the mapping down before the weights,
   and assert it in a test: every input names the one category it feeds.
3. **The scorer keeps a single data path.** It reads the immutable snapshot plus the module-owned
   assumptions already resolved by `resolveAssumptions()` — never the database, never a second
   loader. Protection and retirement must not gain a private route into the scoring function.
4. **The version bump is the deliverable, not a side effect.** `fhs-2.0.0` ships with the
   re-weighting, the anchors, the explanations and the timeline decision together; a bump without
   any of those is a silent redefinition of the family's headline number.
5. **Stored scores stay immutable.** No back-filling, no rewriting `FinancialHealthScore` rows —
   the same rule the snapshot follows.
6. **The frozen kernel stays frozen.** M5.12 is a scoring-model change and needs no migration and
   no payload change; if it appears to need one, that is the signal to stop and re-scope.
