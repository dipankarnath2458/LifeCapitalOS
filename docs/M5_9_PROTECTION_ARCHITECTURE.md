# M5.9 — Protection / Insurance Intelligence — Architecture

**Status: IMPLEMENTED.** Approved with decisions 1–4 as recommended (§10). The §4.3 core change
shipped first as a standalone hotfix (#67) because the false claim was live; the rest shipped as
this milestone.

## Deviations from this note, and why

Two, both recorded here rather than buried in a diff.

**1. `assumptions` is resolved inside `HouseholdIntelligenceService`, not at each call site.**
§3 and §7.1 sketched the controller and the AI service each passing a third argument. That would
have worked and reproduced the exact fragility that caused this milestone: `current()` has always
*accepted* an `assumptions` argument, and both callers simply forgot it. Wiring two call sites
correctly leaves the third to be forgotten later. The service now loads its own module-owned
inputs, so a new consumer gets the household's real protection by calling `current()` with
nothing to remember. This is also what `M5_FINANCIAL_INTELLIGENCE_LAYER.md` already described
(*"load module-owned assumptions (retirement/insurance) if any"*); the note's call-site wiring
was the weaker of the two designs. The parameter survives as an override for tests.

**2. The early-warning parity gap is closed, not merely excluded.** #67 had to exclude the
insurance signal from `early-warning-parity.e2e-spec.ts`, with an assertion that would fail once
V2 gained protection data. It has. `seedHousehold` now records the same answers the retail
profile states, insurance is back inside the parity assertion, and a separate test holds the
distinction that survives: a household that has recorded nothing still produces no signal.

Milestone: make protection a real capability in V2 — a data path, not a form. Preserves the
Financial Kernel and the frozen snapshot contract; the one core change proposed is argued for
explicitly in §4.3 and can be declined without blocking the rest.

---

## 1. What is actually broken

Not "V2 has no protection UI". V2 has a protection panel, a protection route, and a fully
implemented insurance calculator. **The channel that connects them was never plugged in.**

### 1.1 The break, in one line

`apps/api/src/households/household-intelligence.controller.ts:32`

```ts
return this.intelligence.current(household, q.snapshotId);
//                                                        ^ no third argument
```

The service's signature is `current(household, snapshotId?, assumptions?)`. **No caller anywhere
in the repository passes `assumptions`.** The AI coach
(`household-ai.service.ts:147`) also calls `current(household)` with one argument.

So `input.assumptions` is permanently `undefined`, and every line downstream that reads it takes
its fallback.

### 1.2 What that produces today — measured, not inferred

Run against built `@lcos/core`, with the exact input the controller supplies (a household with
₹3,00,000/month income, ₹20,00,000 assets, no debt, one 40-year-old member):

```
insurance.available   : true
coverTracked          : false
confidence            : low
existingCoverMinor    : 0
protectionGapMinor    : 3600000000        (₹ 3,60,00,000)
status                : red
dataCompleteness      : {"pct":67,"missing":["insurancePolicies","retirementAssumptions"]}
early-warning signal  : {"key":"insurance","label":"Insurance Gap",
                         "severity":"high","detail":"no term cover, no health cover"}
health categories     : net_worth, debt_burden, savings, liquidity, diversification
```

Three separate defects are visible in that output.

**(a) A ₹3.6 crore protection gap is computed for a family we have never asked.** The dashboard
hides it — `apps/web/src/app/household/page.tsx:451` checks `coverTracked` and renders "We don't
have your insurance details yet" instead. That guard is correct and was deliberate. But it is a
*consumer* working around a layer that is producing a number it has no basis for. Any other
consumer that trusts `insurance.available === true` gets the fabricated figure.

**(b) The early-warning signal states as fact something we never asked.** `"no term cover, no
health cover"`, severity **high**. This one is *not* hidden: `risk.topRisks` is on the AI coach's
allow-list (`household-ai.service.ts:58`), so the Family CFO is told, as settled fact it may not
contradict, that this family has no insurance. Every household with any income gets this —
`protectionNeeded = dependents > 0 || annualIncomeMinor > 0`
(`packages/core/src/scoring/earlyWarning.ts:96`).

This is the same failure mode as #55 and #59: **a figure whose obvious reading is not its actual
meaning.** There, "net worth" meant two things. Here, `false` means both "no cover" and "never
asked".

**(c) V2's Wealth Health™ score does not consider protection at all.** The V2 model
(`financialHealth.ts:44-48`) is `net_worth 25, debt_burden 25, savings 20, liquidity 20,
diversification 10` — no protection category. The V1 model (`scoring/scores.ts:60`) weights
`protection` at **20%**. Supplying real cover to the layer changes the V2 score by **zero** —
measured: `uncovered = 90, covered = 90`. See §6.2; this is a parity gap M5.9 should *document*,
not silently close.

### 1.3 What already works, and must not be disturbed

| | Store | Written by | Reaches intelligence? |
|---|---|---|---|
| **V1** | `Profile.hasTermCover`, `hasHealthInsurance`, `termLifeCoverMinor` | `components/Protection.tsx` → `PUT /profile` | **Yes** — `common/financial-snapshot.service.ts:169` reads it into the retail early-warning and score inputs |
| **V2** | *nothing* | `/household/protection` mounts the V1 component, so it writes the **retail** row | **No** |

V1's protection path is complete and correct. A consumer using `/household/protection` today is
writing a real row — to a store the V2 intelligence layer does not read. The comment already on
that page states it: *"M5.9 must build the data path, not just a form."*

---

## 2. Source of truth for insurance data

### 2.1 Insurance is not a kernel fact, and must not enter the snapshot

`FinancialSnapshotPayload` is frozen at `schemaVersion 1`, with `kernelContract.test.ts` pinning
`REQUIRED_KEYS` and `OPTIONAL_KEYS = ['members']`. Adding an `insurance` section would break that
test — correctly.

It would also be wrong on the merits. The snapshot is the kernel's immutable record of
**positions**: what the family owns and owes at a moment. A policy is not a position. And a
snapshot is captured by the Wealth Health Check; if cover lived in the payload, **updating your
insurance would require re-capturing a snapshot**, and correcting last year's cover would mean
rewriting an immutable record.

The M5 architecture already anticipated exactly this
(`docs/architecture/M5_FINANCIAL_INTELLIGENCE_LAYER.md:348`):

> Module-owned **inputs** (retirement assumptions, insurance policies) | M5's own tables |
> Additive, RLS-locked, household-scoped.

`IntelligenceAssumptions.insurance` is that channel. It exists, it is typed, it is consumed in
three places. M5.9 supplies it.

**Consequence to accept knowingly:** intelligence for a *historic* snapshot is composed with
*today's* protection. Assumptions are current-state, snapshots are point-in-time. This is already
true of retirement assumptions and is the right trade — but it should be stated in the layer docs
rather than discovered later.

### 2.2 Where the data should live: `HouseholdMember`

Three candidates.

| Option | Migration | Verdict |
|---|---|---|
| **(i)** Reuse `Profile` | none | **Rejected** |
| **(ii)** Additive columns on `HouseholdMember` | 3 nullable columns | **Recommended** |
| **(iii)** New `InsurancePolicy` table | full table | **Premature — this is the future module** |

**Why not (i), despite needing no migration.** `Profile` is retail, keyed `userId`, one row per
user. It cannot represent a spouse's separate term policy — and a spouse's cover is precisely
what a family CFO must know. Worse, an advisor viewing a client household would have *their own*
`Profile` read as the client's protection: the same class of confusion that put advisors inside
client households in #52 and #54, and that M5.8 PR 2 refused to repeat for goals. Reusing
`Profile` would recreate the two-store split that M5.8 PR 1 and PR 2 have just spent two PRs
containing.

**Why not (iii) yet.** A real `InsurancePolicy` table means insurer, policy number, product type,
sum assured, premium, frequency, renewal date, nominee, riders, claim history. **Nothing in the
product consumes any of those today.** The layer reads exactly three values. Building twelve
columns to feed three is the overbuilding the founder asked me to avoid. §9 shows how (iii)
arrives later without rework.

**Why (ii) is the right grain.** `HouseholdMember` is already the household's person-level table,
already the one the snapshot reads for `members[]` (ages, dependency), and already native in V2
since M5.8 PR 1. Protection is a fact *about a person*. The columns sit exactly where the family
already answers person-level questions.

---

## 3. Proposed data flow

```
  /household/protection (native V2 surface)
        │  PATCH /households/:id/members/:memberId/protection
        ▼
  HouseholdProtectionService                    ← writes member columns; NO protection maths
        │
        │  assumptionsFor(householdId) → IntelligenceAssumptions['insurance'] | undefined
        ▼
  HouseholdIntelligenceService.current(household, snapshotId, assumptions)
        │                                        ← the argument that is missing today
        ▼
  computeHouseholdFinancialIntelligence()        ← @lcos/core, unchanged apart from §4.3
        │
        ├── insurance section    (analyzeLifeInsuranceGap — existing, untouched)
        ├── risk / early warning (computeEarlyWarning     — see §4.3)
        └── meta.dataCompleteness
        │
        ▼
  /household dashboard  ·  AI Family CFO  ·  future Reports / What-if
```

The kernel is not touched. The snapshot is not touched. No consumer recalculates anything: the
single new API method returns *stored facts in the shape the layer already declares*.

`assumptionsFor` returns `undefined` — not a zero-filled object — when the household has not
answered. That distinction is the whole of §5.

---

## 4. Protection signals and calculation boundaries

### 4.1 What stays in `@lcos/core` (unchanged)

- `analyzeLifeInsuranceGap` — recommended cover = `annualIncome × multiple + liabilities`, with
  multiple `15` when there are dependants, else `10`. **These multiples are business logic and
  stay in core.** No surface and no API service may restate them.
- `computeEarlyWarning` — the Insurance Gap signal's red/yellow thresholds.
- `computeRetirement`, health scoring — untouched by this milestone.

### 4.2 What the API may do: aggregate, never calculate

`assumptionsFor` maps stored per-member facts to the three values the layer declares. Every rule
below is **selection or counting** — no ratio, target, multiple or gap is derived:

| Layer input | Derived from members | Rationale |
|---|---|---|
| `existingCoverMinor` | **sum** of `termLifeCoverMinor` over non-dependent members holding term cover | Life cover replaces *household* income; the recommended figure is a household figure, so the comparison must be too |
| `hasTermCover` | **any** non-dependent member has term cover | Matches the aggregate above |
| `hasHealthInsurance` | **every** member — dependants included — is covered | Health exposure is per person. One uninsured child is a real exposure that an "any" rule would hide |

The term/health asymmetry is deliberate and is the one modelling judgement in this milestone.
**Flagged for your confirmation** (§10, decision 2).

### 4.3 The one core change I believe is necessary

`EarlyWarningInput.hasTermCover` and `hasHealthInsurance` are `boolean`. There is no way to say
*unknown*, so §1.2(b) — asserting "no term cover" to the AI coach about a family we never asked —
**cannot be fixed by supplying assumptions alone.** A household that has not answered still gets a
high-severity red signal stating a fact.

I considered fixing this in the layer instead, without touching core: filter the `insurance`
signal out of `topRisks` when cover is untracked. **That option is unsound.** `warning.overall`,
`redCount` and `yellowCount` are computed *inside* `computeEarlyWarning` over all signals.
Filtering only the list would leave `redCount: 3` beside two listed risks — a figure disagreeing
with the thing beside it, which is the exact defect class of #55/#59. Recomputing the counts in
the layer would duplicate business logic, which is forbidden.

**Proposed change — additive, and behaviour-preserving for every existing caller:**

```ts
// packages/core/src/scoring/earlyWarning.ts
hasTermCover: boolean | null;        // null = not asked
hasHealthInsurance: boolean | null;
```

When **either** is `null`, the engine **emits no `insurance` signal at all** — rather than
inventing a fourth status colour. `redCount`, `yellowCount` and `overall` are then computed by the
engine itself over the signals that exist, so they stay self-consistent by construction. Nothing
is filtered after the fact.

Backward compatibility: V1 passes real booleans from `Profile`
(`common/financial-snapshot.service.ts:188`) and its behaviour is bit-for-bit unchanged. The
widening is `boolean` → `boolean | null`, which no existing caller can trip over. A regression
test will pin V1's existing output (§8).

**This is the only change proposed to `packages/core`.** It is not a kernel change — `earlyWarning`
is a scoring calculator, not the Financial Kernel — and it is additive rather than a redesign. If
you would rather not touch core at all, M5.9 still delivers the data path and a correct insurance
section; what remains broken is the false red risk signal reaching the coach. I do not recommend
shipping that way, but it is a coherent smaller scope.

### 4.4 The insurance section should report absence, not a fabricated gap

Independent of §4.3, and inside the layer rather than core: when `assumptions.insurance` is
absent, the `insurance` section should be `available: false` with a reason, instead of
`available: true` carrying a ₹3.6 crore gap and a `coverTracked: false` flag that every consumer
must remember to check.

`Section<T>` exists precisely for this, `meta.dataCompleteness` already reports
`missing: ["insurancePolicies"]`, and the dashboard already renders the `available: false` branch
for other sections. `coverTracked` stays in the payload for the tracked case, so nothing that
reads it breaks.

---

## 5. Missing data vs inadequate protection

This is the centre of the design. The distinction is carried by **nullability at rest** and by
**`Section.available` in the layer** — not by a sentinel value.

| State | Stored | Layer output | Early-warning signal | What the family is told |
|---|---|---|---|---|
| **Not asked** | `null` | `insurance: { available: false, reason }` | **none emitted** | "We don't know your cover yet — tell us and we'll assess it." |
| **Asked — no cover** | `false`, `0` | `available: true`, `coverTracked: true`, gap = full recommended, `status: red` | red | "You have no term cover. The gap is ₹X." |
| **Asked — partial** | `true`, `< recommended` | `status: yellow` | yellow | "You're covered, but short by ₹X." |
| **Asked — adequate** | `true`, `≥ recommended` | `status: green` | green | "Your cover meets the recommendation." |

Three consequences worth stating plainly:

1. **A default of `false` is a lie, so the columns must be nullable and must not be backfilled.**
   Backfilling `false` would convert "we never asked ten thousand families" into "ten thousand
   families told us they have no insurance". No backfill (§7.2).
2. **An explicit "no" is more valuable than silence, and must be recordable.** A family that
   answers "I have no term cover" has given us real information; the surface must let them save
   that, and it must produce a red — which is a true red.
3. **Partial answers do not count as tracked.** `coverTracked` is true only when *every*
   non-dependent member has answered both questions and *every* member has answered the health
   question. A household where the spouse is unanswered is not a household we can assess, and
   reporting a gap from half the family is the fabrication this milestone exists to remove. The
   surface shows who is still unanswered so the state is actionable rather than mysterious.

---

## 6. V1 / V2 migration and parity

### 6.1 Both stores remain — as with Family and Goals

M5.9 migrates **no rows** between `Profile` and `HouseholdMember`, and deletes neither. V1's
`Protection.tsx` keeps writing `Profile` and keeps rendering on `/dashboard` as the recoverable
safety net. This matches the precedent set in M5.8 PR 1 (`FamilyMember` / `HouseholdMember`) and
PR 2 (retail `Goal` / household `Goal`), and honours *no destructive deletion before Module 10*.

Copying V1 protection into the household is a data migration with its own approval and is **not**
proposed here. The consumer-facing consequence is the same as for Family: the V2 surface becomes
the one that counts, because it writes the store the layer reads.

**One-time friction to acknowledge:** a consumer who already entered protection through
`/household/protection` (which today mounts the V1 component) has their answer in `Profile`. After
M5.9 they will be asked again on the native surface. That is a handful of families at present, and
the alternative — an automatic copy — guesses that the retail row belongs to this household, which
is wrong for advisors. Prefill from `Profile` as a *suggested default* the family confirms is a
reasonable middle path and is **flagged for your decision** (§10, decision 3).

### 6.2 The score parity gap — surfaced, not closed

V1's Wealth Health weights `protection` at 20%. V2's model has no protection category, so M5.9
changes the V2 score by exactly zero (measured, §1.2c). The V2 dashboard's Protection panel and
risk signals become correct; the *score* remains protection-blind.

Closing that would mean adding a category and re-weighting `financialHealth.ts`, which bumps
`FINANCIAL_HEALTH_MODEL_VERSION` (`fhs-1.0.0`) and **re-bands every score already stored and shown
to every family**. That is a product decision about what the number means, not a side effect of a
protection milestone. I recommend documenting it as an explicit open item (§10, decision 4) and
adding a test that fails the day it changes, in the same spirit as the goal-signal parity gap.

### 6.3 The wider finding: assumptions are unwired for retirement too

`usingDefaultAssumptions` is `true` for every household in the product, for the same reason —
nobody passes `assumptions`. Once M5.9 opens that argument, retirement assumptions are a small
follow-on rather than new plumbing. **Out of scope for M5.9**, recorded so it is not rediscovered.

---

## 7. API and schema impact

### 7.1 API — additive only

| Endpoint | Purpose |
|---|---|
| `GET /households/:id/protection` | Per-member protection state + household aggregate + `coverTracked` |
| `PATCH /households/:id/members/:memberId/protection` | Record one member's answers |

Guarded by the existing `HouseholdScopeGuard`, exactly as goals and members are. The write path
follows M5.8 PR 2's precedent: an actor may record protection only for a household they belong to
as themselves. No new guard concept, no auth-kernel change.

`HouseholdIntelligenceController` and `HouseholdAiService` each gain the third argument, sourced
from `HouseholdProtectionService.assumptionsFor()`. No route, response shape or query parameter
changes for existing callers.

### 7.2 Schema — yes, a migration is necessary, and it is three nullable columns

The founder asked directly whether one is *actually* necessary. It is — and it is the smallest
possible one.

```sql
ALTER TABLE "HouseholdMember"
  ADD COLUMN "hasTermCover"       BOOLEAN,
  ADD COLUMN "hasHealthInsurance" BOOLEAN,
  ADD COLUMN "termLifeCoverMinor" BIGINT;
```

- **All three nullable, no defaults.** `NULL` is load-bearing: it is "not asked" (§5). A
  `DEFAULT false` would reintroduce the exact defect this milestone removes.
- **No backfill, no data repair, no re-keying.** Existing rows are untouched and remain valid.
- **No encryption change.** These are not PII in the sense the crypto boundary protects (no name,
  no identifier); they are booleans and an amount, stored like `termLifeCoverMinor` already is on
  `Profile`. Existing encryption behaviour is unchanged.
- **Reversible.** `git revert` plus a dropping migration; nothing depends on the columns except
  code added in the same PR.

Could M5.9 ship with *no* migration by reusing `Profile`? Technically yes — and it would be wrong
for the reasons in §2.2. I would rather take three additive columns than re-open the two-store
problem the last two PRs closed.

---

## 8. Testing strategy

Following the discipline now established: assert on values rather than status codes, and confirm
every new test fails against a deliberate regression before trusting it.

**API e2e — `household-protection.e2e-spec.ts`**

1. Record and read back protection for a member; assert on the stored row, not the response
2. Household-scoped: another household is a 404
3. Requires authentication
4. Actor must belong to the household (mirrors the goals boundary)

**The distinction tests — the point of the milestone**

5. *Not asked* → `insurance.available === false`, **and** no `insurance` key in `risk.topRisks`,
   **and** `redCount` equals the number of red entries actually listed (the self-consistency
   assertion that rules out the filtering approach in §4.3)
6. *Asked, no cover* → `available: true`, `coverTracked: true`, `status: 'red'`, gap equals the
   full recommended cover — proving an explicit "no" is not silently treated as unknown
7. *Asked, adequate* → `status: 'green'`, `protectionGapMinor === 0`
8. *Partial family* → one member unanswered leaves `coverTracked: false`

**Core unit — `earlyWarning`**

9. `null` inputs → no `insurance` signal, and counts consistent with the emitted signals
10. Boolean inputs → output identical to today. This is the V1 regression guard: V1 passes
    booleans from `Profile` and must not move at all

**Parity / safety net**

11. V1 `/dashboard` Protection still saves to `Profile` and still renders (smoke)
12. A test pinning that the V2 health score has **no** protection category, so §6.2 cannot close
    silently — the same device used for the goal-signal gap

**Smoke**

13. Native `/household/protection`: no `temporary-surface-notice`, record cover, see it reflected
    on `/household`
14. Dark-mode contrast on the new surface

**Teeth checks planned** — each must fail against its named regression: remove the third argument
from the controller (5, 6, 7 must fail); default the columns to `false` (5 must fail); make
`assumptionsFor` return a zero-filled object rather than `undefined` (5 must fail); emit the
insurance signal on `null` (5 must fail on the count assertion).

One caution carried from M5.8 PR 2: an assertion that something is *absent* passes while a fetch
is still in flight. Test 5's absence assertions must be ordered behind a positive signal, not
written as a bare "not there".

---

## 9. How this supports Insurance Intelligence™ without overbuilding

The whole future module hangs off **one method**:

```ts
HouseholdProtectionService.assumptionsFor(householdId): IntelligenceAssumptions['insurance'] | undefined
```

Today it aggregates three member columns. When Insurance Intelligence™ ships — real policies with
insurer, premium, renewal date, riders, nominees, claim history — **that method changes its source
and nothing else moves.** The layer contract, the controller wiring, the dashboard panel, the AI
grounding and the early-warning signal are all already correct and already fed.

What that module adds is genuinely new *analysis* — premium efficiency, renewal risk, over-
insurance, claim readiness, nominee gaps — and it lands the same way every other module has: as
its own tables plus its own composed section, reading the snapshot for positions and its own store
for policies. §10 of the M5 layer doc already describes this extension path.

What M5.9 deliberately does **not** build: policy documents, premium tracking, renewal reminders,
insurer catalogues, riders, health-cover sum-insured modelling, or any per-policy entity. Three
values are read by the layer; three values are stored. When the fourth is genuinely needed, the
seam is one method wide.

The member columns at that point become either the fallback for families who never enter full
policies, or a migration into the policy table — a decision better made with real policy data in
hand than guessed at now.

---

## 10. Recommendation and the decisions I need from you

**Recommendation: approve as scoped, including the core change in §4.3.**

The data path is the milestone; the surface is the easy half. Supplying `assumptions` alone would
fix the insurance *panel* but leave the AI coach being told, as settled fact, that families with no
recorded answer have no insurance. That is the defect most likely to reach a real family in a real
conversation, and §4.3 is the only sound way to close it.

Scope I propose, in one PR:

1. Three nullable columns on `HouseholdMember`; no backfill
2. `HouseholdProtectionService` + two guarded, household-scoped endpoints
3. Wire `assumptions` into the intelligence controller and the AI service
4. `earlyWarning` tri-state (§4.3) and the insurance section reporting absence (§4.4)
5. Native `/household/protection`, replacing the temporary surface
6. Tests per §8, each with a verified teeth check

**Decisions that are yours, not mine:**

| # | Decision | My recommendation |
|---|---|---|
| 1 | Accept the one `@lcos/core` change (§4.3)? | **Yes** — the alternative is unsound, and it is additive and V1-neutral |
| 2 | Term = **any/sum** across adults, health = **every** member (§4.2)? | **Yes** — life cover is a household aggregate, health exposure is per person |
| 3 | Prefill the native surface from `Profile` as a confirmable suggestion (§6.1)? | **Yes for the acting user only**, never for advisors — it saves re-typing without guessing ownership |
| 4 | Close the V2 score's protection blind spot (§6.2)? | **Not now.** It re-bands every stored score; it deserves its own decision, with a test that stops it closing silently |

**Explicitly out of scope, recorded so it is not lost:** retirement assumptions (§6.3), any
`Profile → HouseholdMember` data migration (§6.1), and the V1 retirement/deletion question, which
remains Module 10.

Nothing has been implemented. No schema file, service, controller or surface has been touched.
