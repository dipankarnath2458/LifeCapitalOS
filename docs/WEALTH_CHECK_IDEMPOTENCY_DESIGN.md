# Wealth Health Check — re-running corrupted a family's figures

> **Status: RESOLVED.**
> **Prevention shipped in PR #61** (merged, `main` green) — the check now updates the records it
> owns instead of appending, and the form prefills so a blank field means "I have none" rather
> than "nothing to add".
> **Historical repair: CLOSED, none required.** The production count returned
> `affected_households = 0` of 2 active households — see §5.
> **Origin:** Issue 2 from the AI Coach review — a savings rate of 96%.
> **Scope:** the Wealth Health Check write path. Not M5.8, not the AI surfaces.

---

## 1. What happens

The wizard **appends** on every run. It never updates or replaces what it wrote before.

Reproduced against a running API:

```
A family enters the same figures twice — say they revisit "Update my figures":

after 1st run    assets ₹15,00,000   income ₹3,00,000   expense   ₹75,000   savings 75.0%
after 2nd run    assets ₹30,00,000   income ₹6,00,000   expense ₹1,50,000   savings 75.0%
```

**Their assets doubled. Their income doubled.** Nothing warned them, and the dashboard showed the
inflated figures with full confidence.

The savings *ratio* survives only while both sides are re-entered. Leave one blank and it skews,
because the wizard skips any field ≤ 0 (`wealthHealth.ts`) — so that side stops accumulating while
the other keeps going:

```
run 1: income ₹3,00,000 + expense ₹75,000
run 2: income ₹15,75,000, expenses left blank
→ income ₹18,75,000, expense ₹75,000, savings 96.0%
```

This reproduces the observed rate **exactly** — which is what first suggested accumulation as the
cause. It was not: the production count later showed no household had duplicated cashflow at all,
so the same figures had been entered once rather than accumulated (§5.1). The defect above is real
and was reproduced against a live API; it simply was not what produced that particular 96%.

## 2. Why it happens

Two facts combine, and neither is wrong on its own:

1. **The wizard writes with `POST` only** — `POST /households/:id/accounts`, `/debts`, `/cashflow`.
   Every call creates a new row. There is no lookup of what already exists.
2. **The form has no prefill.** Every field is `useState('')` and the mount effect only fetches the
   access token. So "Update my figures" (`household/page.tsx:123`) opens a **blank form**.

A blank form is what makes the skew likely rather than rare. A user who wants to correct one number
types that one number and submits — and the product reads the empty fields as "nothing to add here"
while adding the one they typed on top of everything already stored.

The word "Update" on that button describes an intention the write path does not implement.

## 3. Blast radius

This is worse than the AI defect it was found beside, because it corrupts the **stored snapshot**
rather than one sentence about it. Every figure downstream inherits it:

| Affected | How |
| --- | --- |
| Net worth, assets | Doubled per extra run |
| Cashflow, savings rate | Doubled, or skewed if a field was left blank |
| **Wealth Health Score** | Savings and Debt Burden are scored from inflated income |
| **Retirement projection** | Corpus proxy is net worth; readiness overstated |
| Emergency fund months | Cash inflated, expenses possibly not |
| AI answers | Grounded on all of the above |

It was live from M5.5 until PR #61 and is independent of the AI — the dashboard would have shown
it too. **No production household ever triggered it** (§5), so the blast radius above is what was
at risk rather than what occurred.

**A note on the immutable snapshot.** Past snapshots keep the figures they captured, and that is
correct: they are a record of what the ledger said at that moment, not of what was true. Fixing the
write path does not and should not rewrite them. What it fixes is every capture from then on — and
since the dashboard reads `latest()`, a corrected re-capture corrects the display. The net-worth
trend will show the spike and its correction, which is honest.

## 4. Options for the write path

### Option A — Prefill the form, and upsert instead of append *(approved and shipped in #61)*

Load the household's current figures into the wizard, and on submit **update the rows the wizard
owns** rather than creating new ones.

The wizard already names everything it writes — `Cash & savings`, `Investments`, `Property`,
`Loan`, and cashflow categories `salary` / `living`. Those names are a stable key it controls, so
rows can be matched without a schema change:

- **Accounts** — match on household + wizard-owned name → `PATCH` the balance, or `POST` if absent
- **Debt** — match on household + `Loan` → `PATCH` outstanding/payment/rate
- **Cashflow** — match on household + current period + category → `PATCH` the amount

`PATCH` and `DELETE` already exist for all three, so **no new endpoints and no schema change**.

Why this is the right answer rather than a compromise:

- It implements what the button already says. "Update my figures" means *correct what I told you*.
- **Prefill removes the trap.** With figures on screen, a blank field means "I have none" — a real
  answer the user chose, not an accident of an empty form.
- Rows the wizard does not own are untouched, so anything a family added elsewhere survives.
- Re-running with identical figures becomes a no-op, which is the property that was missing.

Cost: an explicit decision about what clearing a prefilled field means. **Approved: zero the value,
keep the record.** As built — an account goes to a zero balance; a loan to zero outstanding while
staying `active`; a transaction is **voided**, because a transaction amount must be positive
(`@IsPositive`) and voiding is the kernel's own way of saying "this no longer counts", already
excluded from cashflow. Nothing is deleted and no event is inferred: a blank field is not evidence
that a house was sold or a loan settled.

