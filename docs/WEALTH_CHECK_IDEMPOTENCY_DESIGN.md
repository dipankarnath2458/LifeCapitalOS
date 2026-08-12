# Wealth Health Check — re-running corrupts a family's figures

> **Status:** Design note for approval. **No code written, nothing changed.**
> **Scope:** the Wealth Health Check write path. Not M5.8, not the AI surfaces.
> **Origin:** Issue 2 from the AI Coach review — a savings rate of 96% that was faithfully
> computed from data that should never have been stored.

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

That is the production figure exactly.

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

It has been live since M5.5 and is independent of the AI — the dashboard has always shown it.

**A note on the immutable snapshot.** Past snapshots keep the figures they captured, and that is
correct: they are a record of what the ledger said at that moment, not of what was true. Fixing the
write path does not and should not rewrite them. What it fixes is every capture from then on — and
since the dashboard reads `latest()`, a corrected re-capture corrects the display. The net-worth
trend will show the spike and its correction, which is honest.

## 4. Options for the write path

### Option A — Prefill the form, and upsert instead of append *(recommended)*

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

Cost: an explicit decision about what clearing a prefilled field means. Proposal: **zero the
balance rather than delete the row**, so history and any linked transactions survive; a family who
truly wants a holding gone can delete it where accounts are managed.

### Option B — Delete-then-recreate

Same matching problem as A, plus it destroys transaction links and audit history. Deleting a
family's financial rows to fix a display bug is the wrong shape of solution.

### Option C — Treat each run as a new period

Date each run's cashflow into its own month and update accounts in place. Semantics: *here is this
month's position*. But two runs on the same day still double, so it does not actually close the
defect — and it changes what the check means without being asked to.

## 5. Existing data — the harder half

**Do not automate a repair.** The last backfill that inferred intent from stored shape (#52) wrote
advisors into their clients' households, and the lesson stands: a query that looks obviously right
can be wrong about a case nobody pictured.

Proposed sequence, each step gated on the previous:

1. **Count, read-only.** A `SELECT` for households with more than one wizard-owned account of the
   same name, or more than one income transaction in a single period. Answers *how many families*
   before proposing anything. Same discipline as the #52 investigation — a query, reviewed, run by
   you in Railway Data, with the result deciding what follows.
2. **If the answer is small** (likely — the product is pre-launch), correct nothing automatically.
   Once Option A ships, an affected family opens the prefilled form, sees the inflated number, and
   fixes it themselves. That is a user correcting their own data, which needs no permission.
3. **Only if the answer is large**, design a targeted repair as its own decision, with an audit
   entry per household and a dry run first.

**Your own household is affected** — the ₹18,75,000 income is the accumulation. It is also the
easiest to fix: once prefill ships, open the check and correct the figures.

## 6. Tests required before merge

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

**Teeth:** each new test confirmed to fail against today's code before merge. The first two already
do — §1 is the failing assertion, written as a reproduction.

## 7. Rollback

Additive to the write path, no schema change, no migration. `git revert` restores today's
behaviour. **No data implications** — nothing is deleted or re-keyed by the fix itself; it changes
which verb the wizard uses.

## 8. Out of scope

- M5.8, and every AI surface
- The immutable snapshot contract — untouched
- Automated repair of existing data (§5 step 3), which is a separate decision
- General account/transaction management UI, which already exists elsewhere

---

**Awaiting approval. No code has been written and nothing has been changed.**
