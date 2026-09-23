# M5.18 — A family can say how their retirement savings are invested

> **Status: implemented.** Every figure below was read or measured from source at `fc509d9`
> (`origin/main` after M5.17), not recalled.
>
> **This milestone deliberately moves numbers** — and is the first in the M5.15–M5.18 sequence
> that does. For a family who answers, the asset allocation, HHI, `diversificationIndex`,
> `topConcentration`, `concentrationRisk` and the diversification sub-score all change, because
> an answer is new information and the allocation should reflect it. §4 states exactly what may
> move and what may not; §5 pins both.
>
> **No stored snapshot is rewritten and no score is re-banded retroactively.** History says what
> the family knew then.

---

## 1. The defect

M5.17 ends with a sentence on the consumer dashboard:

> ₹5,00,000 of this is retirement savings. **Tell us how it's invested** to see your full
> allocation.

That was an invitation with nowhere to go. No consumer surface could set an `assetClass` on a
retirement account:

- The Wealth Health Check writes the retirement row with **no** `assetClass` and, on every later
  run, PATCHes only `balanceMinor` (`wealthHealth.ts`, M5.16).
- No other V2 page creates or edits an account at all.

So a family read "tell us", looked for where, and found nothing. The product asked a question it
had not built an answer to — which is worse than not asking, because it reads as our oversight
about their money.

The capability itself already existed: `PATCH /households/:id/accounts/:accountId` has accepted
`assetClass` since long before M5.15 (`household-accounts.dto.ts:75-78`,
`household-accounts.service.ts:107-109`). **The gap was entirely a missing consumer path.** This
milestone therefore adds no endpoint, no field, no migration and no kernel derivation.

## 2. The boundary, restated

> **`accountType`** says what kind of *account* holds the money.
> **`assetClass`** says what economic *asset* the money is.

M5.16 established it, M5.17 made it visible, and M5.18 is the first milestone where a family
supplies the second fact themselves. The two remain independent: answering "debt" does not stop
the account being `retirement`, and `retirementAccountsMinor` — which reads `accountType` — is
unmoved by any answer (§4, case 11).

There is still **no `retirement` asset class**, and there must not be one. The family names a
real economic class; we never invent one on their behalf.

## 3. What was built

### 3.1 Where the question lives — and why not on the dashboard

The invitation is on `/household`. The answer is given in the **Wealth Health Check**, and the
dashboard sentence becomes a link to it.

Two reasons, both structural:

1. **`/household` is read-only by design.** Its own header says so: *"The page is READ ONLY. It
   captures no snapshot and persists no score."* (`app/household/page.tsx:19`). Putting a write
   there would break the property that makes the dashboard safe to render from any snapshot.
2. **A PATCH alone would change nothing visible.** The allocation is derived from the *snapshot*,
   not from live accounts. Classifying an account without capturing a snapshot would leave the
   family looking at the same "Not yet classified" bucket, having just answered the question —
   which reads as the answer being ignored. The Wealth Health Check already captures a snapshot
   at the end of its run, so the answer becomes visible in the same motion.

So the dashboard keeps the invitation and gains a path; the wizard gains the question.

### 3.2 The question

Shown in step 1, directly under "Retirement savings (₹)", and **only when that figure is above
zero** — asking how ₹0 is invested is a question about nothing.

| Option shown | Sent as |
| --- | --- |
| Not sure yet *(default)* | *nothing* |
| Mostly debt (EPF, PPF) | `debt` |
| Mostly equity (NPS equity, ELSS) | `equity` |
| Something else | `other` |

"Not sure yet" is a **real answer and the default**. It sends no `assetClass`, the balance stays
in the honest `unclassified` bucket, and any answer already recorded is left exactly as it was.

### 3.3 Why `cash` is not offered

Found while implementing, not in review, and it changed the design.

Two derivations treat `assetClass === 'cash'` as *"reachable in a crisis"*, and **neither looks at
`accountType`**:

- `cashMinorOf` in `@lcos/core` (`financialIntelligence.ts:399-400`), which feeds
  `emergencyFund.data.cashMinor`, `emergencyFundMinor` and `liquidAssetsMinor`.
- The household composer's own liquidity sum (`financial-snapshot.service.ts:105`, `:113`).

A family who classed their EPF as cash would be told they hold months of emergency buffer in
money they cannot touch until 58 — **told they are covered when they are not**, which is the exact
harm `retirement-capture.e2e-spec.ts` case 4 exists to prevent. Measured: offering the option and
choosing it moves `emergencyFund.data.cashMinor` from ₹2,00,000 to ₹7,00,000 (§5, perturbation C).

That proxy was safe while retirement accounts carried no class at all. M5.18 is the first
milestone that lets a family give one, so **the one value that breaks it is withheld from the
prompt** rather than a frozen derivation being changed under a consumer-surface milestone. A
family whose retirement money genuinely sits idle answers "Something else", which is honest and
inert.

This is a **deliberate deferral, not a fix**. The proper fix — teaching the liquidity derivations
to exclude retirement accounts — is recorded in §7 and in the master architecture's `NEXT`. The
path the family cannot reach today is still reachable by an advisor or a direct API call, exactly
as it was before this milestone; M5.18 neither opens nor closes that, and case 10 is written
against the *consequence* rather than the option list, so it keeps biting however the list is
spelled.

### 3.4 Three states, not two — and silence is not a retraction

`WealthHealthInput.retirementAssetClass` is optional, and `undefined` means **they have not said**.
It is never coerced to a class.

