# M5.16 — A family can record retirement savings (Gap 6, consumer capture)

> **Status: designed and approved. Not yet implemented.** Every figure below was read or
> computed from source at `9367a0e` (`origin/main` after M5.15 and the Gap 6 audit correction),
> not recalled.
>
> Mandated by [`architecture/GAP_6_ACCOUNT_TYPE_REVIEW.md`](./architecture/GAP_6_ACCOUNT_TYPE_REVIEW.md)
> §9, which split Gap 6 on a seam: M5.15 captured `accountType` in the payload; *"later, and
> separately: a **consumer-capture** milestone that lets a family actually record a retirement
> account."* This is that milestone.
>
> **This milestone changes no shipped number for any existing family.** A family who records
> nothing new sees exactly what they saw before. See §5.

---

## 1. The state M5.15 left behind

M5.15 made the snapshot able to carry `assets[].accountType`. It did not make that field
possible to populate. Verified from source, not from the roadmap:

| Fact | Evidence |
|---|---|
| `AccountType` has 9 values including `retirement` | `schema.prisma:29-39` |
| The API accepts all 9 on create | `household-accounts.dto.ts:4-13` |
| The composer copies `accountType: a.type` into the payload | `household-financial-snapshot.service.ts:119` |
| The consumer Wealth Health Check writes exactly **3** types | `apps/web/src/lib/wealthHealth.ts:232-234`, union pinned at `:70` |
| No other V2 web surface creates a household account | the only writer of `/households/:id/accounts` in `apps/web` is `wealthHealth.ts:259` |
| **The advisor workspace cannot create one either** | `app/households/[id]/balance-sheet/page.tsx` has one `apiPost`, to `net-worth/snapshot` (`:129`) |
| **V1 *can*** — it offers all 9 types | `components/AddAccount.tsx:8-17`, POSTing to retail `/accounts` (`:43`) |

That last pair is the shape this codebase keeps producing: **V1 ahead of V2**. It is the same
asymmetry as Gap 1 (goal slippage), M5.8 (Family) and M5.9 (Protection). A V1 user at
`/dashboard` can file a PPF as a retirement account today; a V2 household cannot, from anywhere.

## 2. The defect nobody had written down: our own copy mis-files retirement money

`apps/web/src/app/wealth-health/page.tsx:277` currently reads:

> **Investments (₹)** — *"Mutual funds, stocks, EPF, PPF."*

**We instruct families to file EPF and PPF as `type: 'investment'`, `assetClass: 'equity'`.**
Every household that followed that hint has retirement money recorded as ordinary investing —
by our instruction, not by their error.

So M5.16 is not only additive capture. It is a correction of guidance that has been wrong since
M5.5, and the hint must change in the same milestone that offers somewhere better to put the
figure. Offering the new field while still telling families to put PPF under Investments would
invite double entry.

**No backfill, and no inference.** We cannot know how much of an existing Investments figure is
retirement money, and splitting it on a guess would assert a fact about a family that nobody
recorded — the `unknown → value` failure this codebase has fixed four times (#67, M5.9, M5.12,
M5.14). Existing accounts and every stored snapshot are left exactly as they are. A family who
wants their filing corrected does it themselves, in the form, by moving the figure. §5 shows what
that costs them: nothing.

## 3. Why `assetClass` is omitted

Three options were considered and two were ruled out by product decision: no new `retirement`
asset class (retirement is a *kind of account*, not a *kind of asset*), and no arbitrary mapping
to cash, equity, debt or `other_asset`.

What remains is not a workaround. **A null `assetClass` is already a first-class state in the
kernel**, and has been since M2-6:

```ts
// household-financial-snapshot.service.ts:141
const key = a.assetClass ?? 'unclassified';
```

`Account.assetClass` is nullable (`schema.prisma:222`) and the create DTO already treats it as
optional. So a retirement account with no asset class is an ordinary shape the kernel understands,
not a new one this milestone introduces.

The retirement row therefore carries **no `assetClass` key at all**. It must be *omitted* rather
than sent as `null`: the DTO validates with `@IsEnum(ASSET_CLASSES)`, which rejects an explicit
null.

## 4. What a null class does downstream — every consumer traced

| Consumer | Behaviour | Correct? |
|---|---|---|
| Net worth totals | Counted — the computation is class-independent | ✅ the money is real |
| `isLiquidAssetClass(null)` → `false` (`networth.ts:59`) | Not liquid | ✅ |
| Emergency Liquidity — filters `assetClass === 'cash'` (`financialHealth.ts:236`) | **Excluded** | ✅ retirement money is not an emergency fund |
| `investableCorpusMinor` — filters `!== 'real_estate'` (`financialSnapshot.ts:167-170`) | **Included** | ✅ it is exactly what a family retires on |
| `asAssetClass('unclassified')` → `'other'` (`financialIntelligence.ts:348`) | Folded into `other` for drift/suggestions | ✅ no crash, no new code path |
| Diversification — HHI over allocation buckets (`financialHealth.ts:239-240`) | Counts as its own bucket | measured below |

