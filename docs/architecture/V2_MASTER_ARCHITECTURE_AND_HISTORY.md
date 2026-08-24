# Life Capital OS™ V2 — Master Architecture & History

> **Read-only audit.** No code was modified in producing this document.
> **Audited at:** `main` = `9311324` (merge of PR #70, M5.10), 2026-08-16.
> **Method:** reconstructed from git history, merged PRs, migrations, code and tests — **not** from
> roadmap claims. Every non-obvious assertion carries evidence. §13 classifies confidence and lists
> what could not be established.
>
> **Addendum, 2026-08-24.** Sections 7 and 13 and the §1.2 timeline have been extended past the
> audited commit to record work completed since: `f001925` (production build identity) and
> `8de6932` (M5.11, Goals become a signal), both on
> `claude/life-capital-module-1-roadmap-8ulqh1` and **not yet merged**. Everything else remains as
> audited at `9311324`.
>
> **Path shorthand used in tables:** `core/…` = `packages/core/src/…`; a bare
> `household-*.service.ts` = `apps/api/src/households/…`; a bare `components/*.tsx` =
> `apps/web/src/components/…`. Paths given in full elsewhere are literal.

---

## 0. Headline findings

Six things an audit surfaces that a roadmap does not:

1. **M4 has two conflicting definitions in the repository.** The one that was *built* is **Dashboard
   Foundation**; the one in the blueprint roadmap is **AI agent fleet & orchestration**, which was
   never built under that number. §2 resolves this from merged code.
2. **M5.5 → M5.8 required no schema change at all.** Across the 30-day span from `20260715120000`
   to `20260814152922` — consumer activation, the household dashboard, V2 primary, AI insights,
   Family, Goals and charts — exactly one migration landed, `20260806153040_add_login_attempt_lockout`,
   and it belongs to the **auth kernel**, not to any of those features. No consumer feature in that
   span added a table or a column. Confirmed by `ls apps/api/prisma/migrations`.
3. **The Wealth Health Score ignores both Protection and Retirement**, and always has. Verified in
   code, not inferred: `financialHealth.ts:44-48` weights exactly five categories.
4. **Two full generations of product coexist by design.** V1 (May–June 2026, retail `userId`-keyed)
   is still live at `/dashboard`; V2 (July–August 2026, household-keyed) is primary at `/household`.
5. **Three of the eighteen capabilities audited in §6 do not exist in any form** — Estate & Legacy,
   Tax Planning, Document Vault. Each appears in blueprint documents; none has code. A further
   **three are built but not reachable or not consequential for a family**: Budget and What-if have
   no V2 consumer surface, and Asset Allocation analyses without recommending. (Goals was a fourth
   at the time of the audit — it had a surface that moved no figure. M5.11 closed that; see §7
   Gap 1.)
6. **One of the three "known gaps" is not shaped the way it was reported.** Gap 3 is real but
   narrower and located elsewhere than stated. §7 gives the corrected version.

---

## 1. Reconstructed V2 timeline

### 1.1 Two numbering series, and a V1 that predates V2

Git history contains **two PR series** because the repository moved owner:

| Series | Owner | PRs | Dates | What it is |
|---|---|---|---|---|
| First | `xploroshan` | #6–#23 | 2026-05-31 → 2026-06-14 | **V1** — the retail product |
| Second | `dipankarnath2458` | #1–#70 | 2026-07-03 → 2026-08-16 | **V2** — the household platform |

**V1 is not a discarded prototype.** It shipped the AI Wealth Coach (`46107ef`), AI Second Opinion
(`ad7a751`), Early Warning System, Goals, Family CRUD and Wealth DNA (`37f7b7c`) — all retail,
keyed on `User.id`. Those components still render at `/dashboard` today and are the documented
rollback path until Module 10.

**V2 begins 2026-07-13** with migration `20260713193315_add_tenancy_firm_household`.

### 1.2 Milestone-by-milestone

Totals, all counted from the tree at `9311324`: **221 commits**, **16 migrations** (3 V1-era from
May–June 2026, 13 V2-era), **13 ADRs**, **32 API e2e specs**, **11 core test files**, **8 API unit
specs**, **35 browser smoke cases** in 12 groups.

---

#### M1 — Tenancy & Advisory Scoping · **COMPLETE**

**Purpose.** Introduce the Firm → Household → Member hierarchy that V1 lacked, so a family (not a
user) becomes the unit of account.

| | |
|---|---|
| **Database** | `20260713193315_add_tenancy_firm_household`, `20260713202527_add_user_active_firm`, `20260714061149_add_advisory_scoping_columns` (M1b), `20260714103845_promote_account_household_relations`, `20260714110322_promote_networth_snapshot_household` |
| **API** | `apps/api/src/firms/`, `apps/api/src/households/` (`households.service.ts`, `household-members.service.ts`, `entities.service.ts`) |
| **Web** | `/app` advisor workspace shell (`090f069`) |
| **Key commits** | `497da32` (M1-5 members & entities), `0742bd0` (M1-6 advisory scoping), `090f069` (M1-7 workspace shell) |
| **Architecture** | ADR-001 Household as aggregate root · ADR-002 `HouseholdScopeGuard` (404-not-403) |
| **Lives today** | `apps/api/src/households/household-scope.guard.ts` — used by **every** household route since |

The M1b decision to make `firmId`/`householdId`/`memberId` **nullable and additive** on finance
models is why M5.8 could ship household Goals with **no migration** — the columns were already
there. Confirmed: `apps/api/prisma/schema.prisma` `Goal` model, lines 499-503.

Individual labels M1-1…M1-4 are not present in commit subjects. **INFERRED** from module presence.

---

#### M2 — The Financial Kernel · **COMPLETE, FROZEN** — see §3

Six sub-modules, all merged 2026-07-14, all still the foundation. Detailed in §3.

---

#### M3 — Financial Intelligence (scoring, explanation, simulation) · **COMPLETE** — see §4

| Sub | Commit | Date |
|---|---|---|
| M3-1 Financial Health Score | `42a7693` (api), `4697e3b` (web) | 2026-07-15 |
| M3-2 Explainable engine | `84ae57a` (api), `b3b291f` (web) | 2026-07-15 |
| M3-3 What-if Simulation | `12a199f` (api), `d2c561c` (web) | 2026-07-15 |

**Database:** `20260715052842_add_financial_health_score`.
**Architecture:** ADR-013 — simulation via transient virtual snapshots, persisting nothing.

---

#### M4 — Dashboard Foundation · **COMPLETE (as built)** — see §2 for the naming conflict

| | |
|---|---|
| **Design** | `docs/architecture/M4_DASHBOARD_FOUNDATION.md`, commit `573d58b` (2026-07-15) |
| **Implementation** | `af5d34a` reusable dashboard components + `useCurrentHousehold`; `e7fad41` Wealth Health Check dashboard as `/app` home (both 2026-07-16) |
| **Database** | **None** — the design's explicit non-goal |
| **Lives today** | `apps/web/src/components/dashboard/` (7 components), imported **only** by `apps/web/src/app/app/page.tsx` |

---

#### M5 — Financial Intelligence Layer · **COMPLETE**

The single composed read-model over the kernel.

| | |
|---|---|
| **Core** | `ef977a4` — `packages/core/src/finance/financialIntelligence.ts` |
| **API** | `e79c7ac` — `apps/api/src/households/household-intelligence.{service,controller}.ts` |
| **Database** | **None** |
| **Design** | `docs/architecture/M5_FINANCIAL_INTELLIGENCE_LAYER.md` |

Invents no new maths — composes M3-1, M3-2, emergency fund, insurance gap, retirement, asset
allocation and early warning into one `HouseholdFinancialIntelligence` object of `Section<T>`s.

---

#### M5.5 — Consumer activation · **COMPLETE**

PRs #48–#50. Consumer household provisioning, consumer onboarding, the Wealth Health Check.
Introduced `hasOwnHousehold` as the post-login routing signal — the fact that later caused the
#52 hotfix and shaped M5.8 PR 1's delete guard. **No migration.**

---

#### M5.6 — Household Dashboard · **COMPLETE**

PR #51, commit `142e4d5`. `apps/web/src/app/household/page.tsx` — the canonical V2 consumer
surface, reading one `/intelligence/current` call so no two panels can disagree. **No migration.**

---

#### M5.x — V2 becomes primary · **COMPLETE**

PR #53, commit `c4749b7`. Consumers route to `/household`; V1 preserved at `/dashboard`.
Design: `docs/V2_PRIMARY_MIGRATION_PLAN.md`, `docs/V1_RETIREMENT_PLAN.md`.

---

#### M5.7 — AI Family CFO on the Intelligence Layer · **COMPLETE**

PR #56, commits `b0d1c57` + `1bf7218`. Native `/household/coach`.
**Lives today:** `apps/api/src/households/household-ai.service.ts` — grounding assembled by a
**named allow-list**, never a spread.

---

#### Hotfix cluster (#55, #57, #58, #59, #61, #67) · **COMPLETE**

A recurring defect class worth recording as history, because it repeated four times: **a figure
with two definitions, where the obvious name held the wrong one.**

| PR | Defect |
|---|---|
| #55 | Net worth reported before the debt ledger (`68c6cd8`) |
| #57/#58 | Money unformatted in the summary; free-tier summary called the model (`5b73411`) |
| #59 | AI grounding used gross, not reconciled, net worth |
| #61 | Wealth Health Check appended instead of updating (`56f3e50`) |
| #67 | Unknown insurance asserted as "no insurance" (`c458fda`) |

---

#### M5.8 — Family, Goals, Charts, Early-warning parity · **COMPLETE** — see §5

PR #64 (`4a9ecc1`) and PR #65 (`f9cd8f0`). **No migration.**

---

#### M5.9 — Protection / Insurance Intelligence · **COMPLETE** — see §5

PR #66 (design), #67 (hotfix), **#68** (`94c9650`) implementation.
**Database:** `20260814152922_add_household_member_protection`.

---

#### M5.10 — Retirement Planning · **COMPLETE, MERGED** — see §5

PR #69 (design, `df3bac9`), **PR #70 merge commit `9311324`**, implementation commit `132c072`.
**Database:** `20260814171645_add_retirement_plan`.

---

#### M5.10a — Production build identity · **COMPLETE, UNMERGED** (2026-08-24)

Commit `f001925`. Remediates the method problem this audit hit in §13: production could not name
its own build. `/api/health` reports `commit`; `scripts/verify-deployment.mjs` gained a Build
identity section with control-first route probes; `apps/api/test/deployment-identity.e2e-spec.ts`
pins the behaviour the external check depends on. **No migration. No schema change.**

---

#### M5.11 — Goals become a signal · **COMPLETE, UNMERGED** (2026-08-24)

Commit `8de6932`. Closes Gap 1 (§7) and Gap 4. Goals reach the Financial Intelligence Layer as a
module-owned assumption — `HouseholdGoalsService.assumptionsFor()` → `resolveAssumptions()` →
`EarlyWarningInput.goalSlippage` — the same route Protection (M5.9) and Retirement (M5.10) take.
The slippage definition was consolidated into `@lcos/core` (`planGoalAsOf`) and both V1 call sites
refactored onto it, removing a duplicated month calculation that existed twice in the API. The
score model is now pinned by test so M5.12 cannot change it accidentally.
Design: `docs/M5_11_GOALS_SIGNAL_ARCHITECTURE.md`. **No migration. No kernel contract change. No
score change.**

---

## 2. What exactly was M4? — definitive reconstruction

### 2.1 The conflict, stated plainly

The repository contains **two incompatible definitions of M4**, plus a third false positive.

| # | Definition | Source | Built? |
|---|---|---|---|
| **A** | **M4 — Dashboard Foundation** | `docs/architecture/M4_DASHBOARD_FOUNDATION.md:1` | **YES** |
| **B** | **M4 — AI agent fleet & orchestration** | `docs/blueprint/09_ROADMAP.md:67`, `docs/blueprint/10_DEPENDENCIES_RISKS.md:96`, `docs/releases/RELEASE_v2_FINANCIAL_KERNEL.md:146` | **NO** |
| **C** | "M4" as step 4 of the V1 retirement plan | `docs/V1_RETIREMENT_PLAN.md:116-160` | Not a milestone — **false positive**, a local step numbering inside one document |

A fourth reference, `docs/blueprint/05_DATA_MODEL.md:413` ("M4 — notifications & email"), is a
**third** variant. `Notification`, `NotificationPreference` and `EmailOutbox` do **not** exist in
`schema.prisma`. Not built.

### 2.2 Which is authoritative

**Definition A — Dashboard Foundation — is authoritative**, on four independent grounds:

1. **It has a design document with a milestone number in its title**, and no other M4 document does.
2. **It was implemented the next day.** Design `573d58b` (2026-07-15) → implementation `af5d34a`
   and `e7fad41` (2026-07-16).
3. **The implementation matches the design's named artefacts exactly** — `ScoreCard`,
   `AiCfoPanel`, `HouseholdSelector`, `NetWorthCard`, `FamilySummaryCard`, `RecentActivity`,
   `QuickActions`, `useCurrentHousehold`. All seven components exist today in
   `apps/web/src/components/dashboard/`.
4. **`V2_ARCHITECTURE.md` — the V2 document, not the pre-V2 blueprint — places M4 as "Dashboard
   Foundation" between M3 and M5** (lines 59-60).

Definition B belongs to `docs/blueprint/`, which is the **pre-V2 product blueprint**. Its numbering
was superseded when V2 execution began; the AI work it describes as "M4" actually shipped as
**M5.7** (PR #56), grounded on the M5 layer rather than as an autonomous agent fleet.

### 2.3 M4, as built

- **Name:** M4-1 Dashboard Foundation (for Wealth Health Check™)
- **Objective:** the first production-quality customer dashboard — the post-login home — answering
  *"How financially healthy is my family?"*, plus a reusable card system future scores plug into.
- **Sub-modules:** one, M4-1. `M4_DASHBOARD_FOUNDATION.md:164` mentions a future "Risk M4-x" that
  was never defined or built.
- **Implemented:** layout, household selector, live `NetWorthCard`, `FamilySummaryCard`,
  `RecentActivity`, `QuickActions`, `ScoreCard` with a `coming_soon` state, `AiCfoPanel`
  placeholder, `useCurrentHousehold` persistence.
- **Deferred by design:** all score maths, all AI logic, any backend or schema change. The design
  states these as explicit non-goals.

### 2.4 Does M4 still exist as an architectural boundary?

**Partly — and it has been superseded as the consumer experience.**

- The **code boundary survives**: `apps/web/src/components/dashboard/` is intact and is the
  advisor-facing dashboard at `/app`.
- The **product boundary is gone**: M4's `/app` was "the home page after login". Since PR #53
  (`c4749b7`) consumers land on `/household` (M5.6), not `/app`. M4's dashboard is now the
  **Advisor Workspace**, not the customer home.
- **`ScoreCard`'s extension seam was not used.** The design intended future scores to plug into it.
  Protection (M5.9) and Retirement (M5.10) instead render as `Panel` components on M5.6's
  `/household`. The seam is unused and, for consumers, superseded.

### 2.5 What of M4 was replaced

| M4 artefact | Status today | Replaced by |
|---|---|---|
| `/app` as post-login home | Advisor-only | M5.6 `/household` (PR #51, #53) |
| `AiCfoPanel` placeholder | Still a placeholder in `/app` | M5.7 native `/household/coach` |
| `ScoreCard` `coming_soon` seam | Unused | M5.6 `Panel` + `Section<T>` |
| `NetWorthCard`, `FamilySummaryCard`, `HouseholdSelector`, `RecentActivity`, `QuickActions` | **Live**, advisor `/app` | — |

**Design decisions from M4 that outlived it:** presentation-only milestones are legitimate;
compose the frozen `@/ui` design system rather than editing it; pending state must be conveyed in
text and not colour alone (accessibility). All three are still followed.

---

## 3. The M2 Financial Kernel — current state

### 3.1 Sub-modules

| Sub | Owns | Calculates | Frozen? | Code |
|---|---|---|---|---|
| **M2-1 FX boundary** | Nothing persisted | Currency conversion, **only inside the domain layer** (ADR-003) | Yes | `packages/core/src/finance/fx.ts` (`4774b54`) |
| **M2-2 Household Accounts** | `Account` (household-scoped, entity-owned), native currency per account | Nothing — storage + scoping | Yes | `household-accounts.service.ts` (`84e2fcd`) |
| **M2-3 Net Worth & Snapshots** | `NetWorthSnapshot` | Assets − liability **accounts**; multi-currency aggregation | Yes | `household-networth.service.ts`, `core/finance/networth.ts` (`4fa9b77`) |
| **M2-4 Cashflow & Budget** | `Transaction`, `Budget` | Income/expense/net, savings rate, per-category; budget variance | Yes | `household-cashflow.service.ts`, `household-budget.service.ts` (`13dd76f`) |
| **M2-5 Debt & Payoff** | `Debt`, `DebtSnapshot` | Outstanding, EMI totals, weighted rate, payoff strategies | Yes | `household-debt.service.ts`, `core/finance/debt.ts` (`b6bd2e6`) |
| **M2-6 Financial Snapshot seam** | `FinancialSnapshot` (immutable, checksummed) | **Composes only** — no new maths | **Yes — contract frozen at `schemaVersion 1`** | `household-financial-snapshot.service.ts`, `core/finance/financialSnapshot.ts` (`ad8f78b`) |

There is also **M2-7 Family Balance Sheet UI** (`ac93803`) — a web surface, not a kernel engine.

### 3.2 Invariants (all verified in code or tests)

1. **Snapshots are immutable.** Never rewritten; `status` moves `active → superseded`. ADR-004.
2. **The payload contract is frozen at `schemaVersion 1`**, additive-only. Enforced by
   `packages/core/src/finance/kernelContract.test.ts`, which pins `REQUIRED_KEYS` and
   `OPTIONAL_KEYS = ['members']` — a stray or renamed field fails the build.
3. **Consumers read snapshots, never raw tables.** ADR-012.
4. **Two liability views, reconciled in exactly one place.** `netWorth.netWorthMinor` (assets −
   liability *accounts*) vs `householdEquity.reconciledEquityMinor` (that − the M2-5 debt ledger).
   ADR-012 resolves the double-count deferred by ADR-011. **This is the definition that caused
   #55 and #59** when the wrong one was read.
5. **FX only in the domain layer.** No converted amount is stored. ADR-003.
6. **Amounts are integer minor units** everywhere; conversion to major happens at presentation.
7. **`status: 'void'`** is the kernel's "no longer counts"; cashflow filters it out.
8. **Encryption at rest** for PII (`HouseholdMember.name`, `Household.name`, `Profile.fullName`).
   ADR-006, AES-256-GCM, wrong key **throws** rather than yielding junk.

### 3.3 The actual kernel flow — corrected

The commonly drawn chain is a simplification. The real graph, from code:

```
Accounts (M2-2) ─┐
Cashflow (M2-4) ─┤
Debt (M2-5) ─────┼──► Net Worth (M2-3) ──┐
Members (M1-5) ──┘                       │
                                         ▼
                    Financial Snapshot (M2-6) — IMMUTABLE, schemaVersion 1
                                         │
                                         ▼
                    Financial Intelligence Layer (M5)
                        ▲            ▲            ▲
                        │            │            │
        module-owned assumptions ────┘            │
        (Protection M5.9, Retirement M5.10)       │
        loaded by resolveAssumptions()            │
                                         ┌────────┴────────┐
                                         ▼                 ▼
                              /household dashboard    AI Family CFO
                                  (M5.6)              (M5.7, allow-list)
```

**Three corrections to the naive diagram:**

1. **Planning does not sit *after* Intelligence — it feeds *into* it.** Protection and Retirement
   are **inputs** (`assumptions`), resolved by
   `household-intelligence.service.ts::resolveAssumptions()`. The linear
   `Intelligence → Planning` arrow is wrong.
2. **The Wealth Health Score is *inside* the Intelligence Layer**, not a stage after it. It is
   `computeFinancialHealthScore`, composed by `financialIntelligence.ts:314`. It is also **not**
   downstream of Protection or Retirement — see §7 Gap 2.
3. **What-if branches off the snapshot, not off Intelligence.**
   `household-simulation.service.ts` reads the snapshot directly and re-scores; it never consults
   the Intelligence Layer.

---

## 4. M3 Financial Intelligence

### 4.1 Financial Health Score (M3-1)

- **Code:** `packages/core/src/finance/financialHealth.ts`; API
  `household-health-score.service.ts`; persisted via `FinancialHealthScore`
  (`20260715052842`).
- **Input:** a `FinancialSnapshotPayload` + an optional model override.
- **Output:** `overall` (0-100), `band`, per-category scores with weights, `modelVersion`.
- **Model (`fhs-1.0.0`)** — verified at `financialHealth.ts:44-48`:

| Category | Weight |
|---|---|
| `net_worth` Net Worth & Solvency | 25 |
| `debt_burden` | 25 |
| `savings` | 20 |
| `liquidity` Emergency Liquidity | 20 |
| `diversification` | 10 |

**There is no protection category and no retirement category.** §7 Gap 2.

### 4.2 Explainable engine (M3-2)

- **Code:** `core/finance/financialHealthExplanation.ts`; API
  `household-health-explanation.service.ts`.
- **Output:** per-category narrative, confidence, and ranked `recommendations` — which the M5
  layer re-exposes as `opportunity.quickWins` / `longTerm` and `recommendedActions`.

### 4.3 What-if Simulation (M3-3)

- **Code:** `core/finance/financialSimulation.ts`; API `household-simulation.service.ts`.
- **Mechanism (ADR-013):** clone the immutable snapshot into a **transient virtual** payload, apply
  scenario transforms, re-run M3-1 + M3-2. **Persists nothing.**
- **Scenario vocabulary** (`SCENARIO_TYPE_PARAMS`, `financialSimulation.ts:274`): `repay_debt`,
  `increase_emergency_fund`, `buy_asset`, `sell_asset`, `reallocate`, `reduce_expenses`,
  `increase_savings`, `increase_sip`, `retirement_contribution`, `improve_insurance`.
- **Extension seam:** an optional `registry` option allows new scenario types without touching the
  engine.

### 4.4 Known limitations of M3

1. **Snapshot-shaped and single-period.** Every scenario is a one-month mutation re-scored. It
   **cannot project forward** — which is why M5.10's retirement what-if is a re-run of
   `computeRetirement` rather than a simulation-engine scenario.
2. **`retirement_contribution` and `improve_insurance` are misleading names.** The first moves
   money from expense to an asset class for one month; the second merely raises expense, with the
   comment "Insurance is not yet a scored category (fhs-1.0.0)". Neither touches the retirement or
   protection engines.
3. **The score model has never been versioned past `fhs-1.0.0`**, so any category change re-bands
   every stored score. This is the cost that keeps deferring §7 Gap 2.

**Consumers of M3:** M5 layer (composes it), M5.6 dashboard, M5.7 AI grounding, V1
`/insights`.

---

## 5. M5.8 / M5.9 / M5.10 as implemented

### 5.1 M5.8 — Family, Goals, Charts, Parity (PRs #64, #65)

**No migration** — `Goal` already carried `householdId`/`firmId`/`memberId` from M1b.

| Part | Delivered | Code |
|---|---|---|
| Family | Native `/household/family` writing `HouseholdMember` — the table the snapshot reads. V1's `Family.tsx` wrote `FamilyMember`, which **changed no figure anywhere** | `apps/web/src/app/household/family/page.tsx`, `household-members.service.ts` |
| Self-member delete guard | Rejects deleting a member with `userId` set — that row is the `hasOwnHousehold` routing signal; deleting it exiled a consumer to the Advisor Workspace | `household-members.service.ts` |
| Date of birth | V1's form captured none, so **retirement reported `available: false` for every consumer in the product** | asserted in `household-members.e2e-spec.ts` |
| Goals | Native `/household/goals`, stored against household **and** firm; advisor-authored goals refused (403) because `Goal.userId` is NOT NULL | `household-goals.service.ts` |
| Charts | Drawing extracted to `apps/web/src/components/charts/`; V1 keeps its own fetching **and** its "Capture snapshot" button | `AllocationDonutChart.tsx`, `NetWorthTrendChart.tsx` |
| Parity | `early-warning-parity.e2e-spec.ts` — V1 vs V2 signals | 5 tests |

### 5.2 M5.9 — Protection / Insurance Intelligence (PR #68, `94c9650`)

**The defect was not a missing form.** `HouseholdIntelligenceService.current()` had always accepted
an `assumptions` argument and **no caller ever passed it**.

- **Migration** `20260814152922`: three columns on `HouseholdMember` — `hasTermCover`,
  `hasHealthInsurance`, `termLifeCoverMinor` — **all nullable, no defaults, no backfill**.
- **Null semantics:** `null` = not asked; `false` = a fact the family gave us. A default of `false`
  would have recorded every unasked household as having stated it has none.
- **Aggregation** (`household-protection.service.ts::aggregate`): life cover **sums** across
  adults; health cover requires **every** member including dependants; a partly-answered household
  is **not assessed at all**.
- **The structural fix:** assumptions are resolved **inside** the service
  (`resolveAssumptions()`), not at call sites — so a future consumer cannot reintroduce the
  omission.
- **#67 hotfix** widened `EarlyWarningInput.hasTermCover` to `boolean | null`; on `null` the engine
  emits **no** insurance signal, keeping `redCount`/`overall` self-consistent.
- **Tests:** `household-protection.e2e-spec.ts` (10).

### 5.3 M5.10 — Retirement Planning (PR #70, merge `9311324`, impl `132c072`)

**Confirmed merged.** Merge commit **`9311324`**; the migration directory and the core extension
are present in `git ls-tree origin/main`.

| Element | Detail |
|---|---|
| **`RetirementPlan` table** | `20260814171645_add_retirement_plan`. One row per household (`householdId @unique`), `firmId` for scoping, 8 planning columns **all nullable, no defaults, no backfill**. **New table only — no existing table altered.** |
| **Calculation engine** | `packages/core/src/finance/retirement.ts` — `computeRetirement`, extended additively |
| **Assumptions** | `retirementAge`, `lifeExpectancy`, `desiredAnnualIncomeMinor`, `monthlyContributionMinor`, `currentCorpusMinor`, `inflationRatePct`, `preRetirementReturnPct`, `postRetirementReturnPct` |
| **Provenance** | `ResolvedField<T> = { value, source }` where source is `stated` \| `derived` \| `default` — returned to the client, so an assumption of ours never reads as a decision of theirs (`retirement-plan.service.ts`) |
| **Monthly contribution** | The **one field with no honest default**. `null` → the projection sub-section reports itself unavailable. A stated `0` is a real **At Risk** finding |
| **Projected corpus** | `projectedCorpusFromCurrent + projectedCorpusFromContributions`. The contribution term is new in M5.10 — before it, "am I on track" could not be answered |
| **Shortfall / surplus** | `surplusOrShortfall`, **signed** (not floored). Status via `retirementStatus()`: surplus ≥ 0 → `on_track`; shortfall ≤ 10% of required → `watch`; else `at_risk`. A relative `1e-7` tolerance stops sub-rupee rounding reporting "watch" to a family who saved exactly the recommended SIP |
| **What-if** | `projectRetirementScenarios` — a `map` over `computeRetirement`, **not** a second engine. Types: `retire_earlier`, `retire_later`, `increase_contribution`, `increase_corpus`, `change_income_target`. Return/inflation scenarios deliberately excluded |
| **API routes** | `GET /households/:id/retirement`, `PUT` (upsert), `POST /households/:id/retirement/what-if`. All `HouseholdScopeGuard`; writes require household membership as self (403 otherwise) |
| **UI** | `apps/web/src/app/household/retirement/page.tsx` — where I am → where I want to go → what I need → on track? → what to do → what if. **Zero arithmetic in React** |
| **AI integration** | `retirement` added to the `GroundedAnalysis` allow-list (`household-ai.service.ts:20`) — the coach can answer "can I afford to retire at 60?" from the platform's own projection, and never recomputes it |
| **Corpus source** | Snapshot investable assets **excluding `real_estate`**, supplied through the pre-existing `currentCorpusMinor` override — so no figure moves for a household without a plan |
| **Tests** | `retirement.test.ts` (17 core), `household-retirement.e2e-spec.ts` (12), 1 smoke journey, 1 dark-mode surface |
| **Deployment** | `railway.json` `startCommand` chains `prisma migrate deploy && node main.js`, so the migration applies automatically on deploy. **Production application not independently verified by this audit** — see §13 |

**Known limitations of M5.10**

1. **One plan per household, one subject.** The oldest non-dependant. A couple with a 10-year age
   gap gets one retirement date. Accepted decision 3; named in the UI.
2. **Retirement does not affect the Wealth Health Score.** Accepted decision 2. §7 Gap 2.
3. **Assumptions are not versioned per snapshot.** Intelligence for a *historic* snapshot composes
   with *today's* plan. Same accepted trade as Protection.
4. **Corpus is `assetAllocation` minus real estate, not accounts typed `retirement`.** The truthful
   source is invisible because the frozen payload carries `assetClass` but **not** account `type`.
   Recorded as an open decision, requiring a snapshot contract change.
5. **No NPS/EPF/PPF integration, no tax-optimised withdrawal, no Monte Carlo.** Explicit non-goals.

---

## 6. Current product capability map

Judged on merged code, not roadmap position.

| Capability | V2 status | Module | Code location | Production ready? |
|---|---|---|---|---|
| **Family Balance Sheet** | Complete | M2-7 | `apps/web/src/app/app/households/[id]/balance-sheet/` | Yes — advisor surface only |
| **Net Worth** | Complete | M2-3 | `household-networth.service.ts`, `core/finance/networth.ts` | Yes |
| **Cashflow** | Complete | M2-4 | `household-cashflow.service.ts`, `core/finance/cashflow.ts` | Yes |
| **Budget** | Complete (API) | M2-4 | `household-budget.service.ts` | Yes — **no V2 consumer surface** |
| **Debt** | Complete | M2-5 | `household-debt.service.ts`, `core/finance/debt.ts` | Yes |
| **Financial Health Score** | Complete | M3-1/M3-2 | `core/finance/financialHealth.ts` | Yes — but blind to protection & retirement |
| **Protection / Insurance** | Complete | M5.9 | `household-protection.service.ts`, `/household/protection` | Yes — verified in production |
| **Retirement Planning** | Complete | M5.10 | `retirement-plan.service.ts`, `household-retirement.service.ts`, `/household/retirement` | **Yes — verified in production 2026-08-17** (§13); one open question: whether any household has yet saved a plan |
| **Goals** | Complete | M5.8 + **M5.11** | `household-goals.service.ts`, `/household/goals` | Yes — CRUD, and since M5.11 a goal behind schedule raises a risk signal (Gap 1 closed). Still outside the score |
| **Asset Allocation** | Complete (read-only) | M5 | `core/finance/assetAllocation.ts`; dashboard panel + donut | Yes — analysis only, no rebalancing |
| **Risk Intelligence** | Complete (early warning) | M5 / M3 | `core/scoring/earlyWarning.ts` → `intelligence.risk` | Yes — all 6 signals now fire for a V2 household; `goal_slippage` was supplied from M5.11 (before it, the signal was emitted but permanently green, telling families with goals to *"add goals"*) |
| **What-if Simulation** | Complete | M3-3 | `core/finance/financialSimulation.ts`, `household-simulation.service.ts` | Yes — **advisor surface only**, no V2 consumer page |
| **AI Family CFO** | Complete | M5.7 + M5.10 | `household-ai.service.ts`, `/household/coach` | Yes — coach gated on the `ai_recommendations` entitlement |
| **Estate & Legacy** | **NOT BUILT** | — | none | No |
| **Tax Planning** | **NOT BUILT** (helper only) | — | `core/finance/tax.ts` — `netOfTaxReturnPct` only | No |
| **Document Vault** | **NOT BUILT** | — | none | No |
| **Advisor Workspace** | Complete | M1-7 / M4 | `apps/web/src/app/app/*`, `components/dashboard/` | Yes |
| **Family Dashboard** | Complete | M5.6 | `apps/web/src/app/household/page.tsx` | Yes |

**Also present but not on the requested list:** Wealth DNA (`core/assessment/wealthDna.ts`, V1-era),
Account Aggregator stub (`apps/api/src/aa/` — returns "not enabled"), Billing/Razorpay sandbox,
Admin console, Onboarding, Wealth Health Check.

---

## 7. The three gaps — verified, and one corrected

### Gap 1 — Goals move no figure · **CLOSED in M5.11**

- **Verified:** `grep -c "goals" packages/core/src/finance/financialSnapshot.ts` → **0**. The
  payload has no goals section.
- **Why it matters:** a family can enter goals and **nothing changes** — not the score, not the
  risk signals, not the AI's advice. It is the same class of defect as V1's Family (M5.8 PR 1) and
  V1's Protection (M5.9): a surface that writes a store nothing reads.
- **The asymmetry is sharper than it looks:** the **V1** path *does* feed goal slippage into early
  warning — `apps/api/src/common/financial-snapshot.service.ts:122` computes a `goalSlippage` array
  and passes it at `:168`. So a V1 user at `/dashboard` can receive a goal signal that a V2
  household at `/household/goals` cannot. This is the same V1-ahead-of-V2 shape as M5.8 Family and
  M5.9 Protection.
- **Owner:** the kernel (M2-6) would have to carry goals, **or** goals become a module-owned
  assumption like Protection and Retirement. **The second is now the established pattern and needs
  no contract change.**
- **Tests exposing it:** `household-goals.e2e-spec.ts:192` asserts
  `snap.body.payload.goals` is `undefined`; `early-warning-parity.e2e-spec.ts:314` documents that
  V2 carries no goal-derived signal. Both **fail** the day it closes — deliberate tripwires.
- **Sharper still, on re-reading the engine:** the Goal Progress signal was emitted for V2
  households all along — permanently green, with the detail *"Add goals to track progress."* A
  family who had added goals and was badly behind on them was being told to add goals.
- **Fixed (M5.11):** `HouseholdGoalsService.assumptionsFor()` feeds slippage through
  `resolveAssumptions()` into `EarlyWarningInput`. No migration, no kernel change, no score change.
  The definition of slippage moved into `@lcos/core` (`planGoalAsOf`) and both V1 call sites were
  refactored onto it, so the two generations cannot drift. See
  `docs/M5_11_GOALS_SIGNAL_ARCHITECTURE.md`.
- **Both tripwires fired and were rewritten deliberately**, not deleted: the goals e2e now asserts
  a goal *does* move a figure while the snapshot and score stay untouched, and the parity spec
  asserts both paths raise the same goal signal. Nothing is excluded from parity any more.

### Gap 2 — The score ignores Protection and Retirement · **REAL, CONFIRMED**

- **Verified:** `financialHealth.ts:44-48` — five categories, no protection, no retirement.
  V1's separate engine (`core/scoring/scores.ts:60`) **does** weight protection at 20%, so the two
  generations disagree about what "health" means.
- **Why it matters:** a family can be entirely uninsured and badly behind on retirement and still
  score well. It is the largest remaining honesty gap in the product's headline number.
- **Owner:** M3-1 (`financialHealth.ts`) — a scoring-model change, not a planning change.
- **Cost:** adding a category re-weights the model, requiring a `FINANCIAL_HEALTH_MODEL_VERSION`
  bump (currently `fhs-1.0.0`) which **re-bands every stored score**.
- **Tests exposing it:** none directly, until M5.11. Both M5.9 and M5.10 measured it (protection:
  score unchanged 90→90) but no test pinned the category list — Gap 4. `finance.test.ts` now pins
  the five categories, their weights, the version, and the *absence* of protection and retirement,
  so M5.12 must change them on purpose.
- **Before the next milestone?** It deserves to be **its own milestone**, not a side effect.

### Gap 3 — `usingDefaultAssumptions` · **REAL, BUT NOT AS DESCRIBED**

The reported gap was *"assumptions are wired while `usingDefaultAssumptions` still flags families
who haven't planned."* **That behaviour is correct**, not a gap:
`financialIntelligence.ts:469` reads `usingDefaults = !input.assumptions?.retirement`, and
`assumptionsFor()` returns `undefined` when no plan row exists. A family who has not planned **is**
on defaults, so flagging them is accurate.

**The actual gap is narrower.** The flag is **all-or-nothing on the presence of the assumptions
object, not per field.** A household that states only a retirement age gets a full assumptions
object — with inflation, returns and life expectancy still ours — and therefore
`usingDefaultAssumptions: false`. The dashboard then shows no "standard assumptions" caveat even
though most of the projection rests on them.

- **Located:** `financialIntelligence.ts:469` and `:505`.
- **Why it matters:** the dashboard tells a partly-planned family their projection is entirely
  theirs. M5.10 **already solved this properly** with per-field provenance — but only on the
  planning surface; the flag the dashboard reads is still binary.
- **Owner:** M5 layer, surfacing per-field provenance in the `retirement` section.
- **Tests exposing it:** none. `household-retirement.e2e-spec.ts` asserts
  `usingDefaultAssumptions` `true` with no plan and `false` with a **full** plan; the partial case
  is untested.
- **Recommended fix:** carry the per-field sources into the section, keeping the boolean for
  backward compatibility. Small, and no migration.
- **Before the next milestone?** Low urgency; fold into the Goals work.

### Gap 4 — *newly identified* — Nothing pins the score model's category list

Gaps 1 and 3 have tripwire tests. **Gap 2 does not.** A future contributor could add or remove a
health category with nothing failing, silently re-banding every family's score. **Recommendation:**
a test pinning `DEFAULT_FINANCIAL_HEALTH_MODEL.categories` and `FINANCIAL_HEALTH_MODEL_VERSION`
together, so a model change must be deliberate.

### Gap 5 — *newly identified* — Budget and What-if have no V2 consumer surface

`household-budget.service.ts` and `household-simulation.service.ts` are complete and tested, but
reachable **only** from `/app/households/[id]/*` (advisor) — there is no `/household/*` page for
either. For a consumer-primary product these are shipped capabilities nobody can reach. Milder
than the M5.8/M5.9 pattern (nothing is silently wrong), but the same shape: **capability without a
consumer path.**

### Gap 6 — *newly identified* — The snapshot cannot see account `type`

`AccountType.retirement` exists and household accounts accept it, but the frozen payload's
`assets[]` carries `assetClass` only. So "money earmarked for retirement" is **invisible to the
Intelligence Layer**, which is why M5.10's corpus is a class-based approximation. Closing it means
a `schemaVersion` change — the first real pressure on the frozen contract, and it will recur for
Tax and Estate.

### Gap 7 — *newly identified* — `/onboarding/status` is a systemic rate-limit pressure point

Twice now (M5.8 PR 2, M5.10) a new surface has pushed this route past `120/60s` per route per IP,
and the failure mode is severe: `hasOwnHousehold` reads false and a consumer lands in the **Advisor
Workspace**. Mitigated in M5.10 by caching the household id per session and seeding it at sign-in.
**It is mitigation, not a structural fix** — the route remains the single dependency every V2
surface hits first.

---

## 8. Real dependency graph

Derived from imports and constructor injection, not from documentation.

```
╔═ FOUNDATION ════════════════════════════════════════════════════════════╗
║  Auth / Tenancy (M1)        Firms · Households · Members · Entities      ║
║        │                    HouseholdScopeGuard (ADR-002)                ║
║        ▼                                                                ║
║  FINANCIAL KERNEL (M2)  — FROZEN                                        ║
║    M2-1 FX ── M2-2 Accounts ── M2-4 Cashflow/Budget ── M2-5 Debt         ║
║                          └──► M2-3 Net Worth ──┐                        ║
║                                                ▼                        ║
║                        M2-6 FinancialSnapshot (immutable, schemaVersion 1)║
╚═════════════════════════════════════════════│═══════════════════════════╝
                                              │
╔═ PLANNING (module-owned inputs) ═══════╗    │
║  RetirementPlanService (M5.10)         ║    │
║  HouseholdProtectionService (M5.9)     ║    │
╚════════════════│═══════════════════════╝    │
                 │  assumptionsFor()          │  payload
                 └────────────┬───────────────┘
                              ▼
╔═ INTELLIGENCE ══════════════════════════════════════════════════════════╗
║  HouseholdIntelligenceService — resolveAssumptions() + core composer     ║
║     composes: M3-1 health · M3-2 explanation · emergency fund ·          ║
║               insurance gap · retirement · asset allocation ·            ║
║               early warning (M3/M5)                                      ║
╚═════════════════════════════════════════════════════════════════════════╝
        │                        │                        │
        ▼                        ▼                        ▼
╔═ EXPERIENCE ════════╗  ╔═ ADVISORY ═════════╗  ╔═ AI ══════════════════╗
║ /household (M5.6)   ║  ║ /app (M1-7, M4)    ║  ║ AI Family CFO (M5.7)  ║
║ /household/goals    ║  ║ advisor households ║  ║ allow-listed sections ║
║ /household/family   ║  ║ balance sheet      ║  ║ + retirement (M5.10)  ║
║ /household/protection║ ║ simulation (M3-3)  ║  ╚═══════════════════════╝
║ /household/retirement║ ╚════════════════════╝
║ /household/coach    ║
║ /wealth-health      ║       ╔═ V1 SAFETY NET ═══════════════════════════╗
╚═════════════════════╝       ║ /dashboard — retail, userId-keyed          ║
                              ║ Goals · Family · Protection · Coach ·     ║
╔═ SIDE BRANCH ═══════════╗   ║ Second Opinion · RetirementCalculator     ║
║ What-if (M3-3) reads    ║   ║ /insights early warning                   ║
║ the SNAPSHOT directly,  ║   ║ Retirement decision: Module 10            ║
║ not Intelligence        ║   ╚═══════════════════════════════════════════╝
╚═════════════════════════╝
```

**Two counter-intuitive edges, both confirmed in code:**

1. **Planning → Intelligence, not the reverse.** `HouseholdRetirementService` depends on *both*
   `RetirementPlanService` and `HouseholdIntelligenceService`; the plan service is deliberately
   thin so this is not a cycle.
2. **What-if is a side branch**, reading the snapshot directly and re-scoring — it never consults
   the Intelligence Layer.

---

## 9. What must not be built again

Duplication actually found in the tree, and the rules that follow from it.

### 9.1 Duplication that exists and is intentional (V1/V2 coexistence)

| Duplicate | V1 | V2 | Rule |
|---|---|---|---|
| **Health score engines** | `core/scoring/scores.ts` (`computeWealthHealth`, protection 20%) | `core/finance/financialHealth.ts` (`fhs-1.0.0`, no protection) | **Two engines that disagree.** Do not add a third. V1's dies with Module 10 |
| **Snapshot builders** | `apps/api/src/common/financial-snapshot.service.ts` (retail, reads `Profile`) | `household-financial-snapshot.service.ts` (immutable, household) | Never add a third; never make V2 read `Profile` |
| **Member stores** | `FamilyMember` | `HouseholdMember` | Unmigrated by design. **Only `HouseholdMember` reaches the snapshot** |
| **Goal stores** | retail `Goal` (`userId`) | household `Goal` (`householdId`) | Same row, different scoping. Unmigrated by design |
| **Protection stores** | `Profile.hasTermCover` etc. | `HouseholdMember.hasTermCover` etc. | Same |
| **Retirement calculators** | `components/RetirementCalculator.tsx` — **computes in React** | `core/finance/retirement.ts` via the planning service | V1's is the anti-pattern; never copy it |

### 9.2 Duplication that does **not** exist — and must not start

- **One what-if engine per shape.** `simulateFinancialWhatIf` for position-shaped scenarios;
  `projectRetirementScenarios` (a `map` over `computeRetirement`) for assumption-shaped ones. There
  is **no** third engine. Re-invoking a pure function with different arguments is not an engine.
- **One assumption resolution point.** `resolveAssumptions()` in
  `household-intelligence.service.ts`. Adding a module-owned input is one more entry there — never
  a new argument at a call site. **This is the fix that closed M5.9's root cause.**
- **No financial arithmetic in React.** Only `RetirementCalculator.tsx` (V1) violates it.

### 9.3 Rules for future development

1. **The kernel is frozen.** Never redesign, replace or bypass M2. Read the snapshot, never raw
   tables.
2. **`schemaVersion 1` is additive-only.** A new payload key needs a version decision and updates
   to `kernelContract.test.ts`.
3. **Module-owned inputs go in the module's own table** and reach the layer through
   `assumptions` — the pattern Protection and Retirement both follow.
4. **All arithmetic in `@lcos/core`.** Services select and aggregate; controllers carry no logic;
   React formats only.
5. **Unknown is never zero or false.** Use `Section<T>` unavailability, or a nullable column whose
   `null` means "not asked". A stated zero is a finding.
6. **Every important figure carries its provenance.** `stated` / `derived` / `default`.
7. **Household-scope every route** with `HouseholdScopeGuard` (404-not-403); writes of stated
   intent additionally require household membership as self.
8. **No new consumer surface without a V2 path.** Gap 5 is what happens otherwise.
9. **Every deliberate gap gets a tripwire test** that fails when it closes. Gap 2 lacks one.
10. **Verify every regression test bites** before trusting it — rebuild `dist` first, count calls
    rather than catching throws, and order absence assertions behind a positive signal.

---

## 10. Next-sequence evaluation

| Option | Why now | Depends on | Business value | Technical risk | Migration? | Kernel? | Score? | AI? |
|---|---|---|---|---|---|---|---|---|
| **A. Fix gaps 3, 4, 7** | Cheap; gap 4 protects the score | none | Low direct | **Low** | No | No | No | No |
| **B. Complete Goals** | Seam exists (`goalSlippage` already in `EarlyWarningInput`); `planGoal` already computes gaps | M5 assumptions | **High** — goals are a headline feature that currently does nothing | Low-Medium | No | No | No | Yes (a signal appears) |
| **C. Protection + Retirement into the score** | Both now have real data; the score is the headline number | M5.9, M5.10 | **Very high** — honesty of the main figure | **High** — `fhs-1.0.0` bump re-bands every stored score | No | No | **Yes, breaking** | Yes |
| **D. Asset Allocation** | Already read-only complete | M5 | Low-Medium — rebalancing is advice, not analysis | Medium | Likely (target allocations) | No | Maybe | Yes |
| **E. Risk Intelligence** | Early warning already ships 5 live signals (6 keys) | M3/M5 | Medium | Low | No | No | No | Yes |
| **F. AI Family CFO** | Already native and grounded | M5.7 | Medium — depth, not capability | Medium (cost, prompt drift) | No | No | No | Yes |
| **G. What-if expansion** | Engine exists; **no consumer surface** (Gap 5) | M3-3 | Medium-High | Low | No | No | No | No |
| **H. Foundational: account `type` in the snapshot** | Gap 6; blocks truthful corpus, and will recur for Tax/Estate | M2-6 | Medium now, **high later** | **High** — first change to a frozen contract | No (payload only) | **Yes** | No | Yes |

### RECOMMENDED NEXT 3 MILESTONES

**M5.11 — Goals become a signal** *(option B, with A folded in)*

The cheapest high-value work left, and the last of the three "surface writes a store nothing
reads" defects. Every seam already exists: `EarlyWarningInput.goalSlippage` is accepted and
ignored, `core/finance/goals.ts::planGoal` computes the gap, and `resolveAssumptions()` is the
established insertion point. **No migration. No kernel change. No score change.** Fold in gap 3
(per-field provenance) and gap 4 (pin the score model) as low-cost riders — gap 4 in particular
must land *before* M5.12 touches the model. Two tripwire tests will fail by design and must be
rewritten deliberately.

**M5.12 — Wealth Health Score v2: protection and retirement count** *(option C)*

Do this second, not first, because it is the only item that **breaks a shipped number**. Adding
categories bumps `FINANCIAL_HEALTH_MODEL_VERSION` and re-bands every stored score — a product
decision about what "health" means, needing a communication plan, not just code. It should follow
M5.11 so that goals, protection and retirement all feed the score in one deliberate re-scoring
rather than three. It also closes the V1/V2 disagreement, where V1 weights protection at 20% and
V2 at zero.

**M5.13 — What-if and Budget reach the consumer** *(option G + gap 5)*

Two complete, tested engines that no consumer can reach. Purely additive: no migration, no kernel
change, no score change, and it turns "increase my savings" from advice into something a family can
try. Low risk, and it makes the planning experiences feel like a system rather than separate pages.

**Deliberately not next:** option H (account `type` in the snapshot) is the first real pressure on
the frozen contract and deserves its own decision once Tax or Estate makes the need concrete —
solving it for retirement alone would set a precedent on thin evidence.

---

## 11. Final V2 master map

```
M1     Tenancy & Advisory Scoping        Firm → Household → Member; scope guard      COMPLETE
M2     The Financial Kernel              FX · Accounts · Net Worth · Cashflow ·      COMPLETE, FROZEN
                                         Debt · immutable Snapshot (schemaVersion 1)
M3     Financial Intelligence            Health Score · Explanation · What-if        COMPLETE
M4     Dashboard Foundation              /app cards + selector + ScoreCard seam      COMPLETE (as built);
                                         ⚠ blueprint calls M4 "AI agent fleet" —     superseded as the
                                         never built under that number (§2)          consumer home
M5     Financial Intelligence Layer      one composed read-model over the kernel     COMPLETE
M5.5   Consumer activation               provisioning · onboarding · Wealth Check    COMPLETE
M5.6   Household Dashboard               /household — the V2 consumer home           COMPLETE
M5.x   V2 primary                        consumers → /household; V1 preserved        COMPLETE
M5.7   AI Family CFO                     native coach, allow-listed grounding        COMPLETE
M5.8   Family · Goals · Charts · Parity   native surfaces; DOB unlocks retirement     COMPLETE
M5.9   Protection / Insurance             per-member cover → assumptions.insurance    COMPLETE
M5.10  Retirement Planning                RetirementPlan → assumptions.retirement     COMPLETE (9311324, live)
```

### CURRENT STATE — production-ready today

Tenancy and scoping · the whole Financial Kernel · Health Score with explanation · What-if (advisor
only) · the Financial Intelligence Layer · consumer onboarding and the Wealth Health Check · the
V2 household dashboard with charts · native Family, Goals CRUD, Protection and Retirement · the
AI Family CFO · the Advisor Workspace · Admin · V1 intact as the rollback path.

### OPEN

The score ignores goals, protection and retirement (Gap 2) ·
`usingDefaultAssumptions` is binary, not per-field (Gap 3) · nothing pins the score model (Gap 4) ·
Budget and What-if have no consumer surface (Gap 5) · the snapshot cannot see account `type`
(Gap 6) · `/onboarding/status` remains a rate-limit pressure point (Gap 7) ·
`FIELD_ENCRYPTION_KEY` rotation deferred (#63) · self-member naming shows the household name ·
retail↔household double entry at onboarding · Estate, Tax and Document Vault do not exist ·
Module 10 V1 retirement decision.

### NEXT

**M5.11** Goals become a signal (+ gaps 3 and 4) → **M5.12** Wealth Health Score v2 →
**M5.13** What-if and Budget reach the consumer.

---

## 12. Evidence index for key claims

| Claim | Evidence |
|---|---|
| M5.10 merged | merge commit `9311324`, impl `132c072`, PR #70 |
| M5.10 migration exists in main | `git ls-tree origin/main apps/api/prisma/migrations/` → `20260814171645_add_retirement_plan` |
| M4 = Dashboard Foundation | `docs/architecture/M4_DASHBOARD_FOUNDATION.md:1`; impl `af5d34a`, `e7fad41`; 7 components present |
| M4 conflict | `docs/blueprint/09_ROADMAP.md:67` vs the above |
| Score has 5 categories | `packages/core/src/finance/financialHealth.ts:44-48` |
| V1 score weights protection 20% | `packages/core/src/scoring/scores.ts:60`, `:88` |
| Snapshot has no goals | `grep -c goals packages/core/src/finance/financialSnapshot.ts` → 0 |
| Goals tripwire | `apps/api/test/household-goals.e2e-spec.ts:192` |
| Parity tripwire | `apps/api/test/early-warning-parity.e2e-spec.ts:314` |
| `usingDefaults` is binary | `packages/core/src/finance/financialIntelligence.ts:469` |
| Assumptions resolved centrally | `apps/api/src/households/household-intelligence.service.ts::resolveAssumptions` |
| `goalSlippage` already accepted | `packages/core/src/scoring/earlyWarning.ts:22` |
| Snapshot lacks account `type` | `packages/core/src/finance/financialSnapshot.ts:24-32` |
| Contract frozen | `packages/core/src/finance/kernelContract.test.ts` |
| ADRs 001-013 | `docs/architecture/M2_HOUSEHOLD_WEALTH_ARCHITECTURE.md:469-659` |
| No feature migration M5.5→M5.8 | `ls apps/api/prisma/migrations` — between `20260715120000` and `20260814152922` only `20260806153040_add_login_attempt_lockout` (auth kernel) |
| Migrations run on deploy | `railway.json` `deploy.startCommand` |
| Test counts | 32 API e2e specs · 11 core test files · 8 API unit specs · 35 web smoke cases in 12 groups (`apps/web/e2e/smoke.spec.ts`) — counted, not estimated |

---

## 13. Evidence & Confidence

### CONFIRMED FROM MERGED CODE

Kernel sub-modules and their files · the 5-category score model · absence of goals in the payload ·
`usingDefaults` semantics · `resolveAssumptions` as the single insertion point · Protection
aggregation rules · M5.10 tables, routes, provenance and status thresholds · the AI allow-list
including `retirement` · absence of Estate/Tax/Document Vault · the dependency graph · all seven
M4 components and their single importer · V1/V2 duplicate engines and stores · `goalSlippage`
accepted and unused · the snapshot's lack of account `type`.

### CONFIRMED FROM GIT HISTORY

The two PR series and the V1→V2 boundary at 2026-07-13 · milestone commit anchors in §1 · M4's
design-then-implementation sequence (`573d58b` → `af5d34a`/`e7fad41`) · the migration timeline and
the 30-day schema-free span · 221 commits · merge commit `9311324` for M5.10.

### CONFIRMED FROM TESTS

Kernel contract freeze (`kernelContract.test.ts`) · the goals and parity tripwires · M5.10
behaviour (12 e2e + 17 core) · Protection behaviour (10 e2e) · V1 regression pins in
`retirement.test.ts` and `earlyWarning.test.ts` · the score model's five categories, weights,
version and the absence of protection/retirement (`finance.test.ts`, added M5.11).

**Full validation run, 2026-08-24, at `8de6932`:**

| Suite | Result |
|---|---|
| Repo typecheck (`pnpm lint` — `tsc --noEmit` × 4 packages) | 4/4 pass |
| `@lcos/core` (vitest) | **166/166** pass, 12 files |
| API unit (jest) | **72/72** pass, 8 suites |
| API e2e (jest, `--runInBand`) | **239/239** pass, 33 suites |

Two suites (`password-reset`, `auth-flows`) fail in a sandbox without
`SANDBOX_RETURN_SECRETS=true`, which CI sets (`ci.yml:32`); with it they pass. That is an
environment prerequisite, not a product failure, and was diagnosed separately before being
dismissed.

**Deployment-verification false-positive tests (not part of CI, run by hand at `f001925`):** an
unreachable API produces `WARN … did not answer` and a non-zero exit rather than a pass; a stub
that answers 401 on every path is rejected with *"the route probe is not a valid check"* and no
milestone conclusion is drawn.

### INFERRED

- **M1-1…M1-4 sub-milestone labels.** Not in commit subjects; M1's scope is inferred from the
  tenancy migrations and module layout. M1-5, M1-6, M1-7 **are** explicitly labelled.
- **That definition B of M4 was superseded rather than abandoned.** The AI work shipped as M5.7;
  no commit or ADR states the renumbering.
- **Gap 5's severity.** Budget and What-if have no `/household/*` route (confirmed), but whether
  that is a product decision or an oversight is not recorded anywhere.
- **Business-value ratings in §10.** Engineering judgement, not measured.

### CONFIRMED FROM PRODUCTION — 2026-08-17

Added after the audit. This resolves what was UNKNOWN item 1 (**the migration has applied**) and
narrows item 2, which survives below as the only open production question. Both checks were
read-only; no production data was created, modified, or read beyond HTTP status codes.

1. **The production API is live on the merged M5.10 build.** An unauthenticated
   `GET /api/households/:id/retirement` against the production host returned
   `{"message":"Unauthorized","statusCode":401}`. 401 — rather than 404 — means the route is
   *mapped in the running process*, because an unmatched path is rejected by Nest's router before
   any guard runs. `JwtAuthGuard` is the first global guard (`apps/api/src/app.module.ts:56`) and
   `household-retirement.controller.ts` carries no `@Public()`. The discriminator was validated
   against this build before being relied on: the built `apps/api/dist/main.js` answers **401** on
   `/api/households/probe/retirement` and **404** on `/api/households/probe/retirement-does-not-exist`.
   It is also test-pinned at `apps/api/test/household-retirement.e2e-spec.ts:299`.
2. **Therefore the `RetirementPlan` migration has applied in production.** `railway.json` runs
   `prisma migrate deploy && node apps/api/dist/main.js`. The `&&` is load-bearing: the process
   cannot be serving unless `migrate deploy` exited 0 for the migration set of the build that is
   serving — which includes `20260814171645_add_retirement_plan`. Corroborated by
   `verify-production.yml` [run 32033832053](https://github.com/dipankarnath2458/LifeCapitalOS/actions/runs/32033832053)
   the same day: `GET /api/health — status=ok` **and** `database reachable from the API`, so this is
   a live database rather than a booted app with a dead one.

**Method note, and what was done about it.** Neither fact was directly observable at the time:
`/api/health` returned no build identity (`{status, db, timestamp}` — and it answers `200` even
with the database unreachable), and Swagger is disabled in production, so route introspection is
closed. Build identity had to be *inferred* from an auth-status discriminator.

**Remediated in `f001925`.** `/api/health` now reports `commit` — the short SHA from
`RAILWAY_GIT_COMMIT_SHA` (Railway injects it; no platform variable was changed) with a
`GIT_COMMIT_SHA` fallback, and `null` when neither is present, so an unidentifiable build cannot
pass for a stale one. `scripts/verify-deployment.mjs` gained a **Build identity** section that
reads that field, optionally asserts it against `--expect-commit`, and probes the M5.8/M5.9/M5.10
routes — **with the control path probed first**, so that a deployment which authenticated every
path (making a missing route indistinguishable from an unauthorised one) fails the section instead
of producing three meaningless passes. Verified locally against all four branches, plus two
false-positive cases: an unreachable API warns and exits non-zero rather than passing, and a
catch-all stub that answers 401 everywhere is rejected outright. The next production run of
`verify-production.yml` answers "is the merged build live?" directly rather than by inference.

### BLOCKED — pending user verification

1. **Whether any real household has a `RetirementPlan` row.** *Attempted 2026-08-24 and could not
   be performed from this session*: the assistant holds no authenticated production session, and
   the organisation's egress policy rejects both production hosts outright
   (`connect_rejected … lifecapitalos-api-production.up.railway.app:443` and
   `www.lifecapitalos.com:443`). Obtaining access was explicitly out of bounds — no seeding, no
   role change, no guessed account, no privilege escalation — so the item stands as **pending user
   verification** rather than unknown for want of investigation. Two read-only routes to the
   answer exist and neither needs database access, and both require a session the user already
   has:
   `GET /api/admin/audit?action=household.retirement.upsert` (every plan write logs that action —
   `household-retirement.service.ts:147-156`, field names only, no values), whose rows carry
   `actorId` so a founder test can be told apart from a real family; or
   `SELECT count(*), min("createdAt") FROM "RetirementPlan";`. `prisma/seed.ts` never creates a
   plan and there is no audit pruning, so an empty audit result implies no rows.

### UNKNOWN — requires further investigation

1. **What M4 definition B ("AI agent fleet & orchestration") was meant to contain.**
   `docs/blueprint/09_ROADMAP.md:67` names it; no design document was ever written. Whether M5.7
   satisfies its intent is **UNKNOWN**.
2. **Why `docs/blueprint/05_DATA_MODEL.md:413` assigns notifications and email to M4.** A third
   conflicting definition with no corresponding models or code. **UNKNOWN — requires further
   investigation.**
3. **Whether PRs #4, #5, #8 (second series) and #1–#5, #24+ (first series) exist.** The merge log
   skips them; whether they were closed unmerged or never opened is not determinable from the local
   clone.
4. **The intended owner of the V1 retirement decision at Module 10.** `V1_RETIREMENT_PLAN.md`
   describes the mechanics; no document states the acceptance criteria for retiring V1.
5. **Whether the M4 `ScoreCard` seam should be revived or deleted.** It is unused for consumers but
   still live in the advisor dashboard. Its fate is tied to the Module 10 decision and is not
   recorded.