`AssetSpec` gained a second field for this, kept separate from the one the other rows use:

```ts
assetClass?: 'cash' | 'equity' | 'real_estate' | RetirementAssetClass; // what a row is CREATED with
statedAssetClass?: RetirementAssetClass;                               // what the family said THIS run
```

Only `statedAssetClass` is ever sent on an update:

```ts
await apiPatch(`/households/${householdId}/accounts/${current.id}`, {
  balanceMinor: toMinor(asset.amount),
  ...(asset.statedAssetClass !== undefined ? { assetClass: asset.statedAssetClass } : {}),
}, token);
```

Two properties fall out of that, and both are tested:

- **The other three rows PATCH exactly as they always have.** Cash, Investments and Property send
  no `assetClass` on update, so an advisor's correction to a wizard-owned row is not silently
  overwritten on the family's next run.
- **An answer already given survives a run that omits the question.** Omitting the field leaves
  the stored class untouched. This is Gap 7's failure mode — a later submission writing a blank
  over an answer — in a new field, and it is closed the same way.

The control is prefilled from the stored class on load, for the same reason every figure is: an
unanswered control sitting over an answer they already gave invites them to give it again, or to
lose it. A stored class outside the three offered (an advisor set `gold`) prefills as unanswered,
because "they have not answered *this* question" is the honest reading — and a run that does not
touch the control sends nothing, so the advisor's value stands.

## 4. Financial invariants

**What this milestone is allowed to move**, and only for a family who answers:

| Figure | Why it may move |
| --- | --- |
| `assetAllocation` buckets | The answer is the information the bucket was missing |
| HHI, `diversificationIndex`, `topConcentration`, `concentrationRisk` | All derived from the allocation |
| The diversification sub-score, and the overall score through it | Derived from the above |

**What must not move, ever:**

| Invariant | Why it holds |
| --- | --- |
| `investableCorpusMinor` | Filters `assetClass !== 'real_estate'`. `unclassified` was in it; `debt`, `equity` and `other` are in it. Composition unchanged. |
| `emergencyFund.data.cashMinor`, `liquidAssetsMinor` | No offered answer is `cash` (§3.3) |
| `retirementAccountsMinor` | Reads `accountType`, which no answer touches |
| Stored snapshots, checksums, `capturedAt` | Nothing is rewritten; a new snapshot is captured (ADR-004/012) |
| `FINANCIAL_SNAPSHOT_SCHEMA_VERSION` = 1 | The answer is a *value* in an existing field, not a new shape |
| `FINANCIAL_INTELLIGENCE_ENGINE_VERSION` = `m5-fil-1.0.0`, `FINANCIAL_HEALTH_MODEL_VERSION` = `fhs-2.0.0` | No engine or model logic changed |
| No `retirement` asset class exists | The rule M5.16 and M5.17 both rest on |
| Scoring weights | Untouched |

**No score is re-banded retroactively.** A family's past snapshots and past scores are exactly
what they were; only the next capture reflects the answer.

## 5. Tests

Six new e2e cases in `apps/api/test/retirement-capture.e2e-spec.ts` (7, 7b, 8, 9, 10, 11), one new
browser journey in `apps/web/e2e/smoke.spec.ts`, and no test weakened or rewritten.

**Every new case was proven to bite**, by perturbing the behaviour and re-running (16 cases in the
suite throughout):

| Perturbation | Cases that failed |
| --- | --- |
| **A** — pre-M5.18 behaviour: the wizard never sends a class, on create or update | 7, 7b, 9, 11 |
| **B** — unanswered silently becomes `debt` | **8**, plus 1, 2, 3, 6, 4b, 7, 11 |
| **C** — `cash` back on the offered list, and chosen | **10** (`cashMinor` ₹2,00,000 → ₹7,00,000) |

Perturbation A leaves cases 1–6 green, which is the evidence that M5.18 breaks nothing M5.16 and
M5.17 established. Perturbation B failing the M5.16 three-state cases is the same evidence from
the other side: a silent default is the failure those cases were written against.

The browser journey asserts the whole path a person walks — unanswered run → dashboard says "Not
yet classified" → the invitation is a link → the link lands on the wizard with figures prefilled
and the question still unanswered → answer "debt" → dashboard shows Debt, the unknown state is
gone, `retirement-in-allocation` still names ₹5,00,000 → re-opening the wizard shows `debt`.
Its absence assertions are ordered behind two positive signals and the "Debt" match is scoped to
the allocation panel, because "Debt" also names the loans section (rule 9.3 #10).

## 6. Explicitly out of scope

Unchanged from the approved Option C non-goals:

- `PATCH type` / account-type correction (still deferred; M5.16 §6.2)
- Any type or `isLiability` guard
- Account-management UI
- Splitting one account across several classes (a 60/40 NPS is one class today)
- Tax, advisor surfaces
- A `retirement` asset class — permanently out of scope, not deferred

## 7. Follow-up this milestone creates

**Teach the liquidity derivations to exclude retirement accounts.** `cashMinorOf`
(`financialIntelligence.ts:399`) and the composer's liquidity sum
(`financial-snapshot.service.ts:105`, `:113`) read `assetClass === 'cash'` with no regard for
`accountType`. Today no household can reach that state through a consumer surface — M5.18 makes
sure of it — but an advisor or a direct API call can, and the answer a family would be given is
wrong in the dangerous direction. It is a kernel change with, as far as can be measured today,
**zero** effect on any existing household, which makes it cheap to do properly and worth doing
before any surface widens the offered classes. Recorded in the master architecture's `NEXT`.