Two of these are worth stating as guarantees rather than observations, because they are the whole
point of the milestone: **retirement savings are excluded from Emergency Liquidity and included in
the investable corpus**, and both fall out of existing logic with no new branch on `accountType`.

One asymmetry to record for whoever builds the first type-aware consumer: diversification treats
`unclassified` as its own bucket, while the allocation drift analysis folds it into `other`. Both
are pre-existing behaviours for any unclassified account. Neither is introduced here.

### Diversification was the one place distortion could hide

Measured by running `computeFinancialHealthScore` from the built `@lcos/core` — the real scorer,
not a re-derivation of its formula. A family holding ₹2L cash, ₹3L equity and ₹50L property who
records ₹5L of retirement savings:

| `assetClass` used | Diversification index | Sub-score | **Overall score** |
|---|---|---|---|
| *(nothing recorded)* | 0.17 | 20 | **83** |
| **omitted → `unclassified`** | 0.30 | 35 | **84** |
| `debt` | 0.30 | 35 | **84** |
| `equity` (merged into the existing bucket) | 0.29 | 34 | **84** |

**Omitting distorts nothing.** It produces a figure identical to `debt` and one sub-score point
from `equity`, and the overall score is **84 whichever is chosen**. The movement from 83 to 84
comes from recording ₹5L outside the dominant class — which is true — not from the bucket being
unnamed. Every honest choice moves this figure by the same amount, because the family genuinely
has more money outside real estate than we previously knew.

## 5. What this costs an existing family: nothing

The family most affected is the one who followed the old hint and has EPF inside Investments. When
they re-file ₹5L out of Investments into Retirement savings — the `equity` and `unclassified` rows
of the table above, which are exactly the before and after of that correction:

```
net worth                 delta = 0   (same total assets)
investable corpus         delta = 0   (neither class is real_estate)
diversification sub-score delta = +1  (34 → 35)
OVERALL WEALTH HEALTH     delta = 0   (84 → 84)
```

**Not one figure a family sees moves when they correct their own filing.** That matters
because Gap 6 §9 warned explicitly against the alternative: *"Two shipped-number changes to the
same figure in consecutive milestones is how a family stops trusting the number."* M5.14 changed
the corpus definition. M5.16 does not change it again — it lets families record money the
definition already knew how to handle.

A family who records retirement savings they had never entered anywhere will see their net worth
rise. That is new information, not a re-scoring: no stored score is re-banded, and
`FINANCIAL_HEALTH_MODEL_VERSION` stays `fhs-2.0.0`.

## 6. Account-type correction is deferred to M5.17 (Option B)

`UpdateHouseholdAccountDto` carries no `type` field, so **an account's type is immutable after
creation**. That is a genuine correctness hole: a mis-typed account can never be corrected, by
anyone.

It is not closed here. The wizard never needs it — it creates each row with the right type, and a
family correcting their filing moves money between fields rather than re-typing an account. So
shipping `PATCH type` in M5.16 would add an API capability with **no V2 consumer path**, which is
rule 9.3 #8 and precisely the defect class that produced Gaps 2 and 5 and M5.9.

**M5.16 stays strictly consumer-first.** The correction capability, and the surface that makes it
reachable, are M5.17.

## 7. What gets built

**Web — the capture path**

- `apps/web/src/lib/wealthHealth.ts`
  - `AssetSpec.type` gains `'retirement'`; `assetClass` becomes optional on the spec, so the
    compiler enforces that the retirement row carries none
  - `OWNED.retirement = 'Retirement savings'` — the name key that makes the row idempotent
  - `WealthHealthInput` gains `retirement`
  - the `assets` array gains the retirement spec, **appended after property** so the call order of
    existing rows is unchanged
  - the create call omits `assetClass` when the spec has none
  - `loadCurrentFigures` reads the new row back
- `apps/web/src/app/wealth-health/page.tsx`
  - one `LabeledInput` in step 1, after Investments:
    **"Retirement savings (₹)"** — *"EPF, PPF, NPS — money set aside for retirement."*
  - the Investments hint drops EPF and PPF
  - state, prefill and submit extended by one field

No new step, no new screen, no navigation change. The `hydrating` guard and the Gap 7
`HouseholdUnavailable` path apply unchanged.

**API** — nothing. `POST /households/:id/accounts` already accepts `type: 'retirement'` with no
`assetClass`, and `compose()` already copies the type into the payload.

**Kernel** — nothing. No payload key, no `schemaVersion` decision, no `kernelContract.test.ts`
change, no migration, no up-converter, no `@lcos/core` change.

## 8. Idempotency and blank-field semantics

The new row joins the existing name-keyed machinery, so every invariant already proven applies to
it unchanged:

