# Gap 6 — account `type` in the Financial Snapshot (Option H)

> **Architecture review**, written before implementation and read from source at `d652c64`
> (`origin/main` after M5.14), not recalled.
>
> **Outcome: approved and implemented as M5.15.** ADR-014 was **accepted** and is now in the
> register in [`M2_HOUSEHOLD_WEALTH_ARCHITECTURE.md`](./M2_HOUSEHOLD_WEALTH_ARCHITECTURE.md); the
> §11 copy below is kept as the draft that was reviewed. The field shipped as **`accountType`**.
> The type-aware retirement corpus was deliberately **not** implemented — see §9.

**Headline: the audit's own risk rating for this item is wrong, and I wrote it.**
`V2_MASTER_ARCHITECTURE_AND_HISTORY.md:648` says closing Gap 6 "means a `schemaVersion` change —
the first real pressure on the frozen contract", and rates technical risk **High**. Both the
governing ADR and the contract spec say the opposite: an optional additive field keeps
`schemaVersion` at **1**, and there is a shipped precedent. The correction is in §4.

The real constraint is not the contract. It is that **nothing can capture the data a consumer
would want**, and that **capture is retroactively impossible**. That reshapes the recommendation.

---

## 1. What account-type information exists today

| Fact | Evidence |
|---|---|
| `Account.type` is a **non-nullable** `AccountType` | `schema.prisma:221` |
| It has been `NOT NULL` since the **first** migration | `20260531150620_init/migration.sql:82` |
| `AccountType` has **9** values, including a dedicated **`retirement`** | `schema.prisma:29-39` |
| `Account.assetClass` is **nullable**, 8 values, **no retirement concept** | `schema.prisma:222`, `:41-50` |
| The API accepts `retirement` on create | `household-accounts.dto.ts:4-8` |
| `accounts.list()` **already returns `type`** | `household-accounts.service.ts:17` |

So the two fields answer different questions. `assetClass` says *what kind of asset this is*
(equity, debt, gold). `type` says *what kind of account holds it* (bank, investment, retirement,
real_estate). A PPF or EPF balance is `type: 'retirement'`, `assetClass: 'debt'` — **identical in
the snapshot to a taxable debt fund.**

**But almost nobody has one.** The consumer Wealth Health Check writes exactly three types —
`bank`, `investment`, `real_estate` (`wealthHealth.ts:232-234`). No V2 consumer surface can create
a `retirement` account. The value is reachable only through the API or the advisor workspace.

## 2. Why the snapshot cannot represent it

Not a data problem. A **projection** problem, in one `.map()`:

```ts
// household-financial-snapshot.service.ts:43-51 — `type` is simply not declared
interface AccountRow { id; name; assetClass; entityId; currency; balanceMinor; isLiability }

// :104-113 — and so it is never copied into the payload
const assets = accountRows.filter(a => !a.isLiability).map(a => ({
  accountId: a.id, name: a.name, assetClass: a.assetClass, entityId: a.entityId,
  nativeCurrency: a.currency, nativeBalanceMinor: a.balanceMinor, baseBalanceMinor: toBase(...),
}));
```

`this.accounts.list(householdId)` is cast to `AccountRow[]`, and `serialize` returns `type`
(`household-accounts.service.ts:17`). **The field is in memory at capture and discarded.** Closing
Gap 6 on the producer side is one interface field and one object property.

## 3. Which capabilities genuinely require it

Ranked by how much of the need is real *today* versus anticipated.

### Real, demonstrable today

**The simulator cannot tell retirement saving from ordinary investing.** `increase_sip` and
`retirement_contribution` are **byte-identical transforms** (`financialSimulation.ts:253-266`) —
both reduce expense and add to an asset class. Two named scenarios that do the same thing, because
the payload has no dimension on which they could differ. That is a capability gap caused directly
by Gap 6, visible in shipped code.

**The retirement corpus is a class-based approximation.** M5.14's `investableCorpusMinor` can only
exclude `real_estate`. It cannot *include preferentially* what is actually earmarked for
retirement, and it counts a taxable equity fund exactly like an NPS balance. It is the best
definition available without `type`, and it is documented as a selection rather than a truth.

### Anticipated, not yet real

- **Tax.** Indian tax treatment is driven by *account type* (PPF/EPF/NPS/ELSS/80C), not by asset
  class. No amount of `assetClass` reasoning can recover it.
