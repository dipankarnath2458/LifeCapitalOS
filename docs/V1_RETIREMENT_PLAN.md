# V1 → V2 Migration & Coexistence Plan

> **Status:** Revised plan, report only. **No code has been deleted, moved, or modified.**
> **Supersedes** the earlier deletion-first revision of this document (kept in git history).
>
> **Governing rule (founder decision):** V2 becomes the **primary development architecture**, but
> **V1 remains operational and intact as a safety net until Module 10 is complete.** No V1 capability
> is removed merely because it lacks a V2 equivalent. **No destructive deletion before Module 10.**
>
> **Method:** every claim is derived from a per-module import graph over `apps/web/src` and
> `apps/web/e2e` matching `@/`, `./` and `../` forms, plus data-path tracing through the API and
> `@lcos/core` — not from file naming or inspection by eye.
> Companion: [`M5_6_HOUSEHOLD_DASHBOARD_ARCHITECTURE`](./M5_6_HOUSEHOLD_DASHBOARD_ARCHITECTURE.md),
> [`M5_5_WEALTH_HEALTH_CHECK_ARCHITECTURE`](./M5_5_WEALTH_HEALTH_CHECK_ARCHITECTURE.md).

---

## 0. Two findings that validate keeping V1

**Finding 1 — V2's insurance panel has no data path at all.** Not merely "no capture UI". The core
computes `coverTracked` from `input.assumptions?.insurance`, and
`HouseholdIntelligenceController` never passes `assumptions` — it calls
`intelligence.current(household, q.snapshotId)`. So **`coverTracked` is `false` for every consumer,
always**, and `existingCoverMinor` is always `0`. The V2 protection section is structurally a
placeholder.

Meanwhile V1's `Protection.tsx` genuinely captures `hasTermCover`, `hasHealthInsurance` and
`termLifeCoverMinor` into the retail `Profile`, which feeds the V1 retail snapshot and the AI coach's
grounding. **Retiring it would delete the only working protection capture in the product** and
replace it with a panel that cannot ever display real data.

**Finding 2 — the earlier "orphans" were not orphans.** An earlier revision listed `Modal.tsx`,
`NumberField.tsx` and `Status.tsx` as unused and safe to delete. That analysis matched only
`@/`-style imports and missed relative ones. All three have live importers, and two are load-bearing
for the **public marketing site**. Corrected below and everywhere in this document.

Both findings point the same way: **deletion was the wrong first move.**

---

## A. V1 surfaces that CAN safely migrate to V2 now

"Verified V2 equivalent" means the V2 surface reads real data through a live path, proven by a test —
not that a section exists in the contract.

| V1 surface | V2 equivalent | Verified how | Migrate now? |
| --- | --- | --- | --- |
| Consumer **home route** (`CONSUMER_HOME`) | `/household` | 18 smoke tests; 154 API e2e | ✅ Yes |
| **Net worth** figures (`NetWorthChart` data) | `intelligence.netWorth` | e2e asserts `assetsMinor` equals entered figures | ✅ Yes |
| **Allocation** data (`AllocationDonut` data) | `intelligence.assetAllocation` | e2e asserts section available with data | ✅ Yes |
| **Account capture** (`AddAccount`) | Wealth Health Check → household accounts | e2e asserts snapshot payload equals input | ✅ Yes |
| **Health score** | `intelligence.wealthHealth` | e2e asserts it equals the `health-score` endpoint for the same `snapshotId` | ✅ Yes |
| **Cashflow** | `intelligence.cashflow` | e2e asserts income/expense equal entered figures | ✅ Yes |
| **First-run onboarding nudge** | `/household` empty state | smoke test | ✅ Yes |
| **Plans / Admin navigation** | V2 header links | to be added | ✅ Yes |

> Note on charts: V2 shows net-worth and allocation **figures** but not V1's donut/timeline
> **visualisations**. The numbers migrate; the charts are a V2 build item (M5.8+), not a blocker —
> V1 keeps its charts in the meantime.

## B. V1 capabilities that MUST remain — V2 has no equivalent

