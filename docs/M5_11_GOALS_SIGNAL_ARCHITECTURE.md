# M5.11 — Goals Become a Signal

> **Status:** implemented.
> **Closes:** Gap 1 and Gap 4 from `docs/architecture/V2_MASTER_ARCHITECTURE_AND_HISTORY.md` §7.
> **Does not touch:** the frozen Financial Snapshot contract, the Wealth Health Score, or any
> migration. There is no schema change in this milestone.

---

## 1. The defect

M5.8 gave households native Goals: create, edit, remove, list, household-scoped, audited. It
also shipped a documented hole, stated in its own service comment — *"They move no figure."* A
family could enter a ₹2 crore education goal with nothing saved against it and **nothing in the
product changed**: not the score, not the risk signals, not what the AI coach said.

The audit found the gap was worse than "no signal". The early-warning engine emits a Goal
Progress signal unconditionally, and with no slippage supplied it reports:

> *"Add goals to track progress."*

So a V2 family who had already added goals — and was badly behind on them — was told to add
goals. And a **V1** user on `/dashboard` did get a real goal signal, because
`apps/api/src/common/financial-snapshot.service.ts` computes `goalSlippage` and passes it. The
newer generation of the product was the one that had stopped looking.

## 2. What was already in place

Nearly everything. This milestone is mostly *connection*, which is why it needed no migration:

| Piece | Where it already was |
|---|---|
| `goalSlippage` accepted by the engine | `packages/core/src/scoring/earlyWarning.ts:29` — accepted, never supplied on the V2 path |
| The gap/SIP calculation | `packages/core/src/finance/goals.ts::planGoal` |
| A place for module-owned inputs | `IntelligenceAssumptions` (`financialIntelligence.ts`) |
| A single point that loads them | `HouseholdIntelligenceService.resolveAssumptions()` (M5.9) |
| Goals stored per household | `Goal.householdId`, from M1b's additive columns |

## 3. Decisions

### 3.1 Goals reach the layer as a module-owned assumption, not through the kernel

The alternative was to put goals in the Financial Snapshot payload. Rejected: the payload is
frozen at `schemaVersion 1`, snapshots are immutable, and a goal is not a kernel fact — it is a
statement of intent that changes without any money moving. Protection (M5.9) and Retirement
(M5.10) both took the assumption route, and `resolveAssumptions()` exists precisely so a new
module-owned input is *one more entry in one method* rather than wiring at every call site.

Consequence, and it is deliberate: **`snapshot.payload.goals` is still `undefined`**, and the
goals e2e still asserts it.

### 3.2 One definition of "how far behind", shared with V1

`monthsBetween` existed **twice**, character for character — in `apps/api/src/goals/goals.module.ts`
and `apps/api/src/common/financial-snapshot.service.ts` — and the slippage fraction was computed
inline next to one of them. A third copy for households would have made three definitions of how
long a family has left.

Instead the definition moved into `@lcos/core`:

```ts
monthsUntil(from, to)                 // whole months, floored at 1
goalSlippage(plan, targetAmountMinor) // unfunded fraction of target, in [0,1]
planGoalAsOf(goal, now)               // the one entry point all three callers use
```

Both V1 call sites were refactored onto it. The arithmetic is unchanged and
`goals.test.ts` proves it against the exact expression that was removed.

### 3.3 "No goals" is not "on track"

`assumptionsFor` returns `undefined` — not `[]` — for a household with no goals, so the engine
keeps saying *"Add goals to track progress."* An empty array would read identically to a family
with three goals they are on track for. This is the same distinction #67 got wrong for insurance,
where `false` and `null` were conflated and the product asserted an absence it had never been
told.

### 3.4 The score is NOT changed

Goals raise a **risk signal**. They do not enter the Wealth Health Score. Adding a category bumps
`FINANCIAL_HEALTH_MODEL_VERSION` and re-bands every score already shown to a family — a product
decision about what "health" means, and M5.12's to make. The goals e2e pins that the score is
unmoved.

### 3.5 Gap 4, folded in: the score model is now pinned

Nothing asserted what the score is made of. Two milestones observed by hand that it ignores
protection and retirement; no test would have repeated the finding. `finance.test.ts` now pins the
five categories, their weights, the sum to 100, the absence of `protection`/`retirement`, and the
model version. **M5.12 is expected to fail these tests and rewrite them deliberately** — which is
the point.

### 3.6 The goals page shows where each goal stands

`GET /households/:id/goals` gained an additive `plan` — months remaining, projected value, gap,
required monthly SIP, progress, slippage — shaped like the retail list so the two generations
describe a goal the same way. The page renders those figures and computes nothing, and the bands
it labels are the engine's, so the card and the risk signal cannot disagree.

## 4. What changed

| Layer | Change |
|---|---|
| `@lcos/core` | `monthsUntil`, `goalSlippage`, `planGoalAsOf`; `IntelligenceAssumptions.goals`; `goalSlippage` passed into `EarlyWarningInput` |
| API | `HouseholdGoalsService.assumptionsFor()`; `plan` on the goals list; `resolveAssumptions()` loads goals; both V1 call sites refactored onto the shared definition |
| Web | `plan` typed, `goalStanding()` helper, per-goal standing on `/household/goals` |
| Tests | `goals.test.ts` (new); the score-model pin; the two M5.8 tripwires rewritten; new goal-signal cases in the intelligence unit spec and the goals e2e |
| Schema | **none** |

## 5. The tripwires that fired, as designed

Two tests were written by earlier milestones to fail the day this gap closed. Both did, and both
were rewritten to assert the new truth rather than deleted:

1. `household-goals.e2e-spec.ts` — *"a goal changes no figure"* → *"a goal now moves a figure —
   without touching the kernel or the score"*. The snapshot and score assertions survive
   unchanged; only the risk assertion inverted.
2. `early-warning-parity.e2e-spec.ts` — *"documents the goal gap: V2 carries no goal-derived
   signal"* → *"the goal gap is closed: both paths raise the same goal signal"*. Goals are now
   **inside** the parity comparison, and with insurance rejoining in M5.9, nothing is excluded
   from it any more.

## 6. What is still open

- **The score ignores goals, protection and retirement** — Gap 2, and M5.12's subject.
- **The snapshot carries no goals**, so goal history is not reconstructable from a past snapshot.
  Correct for now: a goal is intent, not a kernel fact.
- **Advisor-created goals** remain unsupported — `Goal.userId` is NOT NULL, unchanged since M5.8.
- **Gap 3** (`usingDefaultAssumptions` is binary on the presence of the retirement assumptions
  object rather than per-field) is **not** in this milestone. It is a retirement-surface fix, not
  a goals one, and folding it in would have mixed two unrelated diffs.
