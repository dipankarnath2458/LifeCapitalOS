# V2 Primary — Final Migration Plan

> **Status:** Final plan for approval. **No code written, nothing deleted, no PR created.**
> **Decision:** V2 becomes the **primary consumer experience now**. V1 is **preserved, operational and
> recoverable** as the rollback path until Module 10. V1 retirement is a separate decision after M10.
> **Method:** import graph over `apps/web/src` + `apps/web/e2e` (`@/`, `./`, `../` forms) and
> data-path tracing through the API and `@lcos/core`.
> Supersedes [`V1_RETIREMENT_PLAN`](./V1_RETIREMENT_PLAN.md) (retained for its inventory).

---

## 0. The finding that shapes this plan

**V1's dashboard cannot see a V2 consumer's money.**

- `HouseholdAccountsService.create` writes `householdId` + `firmId` and **never `userId`**.
- `NetWorthService.current` reads `account.findMany({ where: { userId } })`.

So a consumer who completes the Wealth Health Check with ₹20,00,000 of assets and then opens
`/dashboard` sees **₹0 net worth on a page headed "Your Family Balance Sheet."**

This rules out the obvious coexistence design — "make V2 home, add a link to the old dashboard."
That link would walk a consumer into a confidently wrong number about their own net worth, which is
the precise failure mode M5.5 and M5.6 were built to prevent.

**Second-order:** `/dashboard` redirects to `/onboarding` when `accounts.length === 0` and
`lcos_onboarded` is unset. A V2 consumer with no *retail* accounts can therefore be bounced out of
the page they clicked into.

### The resolution: host the missing capabilities inside V2

Rather than sending consumers to V1's page, **mount the V1 capability components on thin V2 routes**:

| New V2 route | Renders | Data |
| --- | --- | --- |
| `/household/goals` | existing `<Goals />` | `/goals` (retail, unchanged) |
| `/household/family` | existing `<Family />` | `/family` (retail, unchanged) |
| `/household/protection` | existing `<Protection />` | `/profile` (retail, unchanged) |
| `/household/coach` | existing `<WealthCoach />`, `<SecondOpinion />` | `/ai/*` (unchanged) |

Why this is the right answer rather than a compromise:

- **No functionality is silently destroyed** (rule 6) — every capability stays reachable.
- **No business logic is duplicated** — the *same components* are reused, not reimplemented.
- **V1 components stay untouched** (rule 5) — they are imported, not edited.
- **`/dashboard` stays intact and deployed** as the rollback path (rules 3, 4, 14) — we simply stop
  routing consumers into a page that would misreport their net worth.
- **Nothing misleading is shown** — the balance-sheet panels that would read ₹0 are the ones V2
  already replaces, so they are never mounted.
- **Fully reversible** — deleting four small files restores today's behaviour exactly.
- **Clean swap at M5.8+** — when a native V2 Goals ships, it replaces the import on an existing
  route; the URL never changes.

Accepted cost: these four routes render V1-styled components inside the V2 shell, so they will look
different from the rest of V2 until natively rebuilt. That is a visible seam, and it is the honest
price of not removing capability. It is recorded here rather than discovered later.

---

## A. Exact V1 → V2 route changes

| # | Change | From | To |
| --- | --- | --- | --- |
| R1 | Consumer home constant | `CONSUMER_HOME = '/dashboard'` | `'/household'` |
| R2 | Post-login destination | `/dashboard` | `/household` |
| R3 | Firm-less advisor redirect (`app/app/layout.tsx`) | `CONSUMER_HOME` → `/dashboard` | follows R1 |
| R4 | First-run onboarding nudge | `dashboard/page.tsx` → `/onboarding` | `/household` → `/onboarding` |
| R5 | Plans link | `/dashboard` header | `/household` header |
| R6 | Admin link | `/dashboard` header | `/household` header |
| R7 | Admin non-admin redirects | `/dashboard` | `/household` |
| R8 | **New** capability routes | — | `/household/{goals,family,protection,coach}` |
| R9 | `/dashboard` itself | primary consumer home | **preserved, deployed, no longer linked** — rollback path |

## B. Exact files and components affected

**Modified (7 files, all additive or one-line):**

| File | Change |
| --- | --- |
| `lib/postLoginDestination.ts:21` | `CONSUMER_HOME` → `'/household'` |
| `lib/postLoginDestination.spec.ts` | 5 assertions follow the constant |
| `app/household/page.tsx` | first-run nudge; header nav (Plans, Admin); links to the four capability routes |
| `lib/admin.ts:28` | redirect → `/household` |
| `app/admin/layout.tsx:35` | redirect → `/household` |
| `components/AdminShell.tsx:55,70` | back-links → `/household` |
| `e2e/smoke.spec.ts` | assert V2 home; assert every preserved capability still reachable |

