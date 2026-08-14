# M5.10 — Planning Experiences: Retirement Planning — Architecture

**Status:** design only. No implementation code written. Awaiting approval.

Audited against `main` at `245801e` (M5.9 merged and verified in production).

---

## 1. Problem definition

Life Capital OS can already *calculate* retirement. It cannot *plan* it.

Three separate things exist and none of them is a planning experience:

| What exists | Where | Why it is not planning |
|---|---|---|
| `computeRetirement` | `packages/core/src/finance/retirement.ts` | A pure function. Complete, correct, and nothing owns its inputs |
| A retirement panel | V2 `/household` dashboard | Reports readiness % and a required SIP, always from **default** assumptions |
| A retirement calculator | V1 `components/RetirementCalculator.tsx` | Computes **in React**, from typed-in numbers, and **persists nothing** |

The V1 component is the exact anti-pattern the milestone brief names: an isolated calculator. Type numbers, see an answer, close the tab, answer gone. It feeds nothing.

The V2 panel is closer but hollow: `usingDefaultAssumptions` is `true` for **every household in the product**, because nothing supplies retirement assumptions. A family cannot say when they want to retire, what life they want, or what they are putting aside — so the panel answers a question nobody asked, using a retirement age of 60 and a lifestyle equal to today's spending.

M5.10 makes retirement a **planning experience owned by the operating system**: the family's intent is stored, the projection is derived from it deterministically, and the result becomes a signal other parts of the system can consume.

---

## 2. Existing architecture (audit)

### 2.1 What is reusable, and will be reused

| Asset | Location | Role in M5.10 |
|---|---|---|
| `computeRetirement` | `core/finance/retirement.ts` | **The** projection engine. Inflation-adjusted lifestyle, required corpus via real-rate annuity, FV of current corpus, required SIP, `onTrack`. Optional tax-aware accumulation |
| `financialFreedomNumber` | same file | Available; not needed for the required scope |
| `retirement` section | `core/finance/financialIntelligence.ts:427` | Already a `Section<T>` with `available/reason`, `readinessPct`, `usingDefaultAssumptions` |
| `IntelligenceAssumptions.retirement` | same file, line 72 | The **typed channel that already exists** — `retirementAge`, `yearsInRetirement`, `inflationRatePct`, `preRetirementReturnPct`, `postRetirementReturnPct`, `currentCorpusMinor?` |
| `DEFAULT_INTELLIGENCE_ASSUMPTIONS.retirement` | same file, line 38 | Documented defaults (60 / 25 / 6% / 10% / 7%) |
| `resolveAssumptions()` | `household-intelligence.service.ts` | **The seam M5.9 built.** Retirement plugs in beside insurance; no call site changes |
| Snapshot `members[].ageYears` | frozen payload | Current age — capturable since M5.8 PR 1 added date of birth |
| Snapshot `cashflowSummary` | frozen payload | `expenseMinor` → today's lifestyle cost; `netMinor` / `savingsRate` → actual monthly surplus |
| Snapshot `assetAllocation` | frozen payload | Investable mix by asset class |
| `HouseholdSimulationService` | `apps/api` | The what-if engine for **snapshot-shaped** scenarios; has a `registry` extension hook |
| `HouseholdScopeGuard`, `FirmRoles`, `assertOwnHousehold` | `apps/api/src/households` | Route scoping and the member-only write boundary, unchanged from M5.8 PR 2 / M5.9 |
| `components/charts/NetWorthTrendChart` | `apps/web` | Prop-driven `{date, net}[]`. **A corpus projection is that shape** |
| Frozen design system | `apps/web/src/ui/*` | Composed, never edited |

### 2.2 What does not exist

1. **No store for retirement planning intent.** Nothing owns retirement age, life expectancy, desired income, or contribution.
2. **`computeRetirement` ignores ongoing contributions.** It answers *"what SIP do I need?"* but never *"given what I am actually saving, where do I land?"* — so §RS-K (projected corpus) and §RS-M (on-track) cannot be answered honestly today.
3. **The snapshot carries no account `type`.** `AccountType.retirement` exists in the schema and household accounts accept it, but the frozen payload's `assets[]` carries `assetClass` only. Retirement-earmarked accounts are invisible to the layer.
4. **Retirement is not in the AI grounding allow-list** (`household-ai.service.ts:20`). The Family CFO cannot see it at all.
5. **No assumption-shaped what-if.** The existing engine mutates a snapshot and re-scores health; it cannot project 25 years forward.

