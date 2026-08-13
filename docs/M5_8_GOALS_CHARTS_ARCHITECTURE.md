# M5.8 PR 2 — Native Goals + charts — Architecture

> **Status:** Design, written before implementation.
> **Scope:** household-scoped Goals; the existing charts composed into V2; the goal-signal parity
> gap revisited.
> **V2 `/household` remains the primary consumer experience.** `/dashboard` stays deployed and
> functional as the recoverable safety net; Module 10 is the V1-retirement decision point.
> **No schema change, no migration, no design-system change, no Financial Kernel change.**

---

## 1. Goals — already household-capable, with no API to reach it

`Goal` carries `firmId`, `householdId` and `memberId` as nullable columns, added in M1b's advisory
scoping. **So no schema change is needed** — the columns exist and are indexed. What is missing is
a household-scoped API: goals are reachable only through the retail `/goals` module, keyed on
`userId`.

### 1.1 `Goal.userId` is NOT NULL — and that is a boundary, not a bug

Unlike `Account`, `Transaction` and `Debt`, `Goal.userId` was never relaxed. Every goal must have a
user.

For a **consumer** that is unambiguous: the user is themselves, and the household is theirs. The
new write sets `userId` = the acting consumer, plus `householdId` and `firmId`.

For an **advisor** creating a goal on a client's household it would be wrong — `userId` would name
the advisor, which is the exact confusion that put advisors into client households in #52/#54.
**Advisor-created goals are therefore out of scope**, as instructed, and the service refuses rather
than guessing: a caller who is not a member of the household's own family gets no goal written under
their name. Closing that properly means relaxing `Goal.userId` to nullable — a schema change, and a
separate decision.

### 1.2 What native goals change, and what they do not

They change **where goals live** — the household, alongside everything else the family owns — and
they give the V2 experience a real goals surface instead of a hosted V1 component.

They do **not** change any score. The Financial Snapshot has no goals section, so a goal moves no
figure in the dashboard, the health score or the AI grounding. Stated plainly because "native goals"
could easily be read as "goals now count", and they do not. See §3.

## 2. Charts — reuse means extracting, because neither is reusable as-is

The instruction is to reuse the existing charts through composition rather than redesign them. On
inspection **neither component can be composed**, for three independent reasons:

| Component | Problem |
| --- | --- |
| `AllocationDonut` | Takes `{ token }` and fetches `/accounts` — **retail**, `userId`-keyed. A V2 consumer's accounts are household-keyed, so it would render an empty donut |
| `AllocationDonut` | Computes the allocation in the browser via `allocationFromValues` — business math on the client, which V2 forbids and the FIL already does server-side |
| `NetWorthChart` | Takes `{ token }`, fetches `/net-worth/timeline` (retail), **and POSTs `/net-worth/snapshot`** from a capture button |

That last one matters most. `/household` is read-only by design, with an existing e2e asserting
*"viewing the dashboard captures no snapshot"*. Mounting `NetWorthChart` would put a snapshot-writing
button on it.

### 2.1 The resolution: split fetching from drawing

Each chart's **presentational** part — the recharts markup, the palette, the labels, the tooltip —
is extracted into a prop-driven component that takes data and renders it. Nothing about the drawing
changes.

- **V1 keeps its component**, its retail fetching and its capture button, and renders the extracted
  chart. `/dashboard` behaves exactly as it does today.
- **V2 renders the same extracted chart** with data from the Financial Intelligence Layer, and has
  no capture button.

This is reuse in the only sense available: **one copy of the chart code, drawn identically in both
places.** The alternative — a second implementation for V2 — is the redesign the instruction rules
out, and it would let the two drift.

The cost is honest: two V1 files change, each losing its inline markup and gaining an import. The
V1 dashboard smoke test guards that, and the extracted components carry no fetching, so nothing about
V1's data path moves.

### 2.2 Where V2's chart data comes from

Both from the kernel's own read APIs. **No browser arithmetic**:

| Chart | Source | Field |
| --- | --- | --- |
| Allocation | `GET /households/:id/intelligence/current` | `assetAllocation.data.current[]` — `assetClass`, `pct`, `baseValueMinor`, already computed |
| Net-worth trend | `GET /households/:id/financial-snapshot/timeline` | one point per captured snapshot |

The trend plots the **reconciled** net worth — `netWorthMinor − totalDebtMinor`, both returned by
`timeline` — for the same reason as #55 and #59: a chart drawn from the gross figure would
contradict the headline directly above it. The timeline already returns both fields, so this is a
selection, not a calculation.

## 3. The goal-signal parity gap — revisited, and deliberately left open

PR 1 proved early-warning parity for every non-goal signal and asserted the goal gap explicitly, so
that closing it could not be forgotten. This is the revisit.

**The gap is real.** V1's `computeEarlyWarning` input carries `goalSlippage`; the layer's input omits
it, because `FinancialSnapshotPayload` has no goals section. So V2 can never raise a
`goal_slippage` signal.

**Closing it is possible and is precedented.** `members` was added to `schemaVersion 1` as an
optional, additive key, and `goals` could follow the same path. It needs, exactly:

1. An optional `goals` array on `FinancialSnapshotPayload`
2. `HouseholdFinancialSnapshotService` reading household goals at capture
3. `goals` added to `OPTIONAL_KEYS` in `kernelContract.test.ts` — the frozen-contract guard
4. The layer computing `goalSlippage` and passing it to `computeEarlyWarning`

