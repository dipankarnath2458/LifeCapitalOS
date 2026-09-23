# M5.19 — Retirement money is never emergency liquidity

> **Status: implemented.** Every figure below was read or measured from source at `711ce75`
> (`origin/main` after M5.18), not recalled.
>
> **This milestone moves real numbers for affected users**, and that is the point: they were told
> they were covered in a crisis when they were not. §4 states exactly what may move and what may
> not. `FINANCIAL_HEALTH_MODEL_VERSION` **holds at `fhs-2.0.0`** — the model did not change, its
> *input* was wrong. No stored snapshot is rewritten and no past score is recomputed.

---

## 1. The defect

**"Cash a family can reach in a crisis" was defined four separate times, and no copy looked at
`accountType`.**

| # | Site | What it fed |
| --- | --- | --- |
| 1 | `financialIntelligence.ts:400` (`cashMinorOf`) | `emergencyFund.data.cashMinor`; and as `emergencyFundMinor`/`liquidAssetsMinor` into the **early-warning engine** (`:813-814`) |
| 2 | `financialHealth.ts:236` | the **Emergency Liquidity** score dimension — weight **14**, the heaviest single dimension |
| 3 | `financialHealthExplanation.ts:202` | the **gap a family is told to close** to reach a six-month buffer |
| 4 | `common/financial-snapshot.service.ts:105, 113` | the V1 retail `liquid`/`emergencyFund` → the V1 score → the **Wealth Coach's grounding context** |

So a family whose EPF was recorded as `assetClass: 'cash'` was told they held months of emergency
buffer in money locked until 58. Measured on the suite's own fixture: ₹15,00,000 reachable against
₹4,00,000 a month is **3.75 months** — a real weakness — while counting a ₹20,00,000 EPF makes it
8.75 and the shortfall disappears entirely.

Site 3 is the sharpest in product terms, and worse than "understated". A recommendation is only
produced for a **weak** category (score < 75). Counting the locked money pushed Emergency
Liquidity above that line, so the category moved into *strengths* and the family was given **no
advice at all** about a ₹9,00,000 shortfall.

### It was reachable by default, not in theory

`apps/web/src/components/AddAccount.tsx`, live on `/dashboard` (the V1 safety net, retained until
Module 10), offers `type: 'retirement'` in its list *and* defaulted the asset class to `cash`:

```ts
const [assetClass, setAssetClass] = useState('cash');   // :44
const TYPES   = [..., 'retirement', ...];
const CLASSES = ['cash', ...];
```

A user adding their EPF and not touching the dropdown produced the state without choosing
anything. On the household path, `POST`/`PATCH /households/:id/accounts` accept the combination
too — M5.18 withheld `cash` from the *consumer question*, never from the API.

> **Correction to M5.18.** That milestone's note (§7) and the master architecture's `NEXT` both
> said *"No consumer surface can reach that state … but an advisor or a direct API call can."*
> That was wrong, and it understated the priority. The same note also called
> `common/financial-snapshot.service.ts` "the household composer" — it is the **retail** composer.
> Both are corrected here and in the master document.

## 2. The rule

One definition, in `financialSnapshot.ts` beside `investableCorpusMinor`, for the reason that one
gives: more than one caller, and a second copy is how definitions drift apart.

```ts
export const isReachableCash = (a: {
  assetClass?: string | null;
  accountType?: string | null;
}): boolean => a.assetClass === 'cash' && a.accountType !== 'retirement';

export const reachableCashMinor = (p: FinancialSnapshotPayload): number =>
  (p.assets ?? []).filter(isReachableCash).reduce((sum, a) => sum + a.baseBalanceMinor, 0);
```

### Why it reads `accountType`, not `assetClass`

The boundary M5.16–M5.18 drew: **`assetClass` says what the money IS, `accountType` says what
holds it.** Cash inside an EPF is genuinely cash — it is simply not *reachable*, and reachability
is a property of the wrapper. Excluding it by asset class would be a lie about the asset;
excluding it by account type is the truth about access.

This is the same field M5.17 reads to answer the opposite question. Both facts hold at once: the
EPF **is** retirement money (`retirementAccountsMinor` counts it) and **is not** emergency
liquidity. Neither is derivable from `assetClass`, which is why the field exists.

### Absent `accountType` stays reachable, deliberately

A pre-M5.15 payload carries no `accountType` at all and never will — snapshots are immutable. So
`undefined !== 'retirement'` keeps it counted, byte-identical to today. Treating that unknown as
locked would cut every historical family's emergency fund on the strength of a fact nobody
recorded: the `unknown → false` failure this codebase has now fixed five times.

