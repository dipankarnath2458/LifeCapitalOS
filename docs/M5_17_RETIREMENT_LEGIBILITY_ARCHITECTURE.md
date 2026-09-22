# M5.17 — Retirement money becomes legible

> **Status: implemented.** Every figure below was read or measured from source at `fb0dc78`
> (`origin/main` after M5.16), not recalled.
>
> **This milestone changes no calculation.** Same data → same allocation → same corpus → same
> score → same concentration → clearer presentation. §4 states that as an invariant and §5 pins
> it with a test that varies only `accountType` and asserts every other figure is identical.

---

## 1. The defect

M5.15 taught the snapshot to carry `assets[].accountType`. M5.16 let a family produce one. Until
now **nothing read it back** — `accountType` had zero readers anywhere in the codebase.

Meanwhile the composer buckets an asset with no `assetClass` as `'unclassified'`
(`household-financial-snapshot.service.ts:141`), and the consumer dashboard printed that key
verbatim (`app/household/page.tsx:465`, `:456`, `:475`).

So a family recorded ₹5,00,000 under **"Retirement savings"** and the dashboard answered
**"Unclassified"** — and if it was their largest holding, a red badge reading *"N% in
Unclassified"*.

Read precisely, that is two defects, and conflating them is how the wrong fix gets built:

1. **Wording.** An internal bucket key was leaking to a family as UI copy.
2. **Placement.** We held the fact they had stated and displayed nothing derived from it.

Critically, **"unclassified" is *true* at the asset-class layer.** We never asked whether their
PPF is debt or their NPS is equity. The fix is therefore *not* to relabel the bucket
"Retirement" — that would dissolve the very boundary this milestone exists to protect.

## 2. The boundary

> **`accountType`** says what kind of *account* holds the money.
> **`assetClass`** says what economic *asset* the money is.

A retirement account whose investment mix nobody recorded is genuinely unclassified at the
asset-class layer. M5.17 keeps saying so, and states the retirement fact **beside** the
allocation rather than inside it.

There is **no `retirement` asset class**, and there must not be one. Inventing one — or mapping
retirement to `cash`, `equity`, `debt` or `other_asset` — would assert an economic fact nobody
recorded, and would silently move the allocation, the HHI, the diversification sub-score and
every stored comparison with them.

## 3. What was built

### 3.1 `retirementAccountsMinor` — derived in core, from `assets`

```ts
// financialIntelligence.ts
export const retirementAccountsMinor = (p: FinancialSnapshotPayload): number | null => {
  const typed = (p.assets ?? []).filter((a) => a.accountType !== undefined);
  if (typed.length === 0) return null;              // pre-M5.15 snapshot: we cannot know
  return typed
    .filter((a) => a.accountType === 'retirement')
    .reduce((sum, a) => sum + a.baseBalanceMinor, 0);
};
```