**Created (4 thin route files):** `app/household/goals/page.tsx`, `family/page.tsx`,
`protection/page.tsx`, `coach/page.tsx` — each an auth guard plus the existing component.

**Deleted: nothing. Modified V1 components: none.**

## C. V1 functionality preserved

| Preserved | How |
| --- | --- |
| `app/dashboard/page.tsx` | Untouched, deployed, reachable by URL. Rollback path |
| `Goals`, `Family`, `Protection`, `WealthCoach`, `SecondOpinion` | Untouched; **also** mounted on V2 routes |
| `EarlyWarning`, `NetWorthChart`, `AllocationDonut`, `AddAccount` | Untouched on `/dashboard`; V2 has equivalents for their data |
| V1 retail scorer (`computeWealthHealth`, `common/financial-snapshot.service.ts`, `ai.service.ts`) | Untouched — still grounds the AI coach |
| All retail APIs (`/accounts`, `/goals`, `/family`, `/net-worth`, `/insights`, `/ai`, `/tools`, `/profile`) | Untouched |
| All retail **data** | Untouched — no migration, no deletion, no re-keying |
| Marketing site + calculators, Advisor Workspace, admin, shared UI | Untouched |
| Financial Kernel, schema, auth, authz, audit, snapshots, Intelligence Layer | Untouched — **no API or schema change in this PR** |

## D. V2 functionality that already exists (verified by test)

| Capability | Surface | Evidence |
| --- | --- | --- |
| Household provisioning | `/onboarding` | 8 e2e incl. concurrency |
| Wealth Health Check → snapshot | `/wealth-health` | 5 e2e assert payload equals input |
| Net worth, assets, liabilities | `/household` | e2e asserts `assetsMinor` |
| Cashflow, savings rate | `/household` | e2e asserts income/expense |
| Emergency fund, allocation, retirement | `/household` | section-availability e2e |
| Wealth Health score + categories | `/household` | e2e asserts parity with `health-score` for the same `snapshotId` |
| Risks, opportunities, recommended actions, executive summary | `/household` | contract e2e |
| Provenance / immutability | `/household` | e2e: two views capture no snapshot |

## E. Functionality still missing in V2

| Missing | Severity | Note |
| --- | --- | --- |
| ~~**Goals**~~ | ~~High~~ | **DONE — M5.8 PR 2.** Native at `/household/goals`, household-scoped. Note what it does *not* fix: a goal still moves no figure, because the snapshot carries no goals section — see §3 of `M5_8_GOALS_CHARTS_ARCHITECTURE.md` |
| ~~**Family / dependents CRUD**~~ | ~~High~~ | **DONE — M5.8 PR 1.** Native at `/household/family` on `HouseholdMember`, the table the snapshot reads. Also captures date of birth, which V1 never did: that turned retirement on for consumers, where it had reported `available: false` for everyone |
| **Protection capture** | High | **V2 panel has no data path** — `coverTracked` reads `assumptions.insurance`, which the controller never passes, so it is always `false` |
| ~~**AI Wealth Coach**~~ | — | **Shipped M5.7** — native `/household/coach`, grounded on the Intelligence Layer |
| **Second Opinion** (allocation review) | Low | **Superseded, not dropped.** V1's version reads retail `Account.userId` data a V2 consumer does not have, so it would tell them their allocation is fine while seeing nothing. V2 covers the substance in the dashboard's `assetAllocation` panel (drift, concentration, suggestions) and the narrative through the M5.7 coach, whose grounding carries `assetAllocation`. Both premium-gated, as V1's was. Still on `/dashboard` for the rollback path |
| ~~Early-warning parity~~ | ~~Medium~~ | **DONE — M5.8 PR 1.** `early-warning-parity.e2e-spec.ts` proves both paths agree on every non-goal signal and on the traffic light and counts. The goal-derived signal cannot match until goals reach the snapshot (PR 2), and that gap is asserted rather than hidden |
| Net-worth timeline chart | Low | Figures present, chart not rebuilt |
| ~~Allocation donut~~ | — | **Drawn on `/household` since M5.8 PR 2**, from the layer's own percentages |
| Retail↔household double entry | Medium | Onboarding still writes retail-keyed records |

## F. How missing functionality is handled while V2 is primary

