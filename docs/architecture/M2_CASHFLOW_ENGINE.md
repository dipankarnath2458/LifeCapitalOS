# M2-4 — Household Cashflow & Budget Engine — Architecture

> **Status:** Accepted (no major architectural change — extends the household-scoped, multi-currency M2
> pattern; follows the [M2 architecture reference](./M2_HOUSEHOLD_WEALTH_ARCHITECTURE.md) + ADRs). **Slice:**
> M2-4. **Depends on:** M2-1 (FX in `@lcos/core`), M2-2 (household accounts), M2-3 (FX service + snapshots).

## 1. Purpose and scope

The **single source of truth for a household's financial activity**: every income, expense, transfer and
adjustment is a `Transaction` owned by the household and an account. On top of the ledger sits a **monthly
budget engine** (budget vs actual, remaining, overspend) and a **timeline** (monthly summaries, category
breakdown, income vs expense, trend series). All aggregation is multi-currency (native → household base via
the M2-3 FX abstraction). **In scope:** transaction CRUD, budgets, timeline, minimal verification UI.
**Out of scope:** bank feeds / imports / OCR / AI categorization / forecasting (see §Future); live FX; a real
event bus (the engine is *event-ready*, §enterprise).

## 2. Cashflow domain model

`Transaction` (extends the existing model additively) — one financial event:

| Field | Notes |
| --- | --- |
| `householdId` → `Household` | aggregate root (ADR-001); scope column promoted to a relation. |
| `firmId` | tenant scope (indexed scalar). |
| `accountId` → `Account` | the account the money moved in/out of (must be in the household). |
| `type` | `income` \| `expense` \| `transfer` \| `adjustment` (enum; `adjustment` added additively). |
| `category` | free-form string (recommended taxonomy in §3); budgets key off it. |
| `amountMinor` (`BigInt`) | **native** amount, minor units, always positive. |
| `currency` | **native** ISO currency of the transaction. |
| `baseCurrency` | household base currency **at entry time** (denormalized reference; amounts are still converted live). |
| `occurredAt` | the transaction date. |
| `note`, `tags` (`String[]`) | free text + labels. |
| `status` | `cleared` \| `pending` \| `void` (string; default `cleared`). |
| `createdById`, `updatedById` | acting `User` ids (audit provenance). |
| `userId` | retail owner, **relaxed to nullable** — a row is retail (`userId`) **or** advisory (`householdId`), mirroring M2-2/2-3. |

**No converted base amount is stored** — conversion happens at aggregation via `FxService` (ADR-003), so a
rate change never rewrites the ledger.

## 3. Income and expense categories

Category is a **free string** (kept flexible/additive; no enum migration). A **recommended taxonomy** is
documented for consistency and budgeting:

- **Income:** `salary`, `business`, `rental`, `investment_income`, `other_income`.
- **Expense:** `housing`, `utilities`, `groceries`, `transport`, `education`, `healthcare`, `insurance`,
  `lifestyle`, `emi`, `taxes`, `other_expense`.

`transfer` / `adjustment` transactions carry a category but are **excluded from income/expense summaries**
(transfers move money between the household's own accounts; adjustments correct balances).

## 4. Budget model

Monthly, per household:

- `Budget` — one per `(householdId, periodMonth 'YYYY-MM')`: `currency` (base), optional `totalAmountMinor`
  (overall monthly cap), `createdById`/`updatedById`.
- `BudgetLine` — one per `(budgetId, category)`: `amountMinor` (the category envelope limit).

**Budget vs actual** = for a month, compute each category's converted **actual** expense from the ledger, feed
`{category, limitMinor, spentMinor}` into `@lcos/core evaluateBudget` → `remainingMinor`, `utilization`,
`overBudget`. The overall cap compares `totalAmountMinor` vs total converted expense.

## 5. Recurring transactions

**Not persisted as a recurrence engine in M2-4** (that needs the M0 job runner to materialize occurrences).
Recurring entries are modelled as **normal `Transaction` rows** (one per occurrence). A future `recurrenceId`
+ scheduler (M0/M6) can generate them; the ledger shape does not change. Documented as an extension point.

## 6. One-time transactions

The default: a single `Transaction` at `occurredAt`. No special handling — the ledger is a flat, immutable-ish
event list (edits allowed by write roles; every edit stamps `updatedById` and is audited).

## 7. Monthly aggregation strategy

```
transactions (native ccy) ──► for each: convertMinor(amountMinor, currency, base, FxService)   [@lcos/core]
                              group by month(occurredAt)  ──► summarizeCashflow(entries, base)   [@lcos/core]
                              ──► { income, expense, net, savingsRate, byCategory } per month
```

- Conversion is **per transaction, then grouped** — never a mixed-currency sum (ADR-003).
- `void` transactions are excluded; `transfer`/`adjustment` excluded from income/expense.
- Aggregation is O(transactions in range); indexed on `(householdId, occurredAt)`.

## 8. Timeline integration

`GET /households/:id/cashflow/timeline` returns **monthly summaries** (income/expense/net/savings +
`byCategory`), oldest→newest, ready for **trend** charts. This complements the M2-3 net-worth timeline: net
worth = stock (balance sheet snapshots); cashflow = flow (monthly activity). Both are household-scoped and
base-currency-normalized so a future dashboard can show them together.

## 9. Relationship with Household Accounts (M2-2)

Every transaction references an `Account` that must belong to the path household (validated, like M2-2's
entity check). The cashflow engine **reads** accounts for validation but does **not** mutate account balances
in M2-4 (balances remain the source for net worth; posting transactions to balances is a future, opt-in
step). Accounts provide the native currency context.

## 10. Relationship with Net Worth Snapshots (M2-3)

Cashflow and net worth are **complementary and independent**: cashflow is the flow ledger; M2-3 snapshots
freeze the balance-sheet stock. They share the **household base currency** and the **`FxService`** so figures
reconcile. A future step may post cleared transactions to account balances before a snapshot; M2-4 keeps them
decoupled (no drift).

## 11. Relationship with the Financial Snapshot Seam (M2-6)

M2-6's `FinancialSnapshot` seam will **consume this engine** (monthly savings rate, expense totals, category
mix) as grounding inputs for scores/AI — it must **not** re-query or re-aggregate transactions itself. The
cashflow service exposes a reusable `summary(householdId, base, range)` the seam calls.