---

## 3. Current retirement data availability

| Required (brief §A–I) | Available today? | From |
|---|---|---|
| **B** Current age | **Yes** | Snapshot `members[].ageYears` (oldest non-dependant) |
| Current lifestyle cost | **Yes** | Snapshot `cashflowSummary.expenseMinor × 12` |
| Actual monthly surplus | **Yes** | Snapshot `cashflowSummary.netMinor` |
| **D** Current corpus | **Proxy only** | Defaults to reconciled net worth — *which includes the family home* |
| **A** Retirement age | **No** | — |
| **C** Desired retirement income | **No** | — |
| **E** Expected contribution | **No** | — |
| **F** Inflation | Default only | `DEFAULT_INTELLIGENCE_ASSUMPTIONS` |
| **G/H** Pre/post-retirement return | Default only | same |
| **I** Life expectancy / horizon | Default only | same (`yearsInRetirement: 25`) |
| **J–M** Corpus, projection, gap, status | **Derived** | `computeRetirement` — but see §2.2(2) |

---

## 4. Required new data

Only what a family must **state**, because it cannot be observed:

`retirementAge` · `lifeExpectancy` · `desiredAnnualIncomeMinor` · `monthlyContributionMinor` · `currentCorpusMinor` (override) · `inflationRatePct` · `preRetirementReturnPct` · `postRetirementReturnPct`

Everything else is derived from the snapshot or computed. **No new data is stored that the kernel already knows.**

---

## 5. Source of truth for each field

| Field | Source of truth | Formula / rule |
|---|---|---|
| Current age | **Snapshot** | Oldest non-dependant `ageYears` (`primaryAgeOf`) |
| Current annual expenses | **Snapshot** | `cashflowSummary.expenseMinor × 12` |
| Desired retirement income | **Plan**, else snapshot | `desiredAnnualIncomeMinor ?? currentAnnualExpenses`. The fallback is a *sourced* number, not a guess |
| Retirement age | **Plan**, else default | `?? 60` — flagged as a default |
| Years in retirement | **Plan**, else default | `lifeExpectancy − retirementAge`, else `25` |
| Inflation, pre/post return | **Plan**, else default | Documented market assumptions, flagged |
| Current corpus | **Plan**, else snapshot | `currentCorpusMinor ?? investable assets` (see §5.1) |
| Monthly contribution | **Plan only** | **No default exists** (see §9) |
| Required corpus, projection, gap, SIP, status | **Computed** | `computeRetirement` — never stored |

### 5.1 The corpus question, and why it is answered this way

Today the layer uses **reconciled net worth** as the retirement corpus. That includes the family home, which nobody sells to buy groceries at 70. It is a proxy, and a generous one.

Three candidate sources:

| Option | Verdict |
|---|---|
| (i) Reconciled net worth *(today)* | Overstates — includes residential property |
| (ii) Snapshot `assetAllocation` **excluding `real_estate`** | Snapshot-only, no schema change, materially better |
| (iii) Accounts with `type = 'retirement'` | **The truthful answer** — and impossible today: the frozen payload does not carry account `type` |

**Recommendation: (ii) as the derived default, with the plan's explicit `currentCorpusMinor` overriding it.**

Critically, this needs **no change to the existing dashboard figure and no core edit**: `assumptions.retirement.currentCorpusMinor` is *already* an override the composer honours (`financialIntelligence.ts:439`). The planning service supplies it. Families with no plan keep exactly today's behaviour, so there is no silent re-statement of a number already shown.

Option (iii) is recorded as an open decision (§20) because it requires either a snapshot schema change — frozen at `schemaVersion 1` — or a documented exception to the "read the snapshot, never the tables" rule. **Neither is in M5.10's scope.**

---

## 6. Domain / service ownership

```
HouseholdRetirementService            ← owns the plan; loads assumptions; NO arithmetic
        │
        │  assumptionsFor(householdId) → IntelligenceAssumptions['retirement']
        ▼
HouseholdIntelligenceService.resolveAssumptions()   ← the M5.9 seam, extended by one line
        │
        ▼
computeHouseholdFinancialIntelligence()  ← unchanged composition
        └── computeRetirement()          ← @lcos/core, the ONLY place retirement maths lives
```