## 3. What was built

1. **The rule**, above, exported from `@lcos/core`.
2. **Sites 1–3 import it.** `cashMinorOf` becomes a one-line delegate; the other two filter with
   the predicate.
3. **Site 4** applies the same predicate to Prisma rows, mapping `Account.type` → `accountType` —
   the same fact under the name the payload gives it. The `|| type === 'bank'` arm at `:105` is
   unchanged and safe: a retirement account is never typed `bank`.
4. **`AddAccount.tsx` stops guessing.** Choosing `retirement` clears the class, and a new
   `"Not sure"` option (value `''`) sends no `assetClass` at all — the same three-state discipline
   the V2 wizard uses since M5.18, and the honest answer to a question the form never asked. A
   `bank` account still defaults to `cash`, because that is a true statement about a savings
   balance.

**No endpoint, no field, no migration, no schema change, no version constant.**

## 4. Financial invariants

**What moves, and only for a household holding a retirement account classed as `cash`:**

| Figure | Direction |
| --- | --- |
| `emergencyFund.data.cashMinor`, `emergencyFundMinor`, `liquidAssetsMinor` | down, to the truth |
| Emergency Liquidity sub-score (weight 14), and the overall score through it | down |
| The liquidity recommendation and its `gapMinor` | appears, or grows |
| The early-warning `emergency_fund` signal | may turn from green |

**What must not move, ever:**

| Invariant | Why it holds |
| --- | --- |
| `FINANCIAL_HEALTH_MODEL_VERSION` = `fhs-2.0.0` | Weights and anchors are untouched. The input was wrong, not the model — your decision, and §5 pins it. |
| Every other score dimension | Only `liquidity` reads this figure |
| Net worth, `assetAllocation`, `investableCorpusMinor` | They read what a family **owns**; reachability is a different question |
| `retirementAccountsMinor` | Reads `accountType` for the opposite purpose, and is unaffected |
| Stored snapshots, checksums, `capturedAt`, `SCHEMA_VERSION` 1 | Nothing is rewritten; the rule is applied at read time |
| A household with no retirement account | Nothing in its payload matches the predicate |
| A pre-M5.15 snapshot | No `accountType`, so it reads exactly as before |

**No past score is recomputed or re-banded.** Stored scores keep the version and value they were
computed under, as they always have.

## 5. Tests

Twelve new core cases (`packages/core/src/finance/reachableCash.test.ts`), seven new e2e cases
(`apps/api/test/retirement-liquidity.e2e-spec.ts`), one new browser journey. No test weakened or
rewritten.

**Every new case was proven to bite.** One perturbation reverts the rule to its pre-M5.19 form,
which reverts all four readers at once, and a second reverts the V1 form:

| Perturbation | What failed |
| --- | --- |
| **A** — `isReachableCash` blind to `accountType` (core) | the rule itself, and **all three core readers**: intelligence, score, explanation |
| **A** — the same build, run through the API | e2e 1 (household emergency fund), 2 (score), **6 (the retail path — the fourth reader)** |
| **B** — `AddAccount` left at its `cash` default | the browser journey (`Expected: "" · Received: "cash"`) |

Under perturbation A the cases that assert *unchanged* behaviour stayed green — absent
`accountType` still reachable, non-cash still excluded, an unclassified retirement account
unaffected, net worth and the allocation unmoved, the stored snapshot untouched. That is the
evidence the change is narrow, from the other side.

Two of the new core cases were **repaired before being trusted**, and both repairs are the
discipline working rather than around it:

- The liquidity assertion first used a fixture at 12.5 months, which is past the top anchor
  (9 months → 100), so both sides scored 100 and the test proved nothing. The fixture now sits at
  3.75 vs 8.75 months, either side of the weak/strong line.
- The explanation assertion looked for `financialImpact` on `categoryBreakdown`, where it does not
  live. Finding the right shape is what surfaced the sharper truth: the gap is attached to a
  *recommendation*, and before the fix there was no recommendation at all.

## 6. Explicitly out of scope

- **Offering `cash` in M5.18's question.** The kernel now makes it safe, but widening that answer
  set is a separate product decision and stays closed. `RetirementAssetClass` is unchanged.
- **`PATCH type` / account-type correction** — still deferred; M5.16 §6.2.
- **Backfilling or re-scoring existing households.** Snapshots are immutable and past scores stand.
- **Advisor surfaces rendering raw asset-class keys** — separately tracked.
- **Any other account type.** Only `retirement` is locked. A vehicle or a property is already
  excluded by asset class, and adding types to this rule without evidence would be the same
  guessing this milestone exists to stop.
