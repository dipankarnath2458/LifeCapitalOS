# Gap 7 — household resolution must preserve three states

> **Status: fixed.** Every figure below was measured or read from source at `3923977`
> (`origin/main`), not recalled. This is a **web-only** bug fix: no API, kernel, schema,
> migration or scoring change.
>
> Gap 7 is listed as open in `docs/architecture/V2_MASTER_ARCHITECTURE_AND_HISTORY.md`:
> *"`/onboarding/status` remains a rate-limit pressure point"*. It turned out to be two defects
> wearing one name — a correctness bug and the load that triggered it.

---

## 1. Root cause

The API contract was never the problem, and neither was `getOnboardingStatus`. **The collapse
happened one layer above them.**

`getOnboardingStatus` already distinguished the two cases correctly: it returned `null` when the
*request* failed, and an object whose `householdId` was `null` when the *family* had no household.
Two different facts, two different values.

Then five derived helpers flattened both into one falsy value. The canonical instance:

```ts
// lib/household.ts — before
export async function resolveHouseholdId(token: string): Promise<string | null> {
  const status = await getOnboardingStatus(token);
  const id = status?.householdId ?? null;   // ← both failures become the same `null`
  if (id) rememberHouseholdId(id);
  return id;
}
```

After that `??`, a caller could not tell "they never onboarded" from "we could not ask". Every
caller chose the first reading, because it was the only one the type could express.

**`/onboarding/status` returns 429 under ordinary load** — it is the most-called route in the
product (every V2 surface needs the household id before it can ask for anything else) and it is
rate limited per route per IP at 120/60s (`app.module.ts:32`, no per-route override). So the
failure was not hypothetical. It was reproduced deterministically during M5.13.

**The rule this breaks** is the one this codebase applies everywhere else: `Section<T>` carries a
`reason`; `monthlyContributionMinor` is nullable because there is no honest default; M5.12 omits
an unscored category rather than scoring it zero. *An error is not a fact about the family.*

## 2. The contract before

**API** — `GET /api/onboarding/status` (unchanged by this work):

```ts
{ hasHousehold: boolean; firmId: string | null; householdId: string | null;
  hasOwnHousehold: boolean; ownHouseholdId: string | null }
```

**Client**, and what `null` meant at each layer:

| Function | Returned | `null` meant |
|---|---|---|
| `getOnboardingStatus` | `OnboardingStatus \| null` | **(b) request failure only** — correct |
| `resolveHouseholdId` | `string \| null` | **(a) and (b)** — the defect |
| `householdMembers.householdId` | `string \| null` | **(a) and (b)** |
| `familyCfo.householdId` | `string \| null` | **(a) and (b)** |
| `wealthHealth.loadCurrentFigures` | `WealthHealthInput \| null` | **(a) and (b)** |
| `app/layout.tsx` (inline) | `… \| null` | **(a) and (b)** |

So the answer to *"does `null` mean no household, request failure, or both?"* is: **it depended on
the layer.** Correct at the bottom, collapsed one step up, and every consumer read the collapsed
value.

## 3. What each surface actually showed a family

| Surface | On a 429 it rendered |
|---|---|
| `/household/goals` | "Let's set up your household first" + **Get started** |
| `/household/retirement` | same |
| `/household/protection` | same |
| `/household/family` | same |
| `/household/coach` | "no household yet" |
| `/app` | **no redirect at all** — a consumer stranded in the Advisor Workspace |
| `/wealth-health` | a **blank form**, whose submission overwrites real figures (see §7) |

**`/household` was already correct.** `loadDashboard` distinguished `{ kind: 'error' }` from
`{ kind: 'needs-onboarding' }` (`intelligence.ts:177-198`). That is the shape this fix
generalises — the codebase already knew the right answer in one place and nowhere else.

## 4. The contract after

Two unions in `lib/household.ts`, following the `kind`-discriminated idiom `DashboardState`
already uses:

```ts
export type UnavailableReason = 'rate-limited' | 'network';

export type OnboardingStatusResult =
  | { kind: 'ok'; status: OnboardingStatus }
  | { kind: 'unavailable'; reason: UnavailableReason };

export type HouseholdResolution =
  | { kind: 'resolved'; householdId: string }   // HAS_HOUSEHOLD
  | { kind: 'none' }                            // NO_HOUSEHOLD
  | { kind: 'unavailable'; reason: UnavailableReason };   // UNKNOWN
```

Properties it holds:

- **The three states are not representable as each other.** There is no value `resolveHousehold`
  can return that a caller can mistake for a different state — which is why the regression tests
  in §6 cannot pass against the old code.
- **429 is distinguishable from every other failure**, so it can be handled and observed
  separately, while the *copy shown to a family never names a status code or an endpoint*.
- **Only a real id is cached.** "No household" can change mid-session and must be re-checked;
  "unavailable" is never stored as though it were an answer.
- **No retry.** A 429 means the client is already asking too often; retrying on a timer converts a
  rate limit into a retry storm. The person presses "Try again" — and by then the window has
  almost always rolled.
- **Backward compatible where it counts.** `ApiError.message` is byte-identical to the string
  thrown before (`Request failed: 429`), so `familyCfo`'s existing `/ 403$/` match still works;
  `status` is purely additive. `chooseDestination`'s deliberate "fail toward the consumer home"
  behaviour is unchanged, and its 12 existing tests pass untouched.

## 5. The second defect: request amplification

The cache existed before this fix. **Only one of the seven call sites used it.**

| Call site | Before | After |
|---|---|---|
| `resolveHouseholdId` (3 pages) | cached | cached |
| `loadDashboard` (`/household`) | **uncached, every load** | cached |
| `householdMembers.householdId` | **uncached, once per operation ×4** | cached |
| `familyCfo.householdId` | **uncached, once per operation ×2** | cached |
| `wealthHealth.loadCurrentFigures` | **uncached** | cached |
| `postLoginDestination` | direct call | shared reader |
| `app/layout.tsx` | direct call | shared reader |

`householdMembers` re-resolved on **list, add, update and remove** — adding three family members
re-asked four more times whether the family had a household at all.

`ensureHousehold` now also caches the id it was just given, so the page a user lands on straight
after onboarding does not immediately re-ask for a value we had.

**Raising the limit was explicitly rejected.** It would have hidden the amplification rather than
removed it, and left the correctness bug — which a slow network reaches without any rate limiter —
completely untouched.

## 6. Measured, not estimated

Both runs: same machine, same database, same built API, request log captured server-side.

| | Clean `main` | This branch |
|---|---|---|
| Browser tests | 39 | **47** |
| `/api/onboarding/status` calls | **120** | **54** |
| Calls per test | 3.08 | **1.15** |
| HTTP 429 | 0 | 0 |

`main` sat at **exactly 120 against a limit of 120**. That is why M5.13's four extra tests tipped
it into a deterministic failure — the suite was already at the ceiling, and nobody knew because
nothing had counted.

The fix runs **8 more tests on 55% fewer calls**, leaving real headroom rather than balancing on
the limit.

## 7. `/wealth-health` — the worst instance, and a data-loss risk

Worth calling out separately, because it was not merely a wrong screen.

The check prefills the form from what the household already holds, so a blank field means *"I have
none of this"* — a decision the user made. When the prefill **failed**, the page kept the empty
form (`/* keep the empty form */`) and was indistinguishable from a family with nothing recorded.
Pressing "See my score" then wrote those blanks over a household that had figures all along.

An unknown state must not be offered as an editable zero. The page now refuses to render the form
at all when it could not read what exists, and offers a retry. Asserted in the browser suite: the
cash field is absent, so there is nothing to submit.

## 8. Files changed, and why