### Option B — Delete-then-recreate

Same matching problem as A, plus it destroys transaction links and audit history. Deleting a
family's financial rows to fix a display bug is the wrong shape of solution.

### Option C — Treat each run as a new period

Date each run's cashflow into its own month and update accounts in place. Semantics: *here is this
month's position*. But two runs on the same day still double, so it does not actually close the
defect — and it changes what the check means without being asked to.

## 5. Existing data — CLOSED, no repair required

**Status: investigation closed on the production result. Nothing was repaired, and nothing needs
to be.**

The read-only count (`docs/sql/wealth-check-accumulation-count.sql`) was run against production in
Railway Data:

| Column | Result |
| --- | --- |
| `affected_households` | **0** |
| `with_duplicate_accounts` | 0 |
| `with_duplicate_loans` | 0 |
| `with_duplicate_cashflow` | 0 |
| `total_active_households` | 2 |

No household ever accumulated. The defect was real and reproducible — the reproduction in §1 was
run against a live API — but no real family had triggered it before the prevention fix landed.

The query was validated before it ran, against controlled fixtures: it flags two identical runs and
the assets-plus-income-with-blank-expenses path, and does not flag a single run, a household that
never ran the check, or a re-run that wrote nothing. That validation is the step that was missing
in #52, where the query itself turned out to be unsound.

**The identification query was not run**, and no repair SQL was written. Both were gated on a
non-zero count. `docs/sql/wealth-check-accumulation-households.sql` remains in the repository for
the same check after launch, when there are real families to count.

### 5.1 A correction to an earlier claim in this document

An earlier revision stated that the founder's own household was affected, and that its ₹18,75,000
monthly income was accumulated. **The production count contradicts that, and the earlier claim was
wrong.**

`with_duplicate_cashflow = 0` means no household has two live `salary` transactions in one month.
That income is therefore a **single transaction**, entered once — not the sum of several runs. The
figure was inferred from the 96% savings rate and from having reproduced an identical rate through
accumulation; that a mechanism *can* produce a number is not evidence that it *did*.

What remains true is that a monthly income of ₹18,75,000 against monthly expenses of ₹75,000 gives
a 96% savings rate, and the score and retirement projection follow from it correctly. Whether that
figure is right is a question for whoever entered it — the plausible reading is an annual amount
typed into a field labelled "Monthly income (₹)", which would be a UX observation about the wizard
rather than a data-integrity defect, and is **not** investigated here.

### 5.2 If a future count is non-zero

The gated sequence still stands, and none of it has been exercised:

1. **Count, read-only** — `wealth-check-accumulation-count.sql`.
2. **If small**, correct nothing automatically. An affected family opens the prefilled form, sees
   the inflated figure, and fixes it themselves. A user correcting their own data needs no
   permission and no migration.
3. **Only if large**, design a targeted repair as its own decision, with an audit entry per
   household and a dry run first. Never a query that infers intent from stored shape — that is the
   #52 lesson.

## 6. Tests — shipped in PR #61

*The defect itself*
- Running the check twice with identical figures leaves assets, income and expenses **unchanged** —
  the assertion that fails today
- Running it twice with different figures leaves the **second** set, not the sum
- Leaving a prefilled field blank sets that figure to zero rather than silently keeping the old one

*Preservation*
- Accounts the wizard does not own are untouched by a re-run
- A household with no prior check still works exactly as it does today
- Immutable snapshots already captured are unchanged

*Downstream*
- The health score and savings rate after two runs equal those after one

**Teeth:** confirmed. Against the previous append-only behaviour **8 of the 12 tests fail**; the
four that pass either way are the creation and preservation cases, which were never the defect.
Delivered as `apps/api/test/wealth-check-idempotency.e2e-spec.ts` (12 tests) plus a browser journey
in `apps/web/e2e/smoke.spec.ts`.

Two further defects surfaced while building it, both fixed in the same PR:

- **Cashflow could be silently discarded.** The anchor account could only be one created by *that*
  run, so a run that changed nothing about assets wrote no cashflow at all — figures accepted by the
  form and thrown away.
- **A prefill race that ate user input.** The prefill setters run when the request resolves, so
  anything typed before then was overwritten; for a family with no figures yet the prefilled value
  is an empty string, so their input vanished. Caught by the new browser tests failing
  intermittently — which I nearly dismissed as environment flakiness. The form is now gated until
  the prefill settles.

## 7. Rollback

No schema change, no migration. `git revert` of the PR #61 merge restores the previous behaviour.
**No data implications** — nothing was deleted or re-keyed; the change is which verb the wizard
uses.

## 8. Out of scope

- M5.8, and every AI surface
- The immutable snapshot contract — untouched
- Automated repair of existing data — **closed, none required** (§5). No repair SQL exists, and
  none should be written without a fresh non-zero count
- General account/transaction management UI, which already exists elsewhere

---

**Resolved.** Prevention merged in PR #61; historical repair closed with no action required on a
production count of zero affected households.