Ownership rules, matching the milestone's rules 10–12:

- **Arithmetic lives only in `@lcos/core`.** The service selects and aggregates; it never derives a figure.
- **The controller carries no logic** — parameters in, service result out.
- **React computes nothing.** `/household/retirement` renders fields the service returned. V1's `RetirementCalculator.tsx` — which *does* compute in React — stays untouched on `/dashboard` as the safety net.

**This deliberately does not copy Protection.** Protection had to invent a store because insurance is unobservable. Retirement is different in two ways: the layer already has a typed assumptions channel, and market assumptions have *defensible documented defaults*. So M5.10 fills an existing channel rather than building a parallel one, and its null-semantics differ (§9).

---

## 7. Calculation model

Every number, its formula, and its source. All monetary values are base-currency minor units.

| Output | Formula | Source of inputs |
|---|---|---|
| Years to retirement | `max(0, retirementAge − currentAge)` | plan + snapshot |
| Inflated annual need | `desiredAnnualIncome × (1+i)^years` | plan/snapshot |
| **Required corpus** | real-rate annuity PV over `yearsInRetirement` | `corpusForDrawdown` |
| Projected from current | `corpus × (1+r_pre)^years` | existing |
| **Projected from contributions** | FV of a monthly annuity at `r_pre` | **new (§7.1)** |
| **Projected corpus at retirement** | the two projections summed | **new** |
| **Surplus / shortfall** | `projectedTotal − requiredCorpus` | **new** |
| Required monthly SIP | `sipForTarget(gap, r_pre, years)` | existing |
| Status | surplus ≥ 0 → **On Track**; shortfall ≤ 10% of required → **Watch**; else **At Risk** | derived |

Determinism: `computeRetirement` is already pure — no clock, no randomness, no IO. The status thresholds are constants, not tuned per household.

### 7.1 The one core change proposed

`RetirementResult` today reports the *required* SIP but never the corpus a family's **actual** contributions produce. Without it, "Am I on track?" (§RS-M) and "projected corpus at retirement" (§RS-K) cannot be answered — only "here is a SIP number".

**Additive, and behaviour-preserving for every existing caller:**

```ts
// RetirementInput
monthlyContributionMinor?: number;   // omitted → 0

// RetirementResult — new fields, existing ones byte-identical
projectedCorpusFromContributions: Money;
projectedCorpusAtRetirement: Money;   // = fromCurrent + fromContributions
surplusOrShortfallMinor: Money;       // signed: positive = surplus
```

`onTrack`, `corpusGap`, `monthlySipRequired`, `requiredCorpus` and `projectedCorpusFromCurrent` keep their present definitions **exactly**, so V1's `/insights` path and the existing dashboard panel cannot move. A regression test will pin the whole existing result for a caller that omits the new field.

This is a calculator extension, not a Financial Kernel change — the same category and shape as the `boolean | null` widening in #67. If declined, M5.10 can still ship §A–J and §N, but §K/L/M reduce to "here is the SIP you would need", which is the calculator we already have.

---

## 8. Assumptions model

One row per household. Every column nullable; `null` means **not stated**, never zero.

The service resolves each field to a value **plus its provenance**, and returns that provenance to the client:

```
{ value: 60, source: 'default' }      // documented assumption
{ value: 62, source: 'stated' }       // the family said so
{ value: 900000_00, source: 'derived' } // computed from the snapshot
```

This satisfies rule 8 (*every important number has a clear source*) at the API boundary rather than in a comment, and lets the UI say "based on a standard assumption" beside the specific figures that are assumed — replacing today's single blunt `usingDefaultAssumptions` flag, which is retained for backward compatibility.

---

## 9. Unknown / null semantics — and where they differ from Protection

The brief warns against copying Protection. The distinction is principled:

| Field | Has an honest default? | Behaviour when unstated |
|---|---|---|
| Retirement age | **Yes** — 60 is a documented convention | Use it, flag as `default` |
| Life expectancy / horizon | **Yes** — 25 years | Use it, flag |
| Inflation, pre/post return | **Yes** — documented market assumptions | Use it, flag |
| Desired retirement income | **Yes** — today's expenses, a *sourced* figure | Use it, flag as `derived` |
| Current corpus | **Yes** — investable assets from the snapshot | Use it, flag as `derived` |
| **Monthly contribution** | **NO** | **Projection unavailable** |