No database migration: `payload` is a JSON column.

**It is deliberately not done here**, for one reason that outweighs the tidiness of closing it:

> It would change what the Wealth Health Score and the early-warning signals *say* about households
> that already exist. A family with a stretched goal would see their risk signals change without
> having changed anything about their money.

That is a Financial Kernel decision — the same class as the reconciliation change in #55 — and this
milestone was scoped as "native Goals + charts", not "goals begin affecting the score". Folding a
scoring change into a UI PR is how a number quietly changes meaning without anyone deciding it
should.

**So the gap stays asserted.** The parity test continues to require that V2 raises no goal-derived
signal. When the kernel decision is taken, that test fails and forces this document to be revisited
— which is precisely what it is for.

## 4. What this does not touch

- Financial Kernel, `FinancialSnapshotPayload`, `schemaVersion 1`, checksums — unchanged
- No schema change, no migration
- Encryption — unchanged
- Design system — composed from `@/ui`, never edited
- `/dashboard` — stays deployed and functional; V1's `Goals.tsx` stays mounted there
- The V1 retail `/goals` API — untouched, still serving `/dashboard`
- Advisor-created goals — out of scope (§1.1)

## 5. Two goal stores, both retained

Retail goals (`Goal` with `userId` only) and household goals (`Goal` with `householdId`) both
continue to exist, and this PR migrates nothing between them. Same position as the two member stores
after PR 1: copying rows is a data migration with its own approval, not part of a UI milestone.

A consumer's existing retail goals remain visible on `/dashboard`. New goals created in V2 are
household-scoped. Because a consumer's `userId` is set on both, the retail `/goals` list will also
show household goals they created — which is a convenience, not a leak: same user, same person.

## 6. Tests and acceptance criteria

**Done when:**

1. A consumer can create, edit and delete goals at `/household/goals`, stored household-scoped
2. A goal created in V2 carries `householdId` **and** `firmId`, not just `userId`
3. Goals are household-scoped: another household's goal is a 404
4. The dashboard renders an allocation chart and a net-worth trend from layer data
5. The trend plots the **reconciled** net worth, matching the headline
6. `/household` still captures no snapshot — no write path arrives with the charts
7. `/dashboard`, V1 `Goals.tsx` and both V1 charts still work
8. The goal-signal parity gap remains asserted (§3)

**Tests**

- *Goals e2e* — CRUD; household + firm scoping on the row; cross-household 404; auth required
- *Read-only e2e* — viewing `/household` after the charts captures no snapshot
- *Trend e2e* — the timeline point equals reconciled net worth, not gross
- *Smoke* — create a goal in V2 and see it; both charts render on `/household`
- *Safety net smoke* — `/dashboard` renders with its charts intact
- *Parity* — unchanged from PR 1, still asserting no goal-derived signal in V2

**Teeth:** every new test confirmed to fail against a deliberate regression before it is trusted.

| Test | Regression | Result |
|---|---|---|
| Household + firm scoping | drop `firmId` from the create | `Expected "cmsrk506h…", Received null` |
| Advisor cannot author a client's goal | remove `assertOwnHousehold` | `Expected 403, Received 201` |
| A goal changes no figure | put a `goals` section in the payload | `Received [{"name":"x",…}]` |
| Goals native + allocation chart | rename the donut's testid | `getByTestId('allocation-chart')` not visible |
| A single capture is not a trend | render the trend from one point | `Expected 0, Received 1` — **only after §6.1** |

### 6.1 The trend test had no teeth, and why

The first version asserted the chart's absence directly after `goto('/household')`. It **passed
against a build that drew a trend from a single capture**: `toHaveCount(0)` is satisfied the moment
the element is missing, and at that moment the timeline fetch had not returned. "We correctly drew
no trend" and "the page had not loaded yet" were indistinguishable.

Nothing user-visible marks the difference — with one point the correct output *is* an empty region.
So the dashboard now renders a `trend-region` wrapper as soon as the timeline **resolves**, holding
the chart only when there are two or more points, and the test waits for that wrapper before
asserting the chart is absent. With the ordering fixed, the same regression fails as it should.

### 6.2 A rate limit, found by the suite and fixed in the product

The full smoke suite began failing two tests with the consumer landing in the **Advisor
Workspace** — `/api/onboarding/status` was returning `429`, so `hasOwnHousehold` read as false and
`postLoginDestination` sent them to the advisor home. The throttle is `120 / 60s`, keyed per route
per IP.

The cause was this PR's own code. Every goals call and the dashboard's timeline call re-fetched
`/onboarding/status` to obtain a household id the caller was **already holding** — `loadDashboard`
resolved it and threw it away. Fixed at the source, not in the test:

- `DashboardState` carries `householdId` on the states that have one (additive)
- `lib/householdGoals` takes the id as a parameter; `resolveHouseholdId` is called **once** per page
- the dashboard chains the timeline off the id `loadDashboard` already resolved

Measured over a full suite run afterwards: peak **102** calls to that route per 60s against a limit
of 120, and **zero** 429s. The suite is a single IP standing in for 25 users, which no real family
resembles; the limiter itself is unchanged, because loosening a rate limit to make tests pass would
be the wrong repair.

## 7. Rollback

Additive. `git revert` restores the temporary Goals surface and the inline V1 charts. **No data
implications** — no schema change, no migration, nothing re-keyed. Goals created through V2 remain
valid rows that the retail API already reads.
