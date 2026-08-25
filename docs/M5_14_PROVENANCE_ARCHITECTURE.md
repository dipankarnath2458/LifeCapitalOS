# M5.14 — Every figure carries its provenance (Gap 3)

> **Status: implemented.** Every figure below was measured or read from source at `be924a6`
> (`origin/main` after PRs #76, #77 and #78), not recalled.
>
> Gap 3 in `docs/architecture/V2_MASTER_ARCHITECTURE_AND_HISTORY.md`:
> *"`usingDefaultAssumptions` is binary, not per-field"*. M5.11 was supposed to fold it in as a
> "low-cost rider" and did not, so it survived three milestones.
>
> **This milestone changes a shipped number.** See §5 before reading anything else.

---

## 1. Where the backlog actually stood

The audit's OPEN list was stale. Verified from source before starting:

| Gap | Status | Evidence |
|---|---|---|
| 2 — score ignores protection/retirement | **Closed** by M5.12 | 7 scored categories |
| **3 — `usingDefaultAssumptions` is binary** | **OPEN → this milestone** | `financialIntelligence.ts:192` |
| 4 — nothing pins the score model | **Closed** | `finance.test.ts:247` pins `fhs-2.0.0` |
| 5 — Budget/What-if unreachable | **Closed** by M5.13 | both consumer pages live |
| 6 — snapshot cannot see account `type` | **OPEN** (option H, deferred) | `financialSnapshot.ts` assets |
| 7 — `/onboarding/status` pressure | **Closed** by #77 | 120 → 54 calls measured |

## 2. The defect: one flag for seven figures

```ts
const usingDefaults = !input.assumptions?.retirement;   // all-or-nothing
```

Decided by whether a **plan row existed**, and wrong in **both** directions:

- **Overstating.** A family who stated only a retirement age was reported as using no defaults,
  at `confidence: 'high'`, while inflation, both return rates and their income target were all
  still our conventions. Nothing on any screen said so.
- **Understating.** A family who stated nothing was told the whole projection rested on
  *"standard assumptions"* — but their corpus and income target are **derived from figures they
  actually recorded**. We described their own money back to them as our guesswork.

The dashboard rendered one blanket sentence for both cases:

> *Based on standard assumptions — add your retirement plans to refine this.*

Architecture rule 6 — *every important figure carries its provenance* — was already satisfied one
layer down: `RetirementPlanService` resolves `'stated' | 'derived' | 'default'` per field and
`/household/retirement` renders it. The layer flattened that to a boolean. **The information
existed and the dashboard could not express it** — the same shape as M5.13's simulation defect.

## 3. What labelling it honestly uncovered

To call the corpus `derived`, you must answer *derived from what*. There were **two answers**:

| Surface | Corpus definition |
|---|---|
| `/household/retirement` | investable assets — allocation minus `real_estate` |
| `/household` (via the layer) | `reconciledNetWorthMinor` — **includes the family home** |

Measured on a homeowning fixture (₹80,00,000 home, ₹15,00,000 equity, ₹5,00,000 cash, ₹20,00,000 debt):

```
/household  (dashboard)             = ₹80,00,000
/household/retirement (planning)    = ₹20,00,000
>>> DIFFERENCE = ₹60,00,000  (4× overstated)
```

Same household, same moment, two retirement corpora, nothing on either screen to explain it.

**It affects families without a stated plan** — which, per the M5.12 production verification, is
most of them. `RetirementPlanService.assumptionsFor` returns `undefined` when there is no plan, so
the layer fell through to its own worse definition. With a plan, the corpus already came from
assumptions and the two agreed.

M5.10 **knew**. Its own test pinned the wart as expected behaviour (§6), and
`investableCorpusMinor`'s comment says the layer's fallback *"overstates the corpus"*. The
workaround was "state a plan and we'll correct it", which leaves every planless family wrong.

## 4. What was built

**One vocabulary, in core.** `FieldSource` and `ResolvedField<T>` move from
`retirement-plan.service.ts` into `@lcos/core` and are re-exported there, so the layer and the
module cannot disagree about what "derived" means. `ResolvedRetirementAssumptions` joins them.

**One corpus definition, in the snapshot module.** `investableCorpusMinor(payload)` sits beside
`reconciledNetWorthMinor` — which carries the identical lesson in its own comment: *"One
definition, imported by both, is what stops that recurring."* Both the layer and the plan service
now call it. It is a **selection, not a calculation**: sum the allocation, drop `real_estate`.

**Per-field resolution in the layer.** Each assumption is `stated`, else `derived` (from the
family's own recorded figures) or `default` (our convention). `monthlyContributionMinor` stays
`null` and is never defaulted — there is no honest convention for what a family saves.

**The boolean is preserved, not removed.** `usingDefaultAssumptions` is now *computed from* the
per-field data — true when any figure is `default`. Every existing consumer keeps working, and it
finally means what it always claimed.

**The dashboard names what is ours.** `AssumedFrom` lists only the `default` fields:

> *We assumed the age you retire, how long you plan for, inflation, investment growth before
> retirement and investment growth after. Everything else comes from your own figures — set your
> plan to replace what we assumed.*

It renders **nothing** when every figure is theirs. Silence is the right output for a complete plan.

## 5. This changes a shipped number

A family **without a stated retirement plan** will see their retirement corpus on `/household`
**fall** — by the value of their home, less the debt that was previously netted off. Readiness and
the funding gap move with it.

That is the correction, not a regression: the figure they saw was funding a retirement with a
house nobody sells at seventy, and it disagreed with the number on their own planning page.

**The score does not move.** Retirement is only scored when a plan is stated
(`healthFacts.ts:101`), and for those households the corpus already came from `assumptions`. No
`fhs` version bump; `financialHealth.ts` is untouched.

## 6. Two tests rewritten deliberately

Both pinned behaviour this milestone changes on purpose. Neither was weakened.

**`household-retirement.e2e-spec.ts` → *"the corpus excludes the family home"***. It asserted that
a household with no plan saw ₹2.5Cr — the home-inclusive figure — as the "before" state, then
showed the plan correcting it. It now asserts the home is excluded on **both** paths, which is
what the test's own name always claimed, plus teeth proving the home is really in the household
so the equality is not trivially true. **Strictly stronger than what it replaces.**

**`wealth-check-idempotency.e2e-spec.ts` → *"13 — retirement is projected from the corrected
figures"***. Its actual property — a second run changes nothing — was unaffected and still passes.
Only the incidental figure encoding the old definition changed, from `1800000 - 350000`
(reconciled) to `500000 + 1000000` (investable), and the stale comment with it.

## 7. Proof the new tests bite

`provenance.test.ts` (16 cases) and `retirement-provenance.e2e-spec.ts` (5 cases) were run against
the pre-M5.14 behaviour, reconstructed under the new shape so they exercised **behaviour** rather
than a missing field.

Core — **5 failed, 197 passed**:

```
× a family who has stated nothing › is not told their own figures are our assumptions
× a family who stated PART of a plan › has each stated figure marked stated …
× a family who stated PART of a plan › is NOT reported as free of defaults
× the retirement corpus has ONE definition › is what the layer falls back to …
× the retirement corpus has ONE definition › no longer reports 4x the planning surface …
```

e2e — **2 failed, 3 passed**, with the exact figures: `Expected: 200000000, Received: 1000000000`
(₹20,00,000 against ₹1,00,00,000, the home-inclusive corpus).

Both halves of the bug and the corpus split are covered, and the cases asserting genuinely-default
fields still passed — the tests discriminate this defect rather than failing indiscriminately.

## 8. Results

| Suite | Result |
|---|---|
| Core | **202/202** (187 + 15 new) |
| API unit | 72/72 |
| API e2e | **256/256 across 36 suites** (251 + 5 new) |
| Web unit | 48/48 |
| Browser smoke | **51/51** |

No migration, no schema change, no kernel change, no scoring change.

## 9. Remaining risk

1. **Provenance covers retirement only.** It is the section with real assumptions today, but
   `emergencyFundMonths` and `risk` are also defaulted in the layer and still carry no source.
   Extending the pattern is cheap and deliberately not done here.
2. **`confidence` is still derived from the boolean**, so a family with one defaulted field and a
   family with seven both read `medium`. Per-field data now exists to grade it properly; whether
   confidence *should* be graded is a product decision, not a mechanical one.
3. **The dashboard names defaults but does not name derivations.** A family cannot see that their
   corpus came from their accounts rather than from a plan they typed. The data is served; only
   the rendering is conservative.
4. **`lifeExpectancy` vs `yearsInRetirement`.** The plan stores an age to plan *to*; the layer
   takes a duration. Both resolve correctly, but the two shapes remain, and a future reader could
   reasonably mistake one for the other.