That last row is the one place Protection's semantics genuinely apply. Assuming a family saves ₹X a month for retirement is fabrication of exactly the kind rule 9 forbids — and it is the input the answer is most sensitive to. So:

- Without a stated contribution, the retirement section reports **required corpus, current projection and required SIP** (all honestly derivable), and reports `projectedCorpusAtRetirement` / status as **unavailable with a reason**.
- The family is asked for it once, on the planning surface.

**A contribution of zero is a valid stated answer** ("I am not saving for retirement yet") and produces a real At Risk status — a finding, not silence. Same distinction as Protection's `false` versus `null`.

---

## 10. Snapshot interaction

- **Read-only. No snapshot is created, mutated or re-captured.** ADR-013 holds.
- The plan is **current-state**, the snapshot is **point-in-time**. Editing your retirement age must not require re-running a Wealth Health Check, and must not rewrite history.
- Known and accepted consequence, identical to Protection's: intelligence composed for a *historic* snapshot uses *today's* plan. Assumptions are not versioned per snapshot. Stated here rather than discovered later.
- `FinancialSnapshotPayload` stays frozen at `schemaVersion 1`. A retirement plan is an intention, not a position; it does not belong in the kernel's record of what a family owns.

---

## 11. API design

Additive. No existing route, response shape or parameter changes.

| Endpoint | Purpose |
|---|---|
| `GET /households/:id/retirement` | The plan, resolved assumptions with provenance, projection, status, recommendations |
| `PUT /households/:id/retirement` | Upsert the household's single plan |
| `POST /households/:id/retirement/what-if` | Deterministic scenarios; **persists nothing** |

- `HouseholdScopeGuard` (404-not-403) on all three, as every sibling route.
- Writes additionally require `assertOwnHousehold` — the actor must be a `HouseholdMember` with `userId` set. An advisor stating a client's retirement intent is entering a preference they cannot hold; same boundary as goals (M5.8 PR 2) and protection (M5.9).
- `PUT` is an upsert because there is exactly one plan per household; there is no create/delete lifecycle to model.
- Audit logs record **field names only**, never values.

---

## 12. UI architecture

One native surface, `/household/retirement`, following the brief's narrative:

```
WHERE I AM      → age, today's lifestyle cost, current corpus (with provenance)
WHERE I'M GOING → retirement age, desired income, life expectancy
WHAT I NEED     → required corpus, inflated annual need
AM I ON TRACK?  → projected corpus vs required · surplus/shortfall · status badge
WHAT DO I DO?   → ranked recommendations, each with its projected impact
WHAT IF…        → scenario controls
```

- Composed **only** from the frozen design system plus the existing `components/charts/`.
- **The corpus projection reuses `NetWorthTrendChart`** — it takes `{date, net}[]`, which is the shape of a year-by-year projection. No new chart component unless that proves inadequate.
- The dashboard's existing Retirement panel gains a link here. **No dashboard redesign** (rule 16).
- Zero arithmetic in React: every figure is a field the service returned.
- Follows the M5.8 PR 2 rate-limit rule — `resolveHouseholdId` once per page, passed to each call.

---

## 13. What-if integration

The brief forbids a second competing engine. The audit shows why none is needed — and why the existing one cannot simply be pointed at retirement:

| Engine | Shape | Answers |
|---|---|---|
| `simulateFinancialWhatIf` | Mutates a snapshot, re-scores health | *"How does this change my Wealth Health score?"* |
| `computeRetirement` | Projects assumptions forward | *"Where do I land in 2050?"* |

`retirement_contribution` already exists as a scenario type in the simulation engine — but it moves money from expense to an asset class for **one month** and re-scores. It cannot project decades.

**Rule: a scenario that changes a planning assumption is a re-run of `computeRetirement` with different inputs. A scenario that changes a financial position belongs to the simulation engine.**

Re-invoking the same pure function with varied arguments is not a second engine — it is the defining use of a pure function. No new simulation code, no new registry entry, no fork of the scoring path.

Scenarios exposed (all deterministic, all supported by the calculation):

