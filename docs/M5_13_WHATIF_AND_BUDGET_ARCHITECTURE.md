# M5.13 — What-if and Budget reach the consumer

> **Status: implemented.** Every figure and file reference below was read from source at
> `3923977` (`origin/main` after PR #75), not from memory or a roadmap.
>
> Roadmap entry: *"M5.13 — What-if and Budget reach the consumer (option G + gap 5)"*,
> `docs/architecture/V2_MASTER_ARCHITECTURE_AND_HISTORY.md:800`.

---

## 1. What the milestone turned out to be

The roadmap describes M5.13 as *"two complete, tested engines that no consumer can reach"* and
predicts it is **purely additive: no migration, no kernel change, no score change**. That
prediction held for the surfaces. It did **not** hold for the API, and finding out why is the
substance of this milestone.

Reconnaissance established three things before any code was written:

| Question | Answer | Evidence |
|---|---|---|
| Can a consumer already call the simulation API? | **Yes** — no `@FirmRoles` at all; the engine is non-mutating so any in-scope member may run it | `household-simulation.controller.ts:15-21` |
| Can a consumer already call the budget API? | **Yes** — writes need `OWNER\|ADVISOR\|SUPPORT`, and a consumer *is* `FirmRole.OWNER` of their own personal firm | `household-budget.controller.ts:29`, `onboarding.service.ts:185` |
| Is there a consumer surface for either? | **No** — `/household/*` had six pages, none of them these | `apps/web/src/app/household/` |

So Gap 5 was exactly what it claimed to be: a missing surface, not a missing capability. **No new
API route, no new DTO, no new permission, no migration.**

Then the fourth question changed the shape of the work.

## 2. The blocking defect: What-if disagreed with the Wealth Health Score

**M5.12 taught the scoring engine about protection and retirement. It did not teach this caller.**

`simulateFinancialWhatIf` gained a `facts` option in M5.12, documented there as essential:
omitting it means *"every reported delta would carry that difference rather than the scenario's
effect"* (`financialSimulation.ts:290-304`). But `HouseholdSimulationService` called it as:

```ts
simulateFinancialWhatIf(payload, { scenarios }, { snapshotId: snap.id });   // no facts
```

while `HouseholdHealthScoreService` — the service behind the number on the family's dashboard —
called `deriveHealthFacts(...)` through the shared resolver and passed the result
(`household-health-score.service.ts:75-80`).

**This is the M5.9 defect shape exactly**: a service that had the data available and a consumer
that never received it. Nothing failed. Both numbers were internally consistent. The family was
simply shown two different Wealth Health Scores depending on which page they opened.

### Measured, not asserted

Run against real households through the API (the figures below are from
`simulation-score-agreement.e2e-spec.ts` failing against the pre-fix service):

| Household | Dashboard score | What-if "before" | Gap |
|---|---|---|---|
| Has stated nothing | 92 | 92 | **0** |
| Stated a retirement plan | 93 | 92 | 1 |
| Dependant + stated **no cover** | 76 | 92 | **16** |
| Stated both (7 categories) | 78 | 90 | **12** |

The control matters as much as the failures: a family who has told us nothing sees no
disagreement, because both sides score the same five categories. **A test of the simulation alone
would have passed throughout the defect** — which is why the regression suite asserts an equality
*between two endpoints* rather than any property of one.

### The fix

`HouseholdSimulationService` now resolves through the same two shared pieces as the score service —
`HouseholdAssumptionsService.resolve()` and `deriveHealthFacts()` — and passes `facts` to the
engine. Both were already providers of `HouseholdsModule`, so the change is contained
(`households.module.ts:77-79`).

The facts are deliberately the **same object** for baseline and virtual payloads: no scenario in
the registry changes a family's cover or their retirement plan, so a scenario's delta stays the
scenario's own effect.

## 3. `improve_insurance` is deliberately not offered to consumers

Its transform models the **premium only** — it raises monthly expense — while the benefit of being
covered lives in `HealthFacts`, which no scenario transform can reach. Since M5.12 made protection
a scored category, this scenario can now only ever *lower* a family's score.

Offering it would answer *"should I get insured?"* with a smaller number, which is the opposite of
what M5.9 and M5.12 were built to say. It stays in the engine (the advisor screen still exposes the
full registry) and is omitted from `CONSUMER_SCENARIOS`, with the reason recorded at both the
engine transform and the consumer list so it cannot be re-added by accident.

`buy_asset`, `sell_asset` and `reallocate` are omitted for a different and lesser reason: each
needs an asset class chosen per family, which is advisor work.

**Follow-on decision, not taken here:** letting a scenario carry a fact override would make
"what if I got insured?" answerable. That is a change to the engine's contract and belongs in its
own milestone.

## 4. The consumer surfaces

Both are **web-only**, compose from the frozen design system, and perform **no financial
arithmetic** — the only computation in either is rupees ↔ minor units.

### `/household/what-if`

- Says *"nothing here is saved"* **before** the family touches anything, not as a footnote.
- Shows their real score as the "before", now guaranteed to be the dashboard's number.
- Reports a zero delta as *"no change"* and a negative delta as worse — never dressed up.
- Explains that some changes cannot apply (repaying borrowing you do not have), because the engine
  clamps every transform to what exists and would otherwise return a silent zero.
- States the model and engine versions it used, and that the answer is deterministic.

### `/household/budget`

- A family who has set no budget is told so. **We do not show a budget of zero they never chose**,
  and `totalBudgetMinor: null` renders as *"you have not set one"* rather than as unlimited.
- Envelopes are seeded from what is stored when editing, so editing never starts blank.
- An overall cap of `0` is sent as a real answer; a blank field is omitted entirely.

## 5. The honesty problem on the budget page

Actual spend is never stored — it is aggregated live from the cashflow ledger. For a consumer that
ledger is currently written by the Wealth Health Check, which records the month's spending as a
**single `living` line** (`wealthHealth.ts:94-95`, and `liveFlow` filters on that exact category).

So a family's spending is all present, but as one category. A budget page that quietly compared
envelopes against categories with no spend would report almost everyone as comfortably under
budget while their money went somewhere else entirely.

The API already refuses to hide this: `getForMonth` returns `uncategorized` — spend no envelope
covers (`household-budget.service.ts:110-113`). The page renders it as a first-class part of the
answer under *"Spending outside your budget — it still counts"*, and states where the actual
figures come from. **Under-budget is only ever claimed about money we can actually see.**

## 6. What M5.13 deliberately does NOT do

- **No categorised spend-entry surface.** This was considered and rejected *for this milestone*.
  The cashflow API would accept it today (categories are free-form, consumers are `OWNER`), but
  the Wealth Health Check derives its "monthly expenses" figure from the `living` category alone
  while the snapshot aggregates **all** expenses. Recording spending under new categories would
  therefore lower the savings rate and the score while the check kept showing the smaller figure —
  one family, two numbers, which is the defect class this milestone exists to close. Making
  spending entry work means deciding what the check's expense figure means first.
- **No kernel change.** `financialSnapshot.ts` and `kernelContract.test.ts` untouched.
- **No migration.** The migrations tree is byte-identical to `main`.
- **No scoring change.** `financialHealth.ts` is untouched; `fhs-2.0.0` is unchanged. What-if now
  *reports* the same score it always should have — no family's score moved.
- **No second engine.** Both surfaces call engines that already existed (M2-4, M3-3).
- **No advisor regression.** The advisor simulation page is untouched and now benefits from the
  same fix.

## 7. Two "what if"s, kept apart

`/household/retirement` already had a "What if…" — the M5.10 retirement projection
(`retire_later`, `retire_earlier`, `increase_contribution`), which re-projects a corpus. The new
page re-scores a snapshot. They are different engines answering different questions.

Neither was renamed. The new page's subtitle names its subject (*"what it would do to your Wealth
Health Score"*), and the two cross-link, so a family who wants the other question is one click
away rather than confused about which one they are on.

## 8. Tests

| Test | What it holds |
|---|---|
| `apps/api/test/simulation-score-agreement.e2e-spec.ts` (**new**, 5 cases) | What-if's "before" equals the dashboard score, for silent / uninsured / retirement-planning / both households, plus the delta being the scenario's own effect |
| `apps/web/e2e/smoke.spec.ts` → *"what-if reaches the consumer…"* (**new**) | Reachable by navigation; the number a family reads on this page IS the one on their dashboard; exploring persists nothing |
| `apps/web/e2e/smoke.spec.ts` → *"the budget reaches the consumer…"* (**new**) | Reachable by navigation; no invented budget; real ledger spend appears; envelopes survive a reload |
| `apps/web/e2e/smoke.spec.ts` → dark-mode contrast (**2 paths added**) | Both new pages are readable in dark mode — the M5.5/M5.6 defect that no other test could see |

**The regression suite was verified to bite before it was trusted.** Run against the pre-fix
service it failed 4 of 5 — and the one that passed was the control, exactly as its own comment
predicts. Run against the fix, 5 of 5 pass.

Full suites at time of writing: core 187/187 · API unit 72/72 · **API e2e 251/251 across 35
suites** · web unit 31/31.

## 9. A Gap 7 finding, surfaced but not fixed here

Adding two dark-mode paths pushed the browser suite over a documented ceiling and produced a
**deterministic** failure on `/household/goals` — a page this milestone does not touch. The cause
was measured, not guessed: with the API's request log captured, the run issued **134 calls to
`/api/onboarding/status` against a limit of 120/60s, and the last four returned 429**.

What happens next is the part worth recording:

```ts
// lib/household.ts:28-29
export async function getOnboardingStatus(token: string): Promise<OnboardingStatus | null> {
  return apiGet<OnboardingStatus>('/onboarding/status', token).catch(() => null);
}
```

**"We could not ask" collapses into "you have no household."** The page then renders *"Let's set up
your household first"* to a family who has one. That is the `unknown → false` failure this project
has fixed repeatedly (#67, M5.9, M5.12), still live in the one place `resolveHouseholdId`'s own
comment already warns about: *"a 429 here is not a slow page — it makes `hasOwnHousehold` read
false."* It has been defended twice (M5.8 PR 2, M5.10) by removing callers, never by making the
failure honest.

**Not fixed in M5.13,** because fixing it properly means changing what `resolveHouseholdId` returns
and updating every consumer surface's empty-state handling — six pages, none of them this
milestone's. It is recorded here as the next obvious piece of work, with a reproduction.

What M5.13 did instead was stop *its own* additions from paying for resolution they never assert:
the dark-mode block tests contrast, so it now seeds the household-id cache exactly as a returning
consumer's tab already holds it (`withCachedHousehold`). No assertion was removed or weakened. The
suite went from a deterministic failure at 2.1 minutes to **43/43 passing on two consecutive runs
at ~1 minute**, and the seeding mechanism was verified independently before being relied on.

## 10. Gap 5 after this milestone

Closed for both engines named in the roadmap. What remains under the same heading is narrower and
worth stating so it is not mistaken for done:

- Consumers can budget but cannot yet record **categorised** spending (§6).
- `improve_insurance` cannot be offered honestly until a scenario can carry a fact override (§3).
- The advisor simulation page still exposes the raw registry and parameter names; that is
  appropriate for an advisor and untouched here.