- **Estate.** Nomination and succession rules attach to account type.
- **Emergency liquidity.** Currently `assetClass === 'cash'` (`financialIntelligence.ts:378`),
  which is a reasonable proxy; `type` would sharpen it (retirement money is not liquid) but this
  is refinement, not capability.

### Not a reason

Net worth, debt, cashflow, budget, diversification and every scored category work correctly today
without `type`. **None of them is blocked.**

## 4. Does this violate or extend the frozen kernel contract?

**It extends it, by the mechanism the contract itself prescribes.** The audit's "first real
pressure on the frozen contract" framing does not survive contact with the governing documents.

> **ADR-012:** "The payload shape is a **contract** governed by `schemaVersion` (**additive-only**;
> old snapshots never rewritten)."

> **Snapshot contract §8:** "**Migration strategy: additive only** — new payload fields may be
> added under the **same** version if strictly optional; a **breaking** change (rename/remove/retype
> a field) bumps `schemaVersion` to *N+1*."

> **`members`, the shipped precedent** (contract §3, line 136): "Being an *optional additive* field,
> it keeps `schemaVersion` at 1 (governance G-3)."

An optional `type?` on `assets[]` elements renames nothing, removes nothing, retypes nothing.
**`schemaVersion` stays 1. No version bump. No up-converter needed** (the registry stub at
`financialSnapshot.ts:175` remains identity).

### One caveat the guardrail will not catch

`kernelContract.test.ts` pins sub-field keys for `netWorth`, `debt`, `cashflowSummary` and
`householdEquity` — **but not for `assets[]` elements**. So adding `type?` would pass the contract
test *silently*. That is a weakness in the guardrail, not a licence: the change must be deliberate,
and the test should be extended to pin the `assets[]` element shape in the same commit. Otherwise
the next field lands unnoticed.

**Verdict: extends. Not a violation.** The "frozen kernel" rule means never redesign it, never
bypass it, never re-aggregate outside it, never rewrite stored snapshots — not "never add an
optional field", which the contract explicitly provides for.

## 5. Does it require a schema migration?

**No. None.**

`Account.type` is non-nullable and has been populated on every row since `init`. The payload is a
JSON column, so adding a key changes no DDL. `members` was added the same way, with no migration.

This is the single largest correction to the audit's assessment: it rated migration "No (payload
only)" but paired that with **High** risk. The payload-only nature *is* the low-risk property.

## 6. Impact on immutable snapshots and historical data

Governed by ADR-004 and ADR-012: **old snapshots are never rewritten.** Consequences:

