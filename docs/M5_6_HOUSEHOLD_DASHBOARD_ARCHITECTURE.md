# M5.6 — Household Dashboard — Architecture

> **Status:** Design, approved for implementation (PR #51). **Module:** M5.6 (Household Dashboard).
> **Depends on:** M5 Financial Intelligence Layer, the frozen Financial Kernel (M2-6
> `FinancialSnapshot`), M3-1 Health Score, and M5.5 (#48 provisioning, #49 onboarding, #50 Wealth
> Health Check). **Constraints:** Financial Kernel **frozen**; **the V1 retail scorer stays
> operational** until the planned V2 transition; immutable snapshots; ADR compliance; no schema
> change.
> Companion: [`M5_FINANCIAL_INTELLIGENCE_LAYER`](./architecture/M5_FINANCIAL_INTELLIGENCE_LAYER.md),
> [`M5_5_WEALTH_HEALTH_CHECK_ARCHITECTURE`](./M5_5_WEALTH_HEALTH_CHECK_ARCHITECTURE.md),
> [`M5-5_CONSUMER_ACTIVATION`](./architecture/M5-5_CONSUMER_ACTIVATION.md),
> [`KERNEL_GOVERNANCE`](./architecture/KERNEL_GOVERNANCE.md),
> [`FUTURE_MODULE_CONTRACT`](./architecture/FUTURE_MODULE_CONTRACT.md).

---

## 1. What this is

The Household Dashboard is the consumer's home for their finances: net worth, emergency fund,
allocation, retirement, protection, cashflow, risks, opportunities and their Wealth Health score —
all of it derived, explained, and traceable to one immutable snapshot.

It is also a governance statement. M5 built the Financial Intelligence Layer precisely so that
*"a number shown on the Dashboard, cited by the AI Family CFO™, printed in a Report, and seeded into
a What-if is the same number, computed the same way, traceable to the same `snapshotId`."* **This
dashboard is the first surface to honour that end to end**, and becomes the reference implementation
for every surface that follows.

## 2. One call, one snapshot, zero client arithmetic

`GET /api/households/:id/intelligence/current` already returns everything the dashboard needs —
`netWorth`, `emergencyFund`, `assetAllocation`, `retirement`, `insurance`, `cashflow`, `risk`,
`opportunity`, `wealthHealth`, `executiveSummary`, `recommendedActions` and `meta`.

So the dashboard makes **exactly one** intelligence call. That is not a performance micro-decision;
it is the correctness property:

- **Internal consistency by construction.** Every figure on the page comes from the same
  `snapshotId`. Assembling the page from several endpoints would let net worth come from one moment
  and the health score from another — two panels quietly disagreeing, with nothing on screen to say
  so.
- **No duplicated business logic.** The client computes no ratio, no percentage, no gap, no band.
  Everything rendered is a field the engine returned. This is the kernel governance rule (*no
  business math in the browser*) and it is what keeps the dashboard from becoming a second,
  divergent implementation of the same finance.
- **Reproducible.** `meta.snapshotId`, `meta.engineVersion`, `meta.scoreModelVersion` and
  `meta.computedAt` are surfaced in the UI, so any number a user or advisor questions can be traced
  back to the exact immutable inputs and engine that produced it.

The only client-side transformation is **formatting** — minor units to currency, ratios to
percentages for display.

### 2.1 Which net worth the dashboard reports

The snapshot deliberately carries **two** net-worth figures, per ADR-012:

| Figure | Definition | Where |
| --- | --- | --- |
| Gross | assets − liability-flagged **accounts** (overdrafts, credit cards) | `payload.netWorth.netWorthMinor` |
| Reconciled | that, minus the **M2-5 debt ledger** (home loans, personal loans) | `payload.householdEquity.reconciledEquityMinor` |

The Wealth Health Check writes every loan a family enters to the **debt ledger**, and never as a
liability account. For a consumer household the gross figure therefore omits their debt entirely.

The Financial Intelligence Layer originally reported the gross figure, so a family who entered a
₹4,00,000 loan in the wizard saw **₹20,00,000 net worth, ₹0 liabilities, and their loan nowhere on
the page** — the same class of confidently-wrong number that V1 produced from the opposite
direction, and that this module exists to prevent.

The layer now reports the **reconciled** figure as `netWorth.netWorthMinor`, and exposes
`totalDebtMinor` and `grossNetWorthMinor` alongside it:

- `solvencyRatio` is computed over the same reconciled numerator, so it agrees with the net worth
  printed beside it.
- The **trend series is reconciled too** — a gross series under a reconciled headline would report
  a change the two numbers cannot produce.
- The **retirement corpus proxy** uses the reconciled figure: borrowed money is not corpus.
- The **executive summary** narrates the reconciled figure, because that paragraph is the text
  every narrative surface — and from M5.7 the AI coach — repeats verbatim.

The dashboard renders **Assets · Liabilities · Loans** so the debt is visible in its own right,
not merely subtracted out of sight.

**The kernel is unchanged.** Both figures were always in the payload, correctly computed; this is a
read-model presentation fix. `FinancialSnapshotPayload` and `schemaVersion 1` are untouched, so
every stored snapshot reconciles correctly with no backfill.

**One surface still reports the gross figure by design:** the Advisor Workspace net-worth card
reads `GET /households/:id/net-worth/current` (M2-3, frozen kernel), not the intelligence layer.
`grossNetWorthMinor` is retained precisely so the two surfaces can be reconciled rather than
appearing to contradict each other. Aligning the advisor surface is a separate decision, since it
means changing a frozen kernel endpoint's meaning.

## 3. Absence is a first-class state, not an empty panel

Two kinds of absence exist and the dashboard treats them differently, because conflating them is how
a dashboard starts lying.

**No snapshot at all.** `current` returns `{ available: false, reason: 'no snapshot captured' }`. The
dashboard renders a single call to action pointing at the Wealth Health Check (`/wealth-health`), not
a grid of zeros. A zero net worth and an unknown net worth look identical once rendered as `₹0`, and
only one of them is true.

**A section that cannot be computed.** Every section is
`{ available: true, confidence, data } | { available: false, reason }`. A section that is unavailable
renders **its reason**, verbatim from the engine. So a family that has not recorded insurance sees
*why* protection is unknown rather than a protection gap of zero — which would read as "you are fully
covered."

`meta.dataCompleteness` (`pct` + `missing[]`) is shown as a prompt for what to add next, so the page
is honest about how complete a picture it is drawing.

## 4. Snapshot lifecycle — read-only here

```
Wealth Health Check (M5.5) ──writes──► household accounts / debts / transactions
                                                      │
                                          POST .../financial-snapshot
                                                      │
                                                      ▼
                                        FinancialSnapshot (immutable, append-only)
                                                      │
                                    GET .../intelligence/current  (pure compose, not persisted)
                                                      │
                                                      ▼
                                          Household Dashboard (M5.6) — READ ONLY
```

**The dashboard writes nothing.** It captures no snapshot, persists no score, mutates no kernel
table. It is a pure reader, which is what makes it safe to open, refresh, and share, and what makes
rollback trivial.

Refreshing the underlying data is an explicit user action that lives in the Wealth Health Check, not
a side effect of viewing a page. Snapshots stay immutable and append-only per ADR-004; the dashboard
always reads the latest one.

## 5. ADR and governance compliance

| Rule | How this complies |
| --- | --- |
| Financial Kernel frozen (G-1…G-6) | No schema change, no migration, no kernel code modified. Consumed read-only through the published API. |
| ADR-004 — financial history is immutable | The dashboard performs no writes at all; it reads the latest snapshot. |
| ADR-010 — additive migrations, retail rows coexist | No migration. The V1 retail surfaces are untouched and keep working. |
| Thin controllers, pure core; no business math in the browser | The client renders engine fields and formats them. No derived figure is computed in the UI. |
| One calculation, many consumers (M5) | The dashboard consumes the Financial Intelligence Layer rather than re-aggregating. It is the reference consumer. |
| AI features consume the FIL, never raw financial data | Reinforced: this surface reads only the FIL. |
| Design system frozen | Composed from `@/ui`; nothing under `src/ui/**` is edited. |
| Authentication kernel frozen | Untouched. |

**Authorisation.** `GET .../intelligence/current` is guarded by `HouseholdScopeGuard` and requires no
elevated firm role. A consumer is `OWNER` of their personal firm by construction (#48), and an
advisor already holds a role in their firm — so no change to the role model or the guard is needed.

## 6. Compatibility strategy — the V1 retail scorer stays operational

**Explicitly out of scope: merging the V1 and V2 scoring engines.**

Two scoring models coexist and this PR keeps it that way:

| | Model | Consumed by | Status after M5.6 |
| --- | --- | --- | --- |
| **V1 retail** | `computeWealthHealth` — emergency fund, protection, retirement gap | the AI coach's grounding (`ai.service.ts`), via the retail in-memory snapshot | **Operational, untouched** |
| **V2 kernel** | `computeFinancialHealthScore` — net worth, debt burden, savings, liquidity, diversification | health-score API, Financial Intelligence Layer, **this dashboard** | Canonical for the V2 path |

They can produce different numbers for the same family. That is a known, accepted state until the
planned V2 transition; this PR neither reconciles nor degrades either one.

**Routing.** The Household Dashboard ships at **`/household`**, additively. `CONSUMER_HOME` continues
to point at the V1 retail dashboard (`/dashboard`), which keeps working exactly as before for
existing retail users. The new dashboard is reached from the Wealth Health Check result screen and
from the retail dashboard.

Repointing `CONSUMER_HOME` at `/household` is a **one-line change** deliberately deferred to the
planned V2 transition, so that the switch — and its rollback — is a single reviewable decision rather
than something bundled into the PR that builds the page.

| Surface | Effect |
| --- | --- |
| V1 retail dashboard `/dashboard` | Unchanged; still the consumer home |
| V1 retail scorer / AI coach | Unchanged and operational |
| Advisor workspace `/app` | Unchanged |
| Wealth Health Check `/wealth-health` | Gains a link to the new dashboard |
| API | No change — no new endpoint, no modified endpoint |
| Schema | No change, no migration |

## 7. Testing strategy

The failure mode this design guards against is the one M5.5 established: **a number rendered
confidently that does not reflect the family's actual position.** For a read-only surface that takes
two forms — showing a figure the engine did not produce, and showing zero where the truth is unknown.

So the tests assert **values and states**, not that a page rendered:

1. **API e2e** — the intelligence response for a household with known figures matches those figures,
   and every section the dashboard renders is present and available.
2. **API e2e** — a household with no snapshot returns `available: false`, so the dashboard's
   call-to-action path is real rather than assumed.
3. **Smoke** — a consumer completes the Wealth Health Check, opens the dashboard, and sees their
   actual net worth and health score, with no section showing a fabricated zero.
4. **Smoke** — a consumer with no snapshot sees the call to action, not an empty grid.
5. **Teeth verification** — as with #49 and #50, a deliberate regression is introduced and the tests
   are confirmed to fail before the change is shipped.

## 8. Rollback

Additive and route-scoped: reverting removes `/household` and leaves every other surface byte
identical. No API redeploy, no migration to undo, and — because the dashboard writes nothing — **no
data written by this feature exists to clean up**. See the PR's rollback plan for operational steps.