| Scenario | Changes |
|---|---|
| Retire earlier / later | `retirementAge` ± n |
| Increase monthly contribution | `monthlyContributionMinor` |
| Increase existing corpus | `currentCorpusMinor` |
| Change retirement income target | `desiredAnnualIncomeMinor` |

Deliberately **not** exposed: return and inflation scenarios. They are the assumptions the projection is least able to justify, and offering "what if I earn 15%?" invites a family to plan on it.

---

## 14. AI Family CFO integration boundary

`GroundedAnalysis` (`household-ai.service.ts:20`) is an **allow-list by design** — a section reaches the model only when someone adds it deliberately. Retirement is not there today.

Proposal: add `retirement` as one named field. Consequences:

- The Family CFO can answer *"Can I afford to retire at 55?"* from the platform's own computed projection, instead of the position it is in today — the question that started the #59 investigation, answered with no retirement figures at all.
- **The AI never becomes the source of truth.** It receives the computed section as settled fact, exactly as it receives `wealthHealth` and `risk`, and is already instructed never to recompute a number.
- The section is PII-light: figures, status and reasons only, no names or dates of birth.

This is the whole of the M5.10 AI work. **No coach prompt redesign, no new AI surface.**

---

## 15. Testing strategy

Assert on values, not on status codes or element existence. Every new test verified to fail against a deliberate regression before it is trusted.

**Core unit (`retirement.test.ts`)**
1. A worked projection to fixed expected figures — required corpus, both projections, gap, SIP
2. Determinism — same input, same output across repeated calls
3. Zero years to retirement; contribution of zero; corpus already exceeding required (surplus, not a negative gap)
4. **The V1 regression pin**: omitting `monthlyContributionMinor` reproduces today's whole result byte-for-byte
5. Monotonicity as a property: more contribution never lowers the projection; retiring later never raises the required corpus for a fixed horizon

**API e2e (`household-retirement.e2e-spec.ts`)**
6. Upsert and read back; assert on the row, not the echo
7. **Unstated contribution → projection and status unavailable with a reason**; required corpus still reported
8. **A stated contribution of zero → At Risk**, not silence (the Protection distinction)
9. Provenance: unstated retirement age reports `source: 'default'`; stated reports `'stated'`
10. Stating a corpus overrides the snapshot-derived default, and the dashboard's retirement figure moves with it
11. What-if: retiring 5 years later lowers the required corpus; the response persists nothing (plan unchanged after)
12. Household isolation — another household is a 404; advisor write is 403
13. Requires authentication
14. **No snapshot is created or mutated** by any retirement call

**Regression protection**
15. The existing dashboard retirement panel is unchanged for a household with no plan
16. V1 `/insights` retirement figures unchanged

**Browser smoke**
17. Native surface, no `temporary-surface-notice`; state a plan, see status change on `/household`
18. Dark-mode contrast on `/household/retirement`

**Teeth note.** M5.8 PR 2 shipped an absence assertion that passed while the fetch was still in flight. Test 7 asserts absence and must therefore wait on a positive signal before asserting, not merely check that something is missing.

---

## 16. Security and household isolation

- Every route `HouseholdScopeGuard`-scoped; out-of-scope households 404, never 403 (no existence disclosure).
- Writes require household membership as self (§11). No change to the authentication kernel.
- No new PII: the plan holds ages, amounts and rates — no names, no dates of birth, no identifiers. **No new encryption surface**, and `FIELD_ENCRYPTION_KEY` behaviour is untouched.
- Audit metadata records changed field names only.
- Rate limiting: the surface resolves the household id once and passes it on, per the M5.8 PR 2 finding.

---

## 17. Migration requirements

**Yes — one new table is required.** The brief says not to invent schema changes, so here is the argument.

Three candidates were considered:

| Candidate | Why not |
|---|---|
| Reuse `Goal` with `type = 'retirement'` | A goal has a **stated** `targetAmountMinor`. A retirement target is **derived** from income × inflation × longevity. Storing it in `Goal` would freeze a computed number as an input — breaking rules 8 and 9 — and it would go stale the moment expenses change. `Goal` also has no field for inflation, split pre/post returns, life expectancy, desired income or contribution; adding six columns to a model V1 retail goals share is worse than a purpose-built table |
| Columns on `Household` | `Household` is kernel-adjacent. `M5_FINANCIAL_INTELLIGENCE_LAYER.md` is explicit that module-owned inputs live in the module's own tables |
| **New `RetirementPlan` table** | **Recommended** |