- update in place, never append;
- a cleared field means *"I have none of this"* — the balance is zeroed and the row, its history
  and anything referencing it survive (`wealthHealth.ts:245-252`);
- zero on a first run creates nothing — *"an account is not created just to hold zero"* (`:256`);
- the transaction anchor still prefers the cash account (`:272`), which tests
  `assetClass === 'cash'` and is therefore unaffected by a row that has none.

**The highest-risk line in the milestone is the read-back.** If `loadCurrentFigures` does not
return the new figure, the form shows a blank where real money is, and the next submission writes
that blank over it. That is the exact Gap 7 failure mode, and it has already reached production
once in a different form. It is covered by a dedicated test rather than by inspection.

The API e2e mirror of the wizard sequence (`wealth-check-idempotency.e2e-spec.ts:61` onward) is
deliberately kept in step with `wealthHealth.ts` — its own comment says a divergence would make
the tests assert something the product does not do. Both change together, in the same commit.

## 9. Snapshot and immutability semantics

- Capture is unchanged: `compose()` copies `accountType: a.type` (`:119`), from M5.15.
- Snapshots are **never** rewritten, recomputed or re-checksummed. No code path runs from an
  account write to a stored snapshot.
- A snapshot reports the `accountType` that was true at *its* capture time. Snapshots taken before
  M5.16 carry no `accountType` at all and never will; snapshots taken after a family records
  retirement savings carry `retirement` from that capture onward.
- Absent stays absent — never `false`, never `''`, never `other_asset`, and not even present as an
  explicit `undefined`, which would change the payload's canonical bytes and therefore its
  checksum.

## 10. Tests

**Extended**

| Spec | What changes |
|---|---|
| `wealth-check-idempotency.e2e-spec.ts` | `OWNED`, `Figures`, `runCheck`; cases 2 (prefill), 3 (twice changes nothing), 4 (one value), 5 (clearing zeroes), 7 (snapshots immutable), 15 (no duplication) all gain the retirement row |
| `wealth-health-check.e2e-spec.ts` | the pipeline scores the new figure |
| `apps/web/e2e/smoke.spec.ts` | the `wealth health check` group, and *"re-running the check updates the figures instead of doubling them"* |

**New — `apps/api/test/retirement-capture.e2e-spec.ts`**

1. A consumer records retirement savings → the account persists with `type: 'retirement'`.
2. The next snapshot carries `accountType: 'retirement'` — the **first end-to-end exercise of
   M5.15's field with consumer-created data**.
3. `assetClass` is absent and the balance lands in the `unclassified` allocation bucket — never
   defaulted to a class.
4. Emergency Liquidity excludes it; the investable corpus includes it.
5. Recording retirement savings leaves every previously stored snapshot byte-identical, checksums
   included.
6. A blank retirement field zeroes the balance and keeps the row; zero on a first run creates no
   account at all.

**Proof discipline (rule 9.3 #10).** Every new test is verified to fail against pre-change
behaviour, with `packages/core` and `apps/api/dist` rebuilt first. Stale `dist` has produced two
false greens in this project; a test that has not been shown to bite is not evidence.

## 11. Acceptance criteria

1. A consumer records retirement savings; the account persists as `type: 'retirement'` with no
   `assetClass`.
2. The next captured snapshot carries `accountType: 'retirement'`.
3. Re-running the check updates rather than appends, and the figure prefills.
4. A blank field zeroes the balance and keeps the row; zero on a first run creates nothing.
5. Every previously stored snapshot stays byte-identical, checksums included.
6. `FINANCIAL_SNAPSHOT_SCHEMA_VERSION` = 1 and `FINANCIAL_HEALTH_MODEL_VERSION` = `fhs-2.0.0`,
   both pinned by existing tests and unchanged.
7. Retirement savings are excluded from Emergency Liquidity and included in the investable corpus.
8. No type-aware corpus, and no allocation or scoring logic keyed on `accountType`.
9. No schema change, no migration, no kernel contract change, no `PATCH type`.
10. Full CI green: `build · lint · core · web · api unit · migrate deploy · seed · api e2e ·
    playwright`.

## 12. Risks

| Risk | Severity | Handling |
|---|---|---|
| Read-back omitted → blank form written over real figures | 🔴 | Dedicated test; it is the Gap 7 failure mode and has reached production once |
| The web lib and its API e2e mirror drift | 🟡 | Both changed in one commit; the mirror's own comment states the rule |
| Families double-enter EPF under both fields | 🟡 | The Investments hint drops EPF/PPF in the same change |
| One more account row per run adds a call against `120/60s` | 🟡 | Count the calls; Gap 7 says do not assume |
| Absent type silently defaulted by a future consumer | 🟢 | Nothing reads `accountType` yet; the guarantee is pinned by `kernelContract.test.ts` and `snapshot-account-type.e2e-spec.ts` from M5.15 |
| Kernel or contract risk | 🟢 | None — no payload change |