## 12. Validation rules

- `amountMinor` > 0 (sign is conveyed by `type`, not a negative amount).
- `accountId` ∈ household; `currency` a supported ISO code; `type` ∈ enum; `status` ∈ {cleared,pending,void}.
- `occurredAt` a valid date; `category` non-empty; `tags` an array of short strings.
- `periodMonth` matches `YYYY-MM`; budget `amountMinor` ≥ 0; one budget per household per month (upsert).
- A transaction/budget is verified to belong to the path household before update/delete.

## 13. Security and authorization

- Every route is `HouseholdScopeGuard`-gated (household ∈ firm ∧ in caller scope; out-of-scope → **404**).
- **Write roles:** `OWNER`, `ADVISOR`, `SUPPORT` (the household **data-entry** roles). The requirement's
  "SUPERVISOR" is not a role in the RBAC model; it maps to **`SUPPORT`** — introducing a new role would be
  architectural drift, so we reuse the existing data-entry set (matches M2-2/2-3). `ANALYST` is **read-only**.
- Every mutation is audited (`AuditService`, `{ firmId, householdId }`); `createdById`/`updatedById` record
  provenance on the row.

## 14. Performance considerations

- List/timeline: single indexed `findMany` on `(householdId, occurredAt)`; in-memory FX + grouping; no N+1.
- Budget vs actual: one budget read + one scoped transaction read for the month.
- Static FX lookups are O(1). Heavy/scheduled work (imports, recurrence, forecasts) is deferred to the M0
  worker, never the request path. Pagination (`skip`/`take`, `{ total, data }`) on the transaction list.

## 15. Future extension points

- **Bank feeds** (Account Aggregator / Setu) → import transactions behind an `ImportSource` interface.
- **OCR receipt ingestion / UPI import / credit-card import** → provider adapters that produce `Transaction`s
  through the same service (single write path).
- **AI categorization** → suggest `category`/`tags` on ingest (grounded; human-confirmable).
- **Budget forecasting** → project future months from history (M0 job; reads this engine).
- **Recurrence engine**, **posting to balances**, **cash-in-transit / reconciliation**.

## Enterprise / event-ready design

- **Single source of truth.** All household financial activity flows through `Transaction`; future modules
  (Debt M2-5, Financial Snapshot Seam M2-6, balance sheet, statements, goals, retirement, tax, estate,
  insurance, AI) **consume this engine** (its service methods / summaries) rather than duplicating transaction
  logic.
- **Event-ready.** Mutations funnel through a single service method per operation, the natural point to emit
  domain events (`transaction.created/updated/voided`, `budget.updated`) once the M6 event bus exists — no
  call-site changes needed. Additive, backward-compatible, household-isolated, multi-currency by construction.

## Schema change (additive — ADR-010)

- `TransactionType` += `adjustment` (additive enum value).
- `Transaction`: relax `userId` → nullable; promote `householdId` → `Household` relation (`onDelete: Cascade`);
  add `baseCurrency?`, `tags String[]`, `status @default("cleared")`, `createdById?`, `updatedById?`.
- New tables **`Budget`**, **`BudgetLine`** (+ RLS lockdown, indexes, unique keys). Back-relations
  `Household.transactions` / `Household.budgets`. No reshaping of existing models; retail paths untouched.