| File | Why |
|---|---|
| `lib/api.ts` | `ApiError` carries `status`, so 429 is distinguishable without regex-matching a message. Same message text; additive. |
| `lib/household.ts` | **The fix.** `fetchOnboardingStatus` + `resolveHousehold` return the three-state unions; `ensureHousehold` caches the id it created. |
| `lib/intelligence.ts` | Already correct — routed through the resolver so it stops re-asking for a cached value. |
| `lib/householdMembers.ts` | `MembersResult`; writes throw `HouseholdUnavailableError` carrying *which* failure. Removes 4 uncached calls. |
| `lib/familyCfo.ts` | `CoachResult`. Removes 2 uncached calls. |
| `lib/wealthHealth.ts` | `CurrentFiguresResult` — see §7. |
| `lib/householdGoals.ts` | Re-export updated to the new resolver. |
| `lib/postLoginDestination.ts` | Uses the shared reader; routing behaviour deliberately unchanged. |
| `components/HouseholdUnavailable.tsx` | **New.** The third state, rendered once rather than six times — duplicating it is how the pages drifted apart in the first place. |
| `app/household/{goals,retirement,protection,family,coach}/page.tsx` | Render three states; carry the reason. |
| `app/wealth-health/page.tsx` | Refuses the blank form (§7). |
| `app/app/layout.tsx` | A consumer is no longer stranded in the Advisor Workspace when we cannot identify them. |
| `lib/household.spec.ts` | **New**, 17 cases. |
| `e2e/smoke.spec.ts` | **New**, 8 cases. |

## 9. The regression tests, and proof they bite

`lib/household.spec.ts` covers the required matrix: **A** real household → `resolved`;
**B** no household → `none`; **C** 500/503/404/thrown → `unavailable`, never `none`; **D** 429 →
`unavailable` with `reason: 'rate-limited'`, never `none`; **G** amplification.
`e2e/smoke.spec.ts` covers **E** (four pages, `/wealth-health` and `/app` render the right state
under a forced 429) and **F** (a family who genuinely has no household still reaches onboarding).

**Proof the tests fail against the old implementation.** The pre-fix logic was reconstructed under
the new signatures — `status?.householdId ?? null`, both outcomes becoming `none` — so the tests
were exercising old *behaviour*, not a missing export:

```
× C › HTTP 500 is unavailable, not "no household"   → expected { kind: 'none' } to equal { kind: 'unavailable' }
× C › HTTP 503 …                                    → expected { kind: 'none' } to equal { kind: 'unavailable' }
× C › HTTP 404 …                                    → expected { kind: 'none' } to equal { kind: 'unavailable' }
× C › a thrown network error …                      → expected { kind: 'none' } to equal { kind: 'unavailable' }
× D › is reported as rate-limited …                 → expected { kind: 'none' } to equal { kind: 'unavailable' }
× D › is distinguishable from every other failure   → expected { kind: 'none' } to not equal { kind: 'none' }
× D › recovers once the window rolls                → expected 'none' to be 'unavailable'
× G › provisioning caches the new id                → expected 2 to be 1

Tests  8 failed | 40 passed (48)
```

**8 failed, and cases A and B still passed** — the tests discriminate the specific defect rather
than failing indiscriminately. Against the fix, 48/48.

## 10. Results

| Suite | Result |
|---|---|
| Core | 187/187 |
| API unit | 72/72 |
| API e2e | 246/246 across 34 suites |
| Web unit | **48/48** (31 before + 17 new) |
| Browser smoke | **47/47**, two consecutive runs (39 before + 8 new) |

## 11. Remaining architectural risk

1. **The limit is still 120/60s and the route is still the busiest in the product.** This fix buys
   large headroom (3.08 → 1.15 calls per journey) but changes no server-side limit. A genuinely
   heavy session can still reach it — the difference is that it now degrades honestly instead of
   telling a family they have no household.
2. **`sessionStorage` is per tab.** Ten tabs are ten resolutions. Correct (each tab is a session)
   but worth knowing before reading the numbers as per-user.
3. **The cache cannot be invalidated from outside the tab.** A household is created once and never
   deleted, so the id cannot go stale; if household deletion ever ships, this needs revisiting.
   `clearTokens` already drops it at sign-out.
4. **`familyCfo` still detects 403 by regex** (`/ 403$/`) rather than `ApiError.status`. Left
   deliberately: it works, and rewriting it is unrelated to this fix. `isApiStatus` is exported
   for whoever touches that path next.
5. **`chooseDestination` still fails toward the consumer home** when it cannot tell. That is a
   documented, deliberate choice ("fail toward the destination that works for more people") and is
   *not* a false business state — nobody is told anything untrue about their household. Untouched.