| Capability | V1 implementation | V2 status | Why it must stay |
| --- | --- | --- | --- |
| **Goals** | `Goals.tsx` → `/goals` | **None.** No goals in the intelligence contract, the dashboard, or any V2 route | Only way a consumer sets or tracks a goal |
| **Family members** | `Family.tsx` → `/family` | **None.** `intelligence.household.memberCount` is read-only; no CRUD anywhere | Only way to record dependents — which feeds insurance need and scoring |
| **Protection / insurance capture** | `Protection.tsx` → `/profile` | **Placeholder only** — `coverTracked` always `false` (§0) | Only working protection capture in the product |
| **AI Wealth Coach** | `WealthCoach.tsx` → `/ai/coach` | **None.** PR-5 not started | Only conversational AI surface |
| **AI Second Opinion** | `SecondOpinion.tsx` → `/ai/second-opinion` | **None** | Only second-opinion surface |
| **Early warning** | `EarlyWarning.tsx` → `/insights/early-warning` | `intelligence.risk` — **overlapping, not verified equivalent** | Different model; no test proves parity. Treat as unmigrated |
| **Net-worth timeline chart** | `NetWorthChart.tsx` | Figures yes, chart no | Visualisation not yet rebuilt |
| **Allocation donut** | `AllocationDonut.tsx` | Figures yes, chart no | Visualisation not yet rebuilt |

**All nine remain live, reachable and untouched until Module 10.**

## C. Components preserved untouched (no change of any kind)

| Group | Files | Reason |
| --- | --- | --- |
| **Advisor Workspace** | all 7 of `components/dashboard/*` | Imported only by `app/app/page.tsx`. A separate product. The directory name is a trap |
| **Marketing site** | `ToolsSection`, `HealthCheck`, `RetirementCalculator`, `InsuranceGap`, `WealthDna` | Imported by the public landing page; `WealthDna` calls `/tools/wealth-dna` |
| **Shared UI** | `Toast` (9 importers incl. root layout), `Skeleton`, `Pager`, `Modal`, `NumberField`, `Status`, `AuthCard` | Shared across admin, marketing and auth — see Finding 2 |
| **Admin** | `AdminShell`, `FeatureOverrides`, `lib/admin.ts`, `lib/adminContext.tsx` | Platform administration |
| **V1 consumer (now: safety net)** | `dashboard/page.tsx` + the 9 capability components in §B | Preserved by the new rule, not by dependency |
| **Session / API** | `lib/session.ts`, `lib/api.ts` | Authentication kernel and API client |
| **Advisor context** | `lib/appContext.tsx`, `lib/useCurrentHousehold.ts` | Advisor Workspace |
| **Entire API** | every file under `apps/api/src` | No API change in any phase |
| **Kernel & schema** | Financial Kernel, Intelligence Layer, Snapshot Engine, Wealth Health / Explainable Score, Household aggregate, auth, authz, audit, multi-tenancy, `prisma/` | Frozen; no migration |
| **V1 retail scorer** | `computeWealthHealth`, `common/financial-snapshot.service.ts`, `ai.service.ts` | Preserved until the V2 replacement is fully verified |

## D. Eventually deletable — but ONLY after Module 10

Nothing here is scheduled. Each becomes a **candidate** only once its V2 replacement is
production-verified, and each requires a fresh dependency analysis at that time.

| Candidate | Unblocked by | Precondition for deletion |
| --- | --- | --- |
| `app/dashboard/page.tsx` | all rows below | Every capability below migrated and verified |
| `Goals.tsx` | M5.8+ V2 goals | V2 goals CRUD live and tested |
| `Family.tsx` | M5.8+ V2 household members | V2 member CRUD live and tested |
| `Protection.tsx` | V2 insurance **data path** + capture UI | `coverTracked` genuinely true for a real consumer |
| `WealthCoach.tsx`, `SecondOpinion.tsx` | PR-5 AI on the FIL | V2 AI surface live; V1 scorer retired only after parity is verified |
| `EarlyWarning.tsx` | V2 risk parity | A test proving `intelligence.risk` covers the same conditions |
| `NetWorthChart.tsx`, `AllocationDonut.tsx` | V2 charts | V2 visualisations shipped |
| `AddAccount.tsx` | already migrated | Retained while `/dashboard` lives, since the page imports it |

## E. Revised PR sequence

**PR A — Route migration + V1 coexistence (additive, reversible).** The only PR in this batch.

| # | Change | Files | Reversible |
| --- | --- | --- | --- |
| M1 | `CONSUMER_HOME: '/dashboard' → '/household'` | `lib/postLoginDestination.ts:21`, `.spec.ts` | one line |
| M2 | First-run nudge → `/onboarding` from `/household` | `app/household/page.tsx` | revert file |
| M3 | V2 header: Plans (`/billing`), Admin (`/admin`) | `app/household/page.tsx` | revert file |
| M4 | **"More tools" link → `/dashboard`** — keeps V1 reachable | `app/household/page.tsx` | revert file |
| M5 | Admin redirects `/dashboard` → `/household` | `lib/admin.ts:28`, `admin/layout.tsx:35`, `AdminShell.tsx:55,70` | revert 3 files |
| M6 | Smoke suite asserts V2 home **and V1 still reachable** | `e2e/smoke.spec.ts` | revert file |