- Every snapshot captured before the change keeps `assets[].type === undefined`, permanently.
- **`undefined` means "captured before types were recorded" — it does not mean `other_asset`.**
  A consumer writing `a.type ?? 'other_asset'` would commit exactly the `unknown → false` defect
  this codebase has fixed four times (#67, M5.9, M5.12, M5.14). This is the single most likely way
  to get Gap 6 wrong.
- **Checksums are unaffected.** `checksumOf` runs once at capture
  (`household-financial-snapshot.service.ts:303`) and is stored; nothing recomputes a stored
  snapshot's checksum. Old rows stay valid for their own payloads.
- **Backfill is not an option and should not be attempted.** Re-deriving a past snapshot's account
  types from today's `Account` rows would produce a hybrid that is neither the past nor the
  present, and would violate immutability.

### The decisive asymmetry

**Capture cannot be applied retroactively.** Every snapshot taken between now and whenever this
ships is permanently typeless. The cost of waiting is not zero and it does not decay — it
accumulates, silently, in exactly the historical series that Tax and Estate will later want.

This is the strongest argument for acting sooner than the immediate product value justifies, and
it is the argument the original "defer until Tax or Estate makes the need concrete" position
missed.

## 7. Impact on Net Worth, Health Score, What-if and downstream

**Zero, if the field is added and not read.** Every current consumer of `payload.assets` was
enumerated:

| Consumer | Reads | Affected? |
|---|---|---|
| `financialIntelligence.ts:378` — cash for emergency fund | `assetClass` | No |
| `financialIntelligence.ts:423` — completeness | `assets.length` | No |
| `financialHealthExplanation.ts:319` | `assets.length` | No |
| `financialSimulation.ts:121,127,148,159,173` | `assetClass`, `baseBalanceMinor` | No |
| `household-financial-snapshot.service.ts:144` — currency exposure | `nativeCurrency` | No |

Net Worth, the Wealth Health Score (`fhs-2.0.0`) and What-if all compute from `assetClass` and
balances. **No score moves. No `fhs` bump. No figure a family currently sees changes.**

### One real hazard, for whoever builds the first consumer

`financialSimulation.addToClass` **pushes synthetic asset rows** (`accountId: 'sim'`,
`financialSimulation.ts:128-136`). Those rows have no real account behind them and therefore no
honest `type`. A future type-aware consumer must treat a synthetic row's absent type as unknown —
not as a default — or What-if will silently mis-categorise simulated money. `normalize()`
re-derives `assetAllocation` from `p.assets`; any future type-derived aggregate needs the same
treatment there or the virtual payload and the baseline will disagree.

## 8. Backward-compatibility strategy

1. **Optional, never required.** `type?: string` on `assets[]`. `schemaVersion` stays 1.
2. **Three states, not two** — the M5.14 lesson applies directly: *stated* (the account has a
   type), *absent* (this snapshot predates capture). Never a default.
3. **Consumers degrade explicitly.** Any figure derived from `type` reports itself unavailable with
   a reason (`Section<T>`), or falls back to the documented `assetClass` proxy **and says which** —
   the provenance vocabulary M5.14 introduced (`stated | derived | default`) is exactly the right
   instrument.
4. **Extend `kernelContract.test.ts`** to pin the `assets[]` element shape, including `type` in the
   optional set, so the next addition is not silent (§4 caveat).
5. **No backfill, no up-converter.** Neither is needed for an additive field, and backfilling
   would violate ADR-004.

## 9. Should this be M5.15, or a separate architecture milestone?

**Neither, exactly — and this is the part I would push back on.**

The producer-side change is genuinely small: one interface field, one object property, one
contract-test extension. Calling it a milestone overstates it. But shipping it *alone* means
adding a field **no consumer reads**, which is precisely the "capability without a consumer path"
defect this project has hit repeatedly — Gap 5 (two engines, no surface), Gap 2 (data the score
ignored), M5.9 (a store nothing read). I would rather not add a fourth instance deliberately.

Against that sits §6's asymmetry: **waiting costs history that cannot be recovered.**

The resolution is to split on that seam:

- **Now, small (call it M5.15):** capture `type` in the payload. Optional, inert, no consumers, no
  score change, plus the contract-test extension and a tripwire test asserting that a snapshot
  without `type` is still valid. Justified by irreversibility, not by immediate value — and the
  design note must say so plainly, or a future reader will mistake it for dead code.
- **Later, and separately:** a **consumer-capture** milestone that lets a family actually record a
  retirement account (the wizard writes three types today), followed by whichever consumer the
  product then wants — a type-aware corpus, or Tax. That milestone carries the product decisions;
  this one does not.

**Do not fold the retirement-corpus change into the payload milestone.** No consumer household has
a `retirement`-typed account today, so a type-aware corpus would be a no-op for every real family
while changing a figure M5.14 *just* changed. Two shipped-number changes to the same figure in
consecutive milestones is how a family stops trusting the number.

## 10. Alternatives considered

**A. Keep account type outside the kernel, as a module-owned assumption.** Protection, retirement
and goals all reach the layer through `IntelligenceAssumptions` without touching the snapshot, so
the pattern exists. **Rejected.** Those are *family-stated planning inputs*; `Account.type` is a
property of a kernel entity. Reading it live would mean a consumer querying `Account` outside the
snapshot, which ADR-012 forbids ("Consumers read snapshots, never raw tables"), and it would break
reproducibility: a snapshot frozen six months ago combined with today's account types is a hybrid
that is neither. The snapshot's whole purpose is that it can be re-read years later and mean the
same thing.

**B. Bump `schemaVersion` to 2.** **Rejected.** The contract reserves a bump for
rename/remove/retype. Using one for an additive field would spend the mechanism on a
non-breaking change, force consumers to branch for no reason, and set a precedent that every
addition is breaking.

**C. Extend `AssetClass` with retirement-ish values.** **Rejected.** It conflates two orthogonal
dimensions — an NPS account holds equity *and* debt. It would also retype an existing field's
domain, which *is* a breaking change under §8, and would corrupt diversification scoring, which
reads `assetClass` as a risk dimension.

**D. Do nothing until Tax or Estate.** The audit's original position. **Rejected on new evidence:**
§6's asymmetry was not considered when that call was made. Waiting is not free — it silently
forfeits history — and the change turns out to be far cheaper than the deferral assumed.

**E. Add the field *and* build the type-aware corpus together.** **Rejected for now** — see §9.
No real household would benefit, and it would move the same figure twice in two milestones.

## 11. Draft ADR-014 — as reviewed

> **Accepted.** The authoritative text now lives in the ADR register in
> `M2_HOUSEHOLD_WEALTH_ARCHITECTURE.md`, where it names the field `accountType` and records the
> guardrail extension. This copy is retained as the version that was put up for approval.

### ADR-014 — Account `type` is carried in the snapshot as an optional additive field

- **Status:** **Accepted** (register copy is authoritative)
- **Context:** `Account.type` (9 values, including a dedicated `retirement`) has been non-nullable
  since `init` and is loaded at capture, but the `schemaVersion 1` payload projects only
  `assetClass`. Money earmarked for retirement is therefore invisible to every consumer: the
  retirement corpus is a class-based approximation, and the What-if scenarios
  `increase_sip` and `retirement_contribution` are byte-identical because the payload offers no
  dimension on which they could differ. Tax and Estate are driven by account type and cannot be
  derived from asset class at all. Snapshots are immutable and never rewritten, so any period
  without capture is permanently typeless.
- **Decision:** Carry `type` on `assets[]` as a **strictly optional** field, keeping
  `schemaVersion` at **1** per ADR-012 and contract §8, following the `members` precedent. Absent
  means "captured before types were recorded" and must never be defaulted. No migration, no
  backfill, no up-converter, no consumer in the same change. `kernelContract.test.ts` is extended
  to pin the `assets[]` element shape so future additions cannot land silently.
- **Consequences:** Historical series begin accruing account type immediately. No stored snapshot
  changes; no checksum is invalidated; no current consumer is affected and no figure a family sees
  moves. The field is unread on arrival — deliberately — and a design note must record why, so it
  is not mistaken for dead code. A future type-aware consumer must handle both absent types and
  the simulator's synthetic rows.
- **Alternatives considered:** Module-owned assumption outside the kernel (rejected — breaks
  ADR-012 and snapshot reproducibility); `schemaVersion` bump (rejected — reserved for breaking
  changes); extending `AssetClass` (rejected — conflates orthogonal dimensions and retypes an
  existing domain); defer until Tax/Estate (rejected — silently forfeits unrecoverable history);
  ship with a type-aware corpus (rejected — no real household benefits today, and it would move
  the retirement figure twice in consecutive milestones).

## 12. Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A consumer defaults absent `type` to a real value | **Medium** | **High** — the `unknown → false` defect, fifth instance | §8.2/§8.3; make it a tripwire test now, before any consumer exists |
| The contract test does not catch the addition | **Certain** | Medium | Extend it to pin `assets[]` elements in the same commit (§4) |
| Synthetic What-if rows mis-typed by a future consumer | Medium | Medium | Documented in §7; the first type-aware consumer must handle it |
| Field ships and is never read | **Medium** | Low-Medium | Accepted deliberately (§9); design note must state the reason |
| Payload size growth | Low | Negligible | One short string per asset row |
| Schema/migration risk | **None** | — | No DDL; column already exists and is populated |
| Breaking a stored snapshot | **None** | — | Additive; old rows untouched; checksums computed at capture only |

**Overall: LOW.** The audit's **High** rating was based on an incorrect premise (that a
`schemaVersion` bump was required). The genuine risks are all on the *consumer* side and all lie in
the future.

## 13. Recommendation

1. **Approve the payload change** as a small, self-contained piece of work — optional `type` on
   `assets[]`, `schemaVersion` unchanged, no consumers, plus the contract-test extension and a
   tripwire asserting a typeless snapshot stays valid. Justified by irreversibility.
2. **Do not build a type-aware retirement corpus in the same change**, and do not move the
   retirement figure again so soon after M5.14.
3. **Treat consumer capture of retirement accounts as the separate, real milestone** — it carries
   the product decisions and is what actually unlocks the value.
4. **Correct the audit** (`V2_MASTER_ARCHITECTURE_AND_HISTORY.md:643-649` and the option-H row):
   the risk is Low, not High, and no `schemaVersion` change is required. I wrote that assessment;
   it was wrong.

**Approved.** Implemented as M5.15: `accountType` optional on `assets[]`, `schemaVersion`
unchanged, no migration, no consumer, contract test extended to pin the element shape. Item 4 —
correcting the audit's Gap 6 entry and option-H risk rating — is **not** done here, to keep this
PR to the approved scope; it is flagged as outstanding.