```
RetirementPlan
  id                        String   @id
  householdId               String   @unique   -- exactly one plan per household
  firmId                    String?            -- scoping, consistent with Goal
  retirementAge             Int?
  lifeExpectancy            Int?
  desiredAnnualIncomeMinor  BigInt?
  monthlyContributionMinor  BigInt?
  currentCorpusMinor        BigInt?
  inflationRatePct          Float?
  preRetirementReturnPct    Float?
  postRetirementReturnPct   Float?
  createdAt / updatedAt
```

- **All planning columns nullable, no defaults, no backfill.** `null` is "not stated"; a default in the column would erase the distinction between a family's choice and ours.
- Purely additive: a new table, no existing table altered, nothing re-keyed, no data migration.
- `@unique` on `householdId` makes "one plan per household" a database guarantee rather than a service convention.

---

## 18. Rollback

`git revert`, plus a dropping migration if the table is unwanted. Nothing outside M5.10 depends on it: a household with no plan resolves to today's documented defaults, which is exactly current behaviour. Reverting loses stated plans and returns every household to `usingDefaultAssumptions: true` — no corruption, no orphaned references, no re-keying.

---

## 19. Explicit non-goals

Not in M5.10: NPS / EPF / PPF product integration or statement import · tax-optimised withdrawal sequencing · annuity or pension product recommendations · separate retirement dates per member (the projection uses the primary adult) · Monte Carlo or probabilistic confidence bands · healthcare-cost modelling · any Super Human Advisor™ workflow or booking · changes to the Wealth Health scoring model or `FINANCIAL_HEALTH_MODEL_VERSION` · goals reaching the snapshot · the self-member naming issue · removal of `TemporarySurface` or any V1 component.

---

## 20. Open architectural decisions

Recorded for your decision; **none is settled by this note**.

1. **Corpus source (§5.1).** Ship snapshot-derived investable assets now, or hold for account-`type` visibility — which needs a frozen-contract change. *Recommendation: derive now, revisit with real usage.*
2. **Should retirement become an early-warning signal or a health-score category?** It is currently neither. Either would change scored output and, for the score, `FINANCIAL_HEALTH_MODEL_VERSION` — re-banding every stored score. *Recommendation: no, for the same reason as M5.9 decision 4. Surface the status in the section and the AI grounding only.*
3. **Whose retirement, in a multi-adult household?** The projection uses the oldest non-dependant. A couple with a 10-year age gap has one plan and one date. *Recommendation: accept for M5.10, name it in the UI.*
4. **Accept the §7.1 core extension?** Without it §K/L/M cannot be answered honestly. *Recommendation: yes — additive, V1-neutral, and pinned by a regression test.*

---

## 21. Files expected to change

| File | Change |
|---|---|
| `apps/api/prisma/schema.prisma` + one migration | **New** `RetirementPlan` table (§17) |
| `apps/api/src/households/household-retirement.{service,controller,dto}.ts` | **New** — plan CRUD, assumption resolution, what-if |
| `apps/api/src/households/household-intelligence.service.ts` | `resolveAssumptions` gains retirement — one line plus a dependency |
| `apps/api/src/households/households.module.ts` | Wiring |
| `apps/api/src/households/household-ai.service.ts` | `retirement` added to the grounding allow-list (§14) |
| `packages/core/src/finance/retirement.ts` | Additive contribution projection (§7.1) |
| `packages/core/src/finance/financialIntelligence.ts` | Surface the new fields in the `retirement` section |
| `apps/web/src/app/household/retirement/page.tsx` | **New** native surface |
| `apps/web/src/lib/householdRetirement.ts` | **New** client |
| `apps/web/src/app/household/page.tsx` | A link to the new surface. No redesign |
| Tests | `retirement.test.ts` · `household-retirement.e2e-spec.ts` · `smoke.spec.ts` |
| `docs/V2_PRIMARY_MIGRATION_PLAN.md` | Status |

**Untouched:** Financial Kernel · snapshot payload and `schemaVersion 1` · `financialHealth.ts` and the model version · Protection · retail `Profile` · every V1 component including `RetirementCalculator.tsx` · `TemporarySurface`.