**M4 is the change that makes this plan work.** Repointing the home route without it would leave
`/dashboard` alive but unreachable — technically "not deleted", functionally retired, and in breach
of rule 7. With M4, V1 becomes a **linked secondary surface** rather than the home.

> **Deliberately dropped from the earlier plan:** the migration that repointed onboarding's account
> step to the household path. It is a behaviour change, not a link change, and while V1 remains the
> home for Goals/Family/Protection, retail-keyed onboarding data is still *used*. Revisit when those
> capabilities migrate.

**PR B — DELETED FROM THE PLAN.** No deletion PR exists or is scheduled.

**Phases 3–4 — M5.8 → M10.** Each module that replaces a §B capability adds, to its own PR: the V2
implementation, a test proving parity with V1, and a line in §D marking the V1 component a candidate.

**Phase 5 — after M10.** A fresh retirement analysis, from a re-run import graph against the codebase
as it exists then. This document is explicitly **not** that analysis and must not be reused as one.

## F. Dependency graph

```
                          AUTH (preserved) ──► session.ts · api.ts
                                 │
                                 ▼
                    resolvePostLoginDestination
                                 │
              ┌──────────────────┴───────────────────┐
              │ M1: CONSUMER_HOME                    │ firms.length > 0
              ▼                                      ▼
   ┌──────────────────────┐                  /app  ADVISOR WORKSPACE
   │  /household  (V2)    │  ◄── PRIMARY             └─► components/dashboard/* (untouched)
   │  canonical consumer  │
   └──────────┬───────────┘
              │  reads ONE call
              ├──────────────► GET /households/:id/intelligence/current
              │                     └─► Snapshot Engine ─► Financial Kernel (frozen)
              │                     └─► Wealth Health / Explainable Score
              │
              ├── M2 ────────► /onboarding ──► POST /onboarding/household
              ├── M3 ────────► /billing · /admin        (preserved, now reachable)
              │
              └── M4 ────────► /dashboard  (V1 — OPERATIONAL SAFETY NET)
                                  │
                                  ├─► Goals ──────────► /goals          ⟵ no V2 equivalent
                                  ├─► Family ─────────► /family         ⟵ no V2 equivalent
                                  ├─► Protection ─────► /profile        ⟵ no V2 data path
                                  ├─► WealthCoach ────► /ai/coach       ⟵ no V2 equivalent
                                  ├─► SecondOpinion ──► /ai/second-opinion
                                  ├─► EarlyWarning ───► /insights       ⟵ parity unproven
                                  ├─► NetWorthChart ──► /net-worth      ⟵ chart only
                                  ├─► AllocationDonut ► /accounts       ⟵ chart only
                                  └─► AddAccount ─────► /accounts       (migrated; page still imports)
                                          │
                                          └─► V1 retail scorer (computeWealthHealth)
                                              common/financial-snapshot.service.ts  (preserved)

  NOT V1, untouched:  landing page + ToolsSection/calculators ─► /tools
                      admin/** ─► AdminShell · FeatureOverrides · Modal
                      shared UI: Toast · Skeleton · Pager · NumberField · Status · AuthCard
```

## G. Rollback

Every migration in PR A is a link or a constant. Reverting the PR restores `/dashboard` as the home
route with no data or API implications, because **nothing is deleted and no API, schema or data
changes.** Vercel redeploy is instant; `git revert` restores the constant. Rule 3 (preserve rollback)
is satisfied structurally rather than by policy.

## H. Testing checklist for PR A

- ✓ Consumer login lands on `/household`
- ✓ Consumer with no household is redirected to `/onboarding` (guards the only entry point)
- ✓ **`/dashboard` is reachable from `/household` and renders** ← guards rule 7
- ✓ **Goals, Family, Protection, Wealth Coach, Second Opinion still work on `/dashboard`** ← guards rule 2
- ✓ `/billing` reachable; `/admin` reachable for an admin
- ✓ Landing page + calculators render
- ✓ Advisor Workspace renders for a user with a firm
- ✓ Full API e2e (154), core (120), unit suites — unchanged, no API change
- ✓ `tsc --noEmit` + production build clean
- ✓ Green CI

**Awaiting approval. No code has been changed.**