**Read from `p.assets`, never from `p.assetAllocation`.** The allocation buckets by `assetClass`
and carries no `accountType`, so it *cannot* answer this — and reaching for it is exactly how the
two concepts would have collapsed into one. Arithmetic lives in `@lcos/core` (rule 9.3 #4).

Exposed at the **top level** of the intelligence response — not inside any `Section`, and not on
`assetAllocation`, whose shape is left untouched. §6 explains why that placement is the important
part of this milestone.

### 3.2 Three states, not two

| Value | Meaning |
|---|---|
| `null` | This snapshot predates account-type capture. Not one asset carries an `accountType`. |
| `0` | This snapshot **does** understand account types, and none of them is retirement. |
| positive | The sum of the retirement accounts it holds. |

Collapsing `null` into `0` is the `unknown → value` defect this codebase has now fixed five times
(#67, M5.9, M5.12, M5.14, M5.15). *"We never asked"* and *"they have none"* are different answers.
Snapshots are never rewritten (ADR-004/012), so `null` stays true of pre-M5.15 snapshots forever.

The simulator's synthetic rows (`accountId: 'sim'`) carry no `accountType` and are never counted.

### 3.3 A shared label map

`ASSET_CLASS_LABEL` / `assetClassLabel()` in `apps/web/src/lib/intelligence.ts`, following the
`BAND_LABEL[b] ?? fallback` convention already used by What-if. One map, every V2 consumer
surface; unknown keys fall through to the previous behaviour so a class added tomorrow degrades
to readable text instead of disappearing.

- `unclassified` → **"Not yet classified"**
- the eight real classes → their established names

**The bucket keeps its meaning.** This renames nothing in the engine and merges nothing. An
unknown asset class still reads as unknown — because it genuinely is one. "Not yet classified"
says the same thing in a family's language, and implies what it actually is: a gap that can be
closed, rather than a verdict.

### 3.4 Where the retirement fact is stated

**`/household`**, beneath the allocation panel, when the figure is non-null and positive:

> *₹5,00,000 of this is retirement savings. Tell us how it's invested to see your full allocation.*

**`/household/retirement`**, beside the corpus:

> *Of which ₹5,00,000 is held in retirement accounts.*

Both hidden entirely on `null`. Rendering a zero there would state a fact nobody gave us.

## 4. Financial invariants

M5.17 changes **none** of: `assetAllocation` bucketing, membership, `baseValueMinor` or `pct` ·
`investableCorpusMinor` · HHI · `diversificationIndex` · `topConcentration` ·
`concentrationRisk` · any Wealth Health calculation, weight or band · snapshot composition,
checksum or immutability · any kernel contract.

`investableCorpusMinor` **already** included retirement balances before this milestone — it
filters `assetClass !== 'real_estate'`, so the `unclassified` bucket was always in. M5.17 does not
touch it, and must not: the corpus was already right.

No Prisma change, no migration, no kernel change. `FINANCIAL_SNAPSHOT_SCHEMA_VERSION` **1** ·
`FINANCIAL_SNAPSHOT_ENGINE_VERSION` **`m2-6.1.0`** · `FINANCIAL_HEALTH_MODEL_VERSION`
**`fhs-2.0.0`**.

One honest qualification: the **intelligence response** gains an additive optional field. That is
the M5 derived read model, not the frozen snapshot payload — ADR-012 freezes the latter. No
contract test pins the intelligence shape, and the change is additive and non-breaking.

## 5. Tests

**The milestone's whole claim is testable in one assertion**, and
`financialIntelligence.test.ts` case 5 makes it: two payloads with identical assets and an
identical `assetAllocation`, differing **only** in the third account's `accountType`. Every
computed figure must match — allocation JSON, diversification index, concentration triplet,
corpus, required corpus, funding gap, readiness, SIP, and the entire Wealth Health object. Exactly
one thing differs: the new figure.

| Where | Cases |
|---|---|
| `financialIntelligence.test.ts` | 8 — detection, the three states, **reported when the projection cannot be made**, bucket membership, **the pinning test**, corpus unchanged, simulator rows excluded |
| `intelligence.spec.ts` *(new)* | 6 — the label map, including "introduces no asset class of its own" |
| `retirement-capture.e2e-spec.ts` | +3 — end-to-end through snapshot → intelligence → the retirement endpoint; `0` ≠ `null`; and **the figure survives a household with no date of birth** |
| `smoke.spec.ts` | +1 — the browser proof, run **without** a date of birth so it exercises the default state of a new family |

**Proof discipline (rule 9.3 #10).** `packages/core` and `apps/api/dist` were rebuilt before any
result was trusted — including deleting `tsconfig.tsbuildinfo`, which had made `tsc` emit nothing
after `dist` was removed. Against pre-M5.17 code the new behavioural tests failed **13** times
(core 5, web 6, API e2e 2) plus the browser case.

A second round of proof followed the placement correction in §6: the tests covering the no-date-of-
birth case fail against the first cut of this milestone, which is what identified the coupling.

One test had to be repaired before it could be trusted: the browser case's
`expect(getByText(/unclassified/i)).toHaveCount(0)` **passed vacuously** on its first run, because
it executed before the allocation panel had rendered. It now sits behind two positive signals —
the chart being visible, and "Not yet classified" being present — which is rule 9.3 #10's *"order
absence assertions behind a positive signal"*, learned again the hard way.

## 6. Where this figure lives, and why that matters

`retirementAccountsMinor` sits at the **top level** of the intelligence response, not inside the
`retirement` section. That was not the first design, and the correction is the most important
thing in this milestone.

It first shipped inside `retirement.data`. That section is a `Section<T>`, and its gates
(`financialIntelligence.ts`) are:

```ts
if (primaryAge === null)  → unavailable: "No member age available to project retirement."
else if (expense <= 0)    → unavailable: "No expenses recorded to size retirement needs."
```

Both gates answer a different question — *can we project a retirement?* — and neither has anything
to do with how much sits in a retirement account. Measured against the built engine:

| Scenario | `retirement.available` | Figure reachable (before) | The fact itself |
|---|---|---|---|
| No date of birth | `false` | **No** | ₹5,00,000 |
| DOB, no recorded expenses | `false` | **No** | ₹5,00,000 |
| DOB + expenses | `true` | Yes | ₹5,00,000 |

**The first row is the default state of every newly onboarded family**: neither onboarding nor the
Wealth Health Check records a date of birth. So the family the milestone was written for — one who
had just recorded their retirement savings — was the one who could not be shown them.

A `Section` means *"this analysis may be impossible to produce."* Summing snapshot assets by
`accountType` is never impossible. The only unknown this figure has is *"the snapshot predates
account-type capture"*, and `null` already carries it. Wrapping a fact in a section that answers a
different question is a category error, and it coupled a factual aggregation to the retirement
projection engine.

At the top level the figure is populated unconditionally, and `/household`, the retirement page
and the `/households/:id/retirement` overview all read it without an availability check.

## 7. Explicitly out of scope

Account-type correction (`PATCH type`, correction UI, its audit behaviour, the
`type`/`isLiability` guard, historical-correction workflow) — deferred, tentatively M5.18 ·
type-aware retirement corpus weighting · retirement asset-class modelling ·
`liabilities[].accountType` · Tax input capture · `InsurancePolicy` · Estate · Document Vault ·
AI Family CFO · **advisor surfaces**, which still render raw asset-class keys on the balance
sheet and the `/app` concentration tile and are a separately tracked follow-up.