| Capability | Handling now | Replaced by |
| --- | --- | --- |
| ~~Goals~~ | **Native since M5.8 PR 2.** Household-scoped, carrying `householdId` and `firmId`. V1's `Goals.tsx` stays on `/dashboard`; the two goal stores both remain, unmigrated by design | done |
| ~~Family~~ | **Native since M5.8 PR 1.** V1's `Family.tsx` stays on `/dashboard` as the safety net; the two stores both remain, unmigrated by design | done |
| Protection | Mounted at `/household/protection` | M5.9 — needs a **data path**, not just a UI |
| AI Coach | **Native since M5.7** — no longer a hosted V1 component | done |
| Second Opinion | Superseded by the dashboard's allocation panel + the M5.7 coach; V1's version stays on `/dashboard` | done |
| ~~Early warning~~ | **Parity proven in M5.8 PR 1** for all non-goal signals | done |
| ~~Charts~~ | **Composed into V2 since M5.8 PR 2.** Drawing extracted to `components/charts/`; V1 keeps its own fetching and its capture button, `/household` stays read-only | done |
| Double entry | Unchanged this PR | With Goals/Family/Protection migration |

**Data is never at risk:** every capability above reads and writes retail-keyed rows through
unchanged APIs. Nothing is re-keyed, migrated or dropped in any phase of this plan.

## G. PR sequence from now through Module 10

| PR | Scope | Deletions | Reversible |
| --- | --- | --- | --- |
| **PR A** | V2 primary: R1–R8, the four capability routes, smoke coverage | none | one-line + 4 file deletes |
| ~~**PR B**~~ *(M5.7)* | **Done.** AI insights on the Intelligence Layer; `/household/coach` native | none | revert |
| ~~**PR C**~~ *(M5.8)* | **Done.** Native V2 Family + early-warning parity (PR 1); native Goals + charts (PR 2) | none | revert |
| **PR D** *(M5.9)* | Protection **data path** + capture; native `/household/protection` | none | revert |
| **PR E** *(M6–M9)* | Reports, What-if, Retirement, Insurance, Estate planning | none | revert |
| **PR F** *(M10)* | Full V2 journey + production verification | none | revert |
| **PR G** *(post-M10)* | **Separate** V1 retirement analysis, then deletion | first deletions | git + deploy |

**No PR before G deletes anything.** Every PR is additive.

## H. Rollback mechanism per migration

| Migration | Rollback | Time | Data risk |
| --- | --- | --- | --- |
| R1/R2 `CONSUMER_HOME` | revert one constant | seconds | none |
| R3 advisor redirect | follows R1 | — | none |
| R4 first-run nudge | revert `household/page.tsx` | seconds | none |
| R5–R7 nav + admin redirects | revert 4 files | seconds | none |
| R8 capability routes | delete 4 files | seconds | none |
| **Whole PR A** | `git revert` merge, or redeploy previous Vercel build | ~1 min | **none** |
| Full V2 → V1 fallback | revert `CONSUMER_HOME` alone — `/dashboard` is still deployed and functional | seconds | **none** |

Rollback is structurally safe because **no API, schema, or data changes exist in this plan.** There
is no consistency window and nothing to restore.

## I. Tests required before each PR merges

**PR A (all automated, all must be green):**

*V2 primary*
- Consumer login lands on `/household`
- Consumer with no household → `/onboarding` (guards the only entry point in the app)
- Wealth Health Check → `/household` shows the entered figures with provenance
- Consumer with no snapshot sees the call to action, never a fabricated ₹0

*Preserved capability — guards rule 6*
- `/household/goals` renders and lists goals
- `/household/family` renders
- `/household/protection` renders and saves cover
- `/household/coach` renders
- Each asserts a **working control**, not just a heading

*Rollback path — guards rules 3, 4, 14*
- `/dashboard` still loads and renders for a signed-in consumer

*Unaffected surfaces*
- Landing page + calculators; Advisor Workspace; admin console; `/billing` and `/admin` reachable
- Password reset, email verification, sign-out

*Platform*
- API e2e 154, core 120, API unit 52, web unit 26 — unchanged (no API change)
- `tsc --noEmit` + production build clean; green CI
- **Teeth check:** each new test is confirmed to fail against a deliberate regression before merge

**PRs B–F:** the above, plus a parity test versus the V1 capability being replaced, plus a §E update.

**PR G:** a fresh import graph, re-derived — this document must not be reused as that analysis.

## J. The exact point at which V1 can safely be retired

All of the following must hold. This is a checklist, not a judgement call:

1. Native V2 equivalents exist for **Goals, Family, Protection, AI Coach, Second Opinion, early
   warning, net-worth chart, allocation chart** — each with a passing test.
2. **Protection has a real data path** — `coverTracked` genuinely `true` for a real consumer.
3. The V1 retail scorer's consumers have moved to the V2 model, with a **documented, verified**
   comparison of the two — per the standing instruction that V1 stays until V2 is fully verified.
4. No route, component or lib module imports any V1 consumer file — proven by a re-run import graph.
5. Module 10 production verification is complete and signed off.
6. A tagged release exists at the last V1-operational commit, so rollback survives deletion.
7. A **new** retirement analysis is produced and approved — separately from this document.

Until every item is true, `/dashboard` stays deployed.

---

**Awaiting approval. No code has been written and nothing has been deleted.**
