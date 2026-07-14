# M2-5 — Household Debt & Payoff Engine — Architecture

> **Status:** Accepted (no major architectural change — extends the household-scoped, multi-currency M2
> pattern and the immutable-snapshot model; follows the
> [M2 architecture reference](./M2_HOUSEHOLD_WEALTH_ARCHITECTURE.md) + ADRs, adds **ADR-011**). **Slice:** M2-5.
> **Depends on:** M2-1 (FX in `@lcos/core` + `simulateDebtPayoff`), M2-2 (household accounts/entities),
> M2-3 (FxService + immutable snapshots), M2-4 (cashflow ledger — reused for payment posting).

## 1. Purpose

The **detailed liability engine** for a household: model each debt (type, lender, rate, EMI, outstanding
balance, lifecycle), record payments (EMI / interest / principal / prepayment / foreclosure), project payoff
(snowball / avalanche via the existing core simulator), and capture an **immutable `DebtSnapshot`** history —
consistent with the M2-3 net-worth timeline. It reuses M2-1/2/3/4 rather than duplicating: FX in the domain
layer, `simulateDebtPayoff` from `@lcos/core`, the household scope/guard/audit pattern, and (optionally) the
M2-4 cashflow ledger as the single write path for the cash side of a payment.

**In scope:** debt CRUD, payments, live summary + payoff, immutable debt snapshots + timeline, minimal
verification UI. **Out of scope (future §10):** amortization schedules, refinancing, floating-rate accrual,
credit score, AI payoff advice, banking feeds, tax deductions.

## 2. Debt domain model

`Debt` extends the existing model **additively** — one liability:

| Field | Notes |
| --- | --- |
| `householdId` → `Household` | aggregate root (ADR-001); scope column promoted to a relation. |
| `firmId` | tenant scope (indexed scalar). |
| `entityId` → `Entity` (nullable) | optional owning legal entity (§3), `onDelete: SetNull`. |
| `type` | `home_loan` \| `vehicle_loan` \| `personal_loan` \| `education_loan` \| `business_loan` \| `credit_card` \| `other` (`business_loan` added additively). |
| `secured` | `Boolean` — **secured** (home/vehicle/loan-against-asset) vs **unsecured** (personal/education/card). |
| `lender` | free-form lender name (nullable). |
| `principalMinor` (`BigInt`) | **original** sanctioned amount, native minor units. |
| `outstandingMinor` (`BigInt?`) | **current** balance; seeded to `principalMinor` at creation, decremented by payments. |
| `annualInterestRatePct` (`Float`) | nominal annual rate. |
| `minimumPaymentMinor` (`BigInt`) | minimum due (feeds the payoff simulator). |
| `emiMinor` (`BigInt?`) | scheduled installment for fixed-EMI loans (nullable; cards use `minimumPaymentMinor`). |
| `currency` | **native** ISO currency; FX to household base at aggregation (ADR-003). |
| `startedAt`, `maturityAt`, `dueDayOfMonth` | lifecycle dates + monthly due day. |
| `status` | `active` \| `closed` \| `written_off` \| `archived` (enum; §4). |
| `note`, `createdById`, `updatedById` | free text + audit provenance. |
| `userId` | retail owner, **relaxed to nullable** — retail (`userId`) **or** advisory (`householdId`), mirroring M2-2/3/4. |

**Debt-type coverage:** the required taxonomy maps onto the enum; **secured vs unsecured** is the orthogonal
`secured` flag (so "secured loan" / "unsecured loan" are classifications, not new enum values). "Other
liabilities" → `other`.

## 3. Ownership model

- **Household owned** — the default: `householdId` set, `entityId` null.
- **Entity owned** — `entityId` references an `Entity` **in the same household** (validated like M2-2 accounts);
  e.g. a loan on an HUF or company balance sheet.
- **Individual owned** — retail tier (`userId` set, no household) — the existing retail path, untouched.
- **Multi-owner (future)** — the single `entityId`/`householdId` shape is forward-compatible: a future
  `DebtOwner` join table (debt ↔ member/entity with share %) can be added **additively** without reshaping
  `Debt`. Documented as an extension point; not built in M2-5.

## 4. Debt lifecycle

`status` is an explicit enum, default `active`:

- **Creation** → row created `active`; `outstandingMinor` seeded to `principalMinor`.
- **Active** → payments accrue against it; appears in summary/payoff/snapshots.
- **Closed** → fully repaid (a foreclosure payment or `outstanding == 0` transitions it); excluded from
  active payoff but retained.
- **Written off** → lender write-off; retained for history, excluded from active liability totals.
- **Archived** → hidden from default lists (soft retirement), row retained (never hard-deleted for advisory
  records — mirrors the household soft-delete convention). Hard `DELETE` remains available for mistaken entries.

Only `active` debts feed the live payoff projection and the "current outstanding" total; `closed`/`written_off`
/`archived` are filterable but excluded from active aggregates. Historical **snapshots** already froze their
values, so lifecycle changes never rewrite the past (§7).

## 5. Payment model

`DebtPayment` — one repayment event against a debt:

| Field | Notes |
| --- | --- |
| `debtId` → `Debt` (`onDelete: Cascade`), `householdId`, `firmId` | scope. |
| `type` | `emi` \| `extra` \| `prepayment` \| `foreclosure` (enum). |
| `amountMinor` | total paid (native currency of the debt). |
| `principalMinor`, `interestMinor` | the split (principal reduces `outstandingMinor`; interest is cost). |
| `currency`, `paidOn` | native ISO + payment date. |
| `transactionId` (`String?`) | **optional link to the M2-4 cashflow `Transaction`** — reuse, not duplicate: the cash movement lives in the cashflow ledger; the debt payment references it. |
| `createdById` | provenance. |

- **EMI / interest / principal / outstanding** — a payment carries its principal/interest split; the service
  decrements `Debt.outstandingMinor` by `principalMinor` (never below zero).
- **Due dates** — `Debt.dueDayOfMonth` + `maturityAt`; surfaced for reminders (a scheduler is M0/M6).
- **Extra payment / partial prepayment** — `type = extra | prepayment`; reduces principal faster.
- **Full foreclosure** — `type = foreclosure`; clears the balance and transitions the debt to `closed`.
- **No cashflow duplication** — M2-5 does **not** re-implement transaction storage; posting the cash side to the
  M2-4 ledger is an optional link (`transactionId`). Whether every payment auto-posts a `Transaction` is a
  future toggle; M2-5 keeps them decoupled to avoid double-counting.

## 6. Snapshot strategy — integration with M2-3 immutable snapshots

M2-5 follows **ADR-004** exactly and adds a **new immutable `DebtSnapshot`** (create-only; never
updated/deleted), the debt analogue of `NetWorthSnapshot`:

| Field | Notes |
| --- | --- |
| `householdId` → `Household`, `firmId` | scope. |
| `totalOutstandingMinor`, `totalEmiMinor`, `debtCount` | consolidated in the **household base currency** at capture. |
| `weightedAvgRatePct` | outstanding-weighted average rate (frozen). |
| `breakdown` (`Json`) | per-type outstanding + per-debt line at capture time — the **immutable detail**. |
| `currency`, `capturedAt` | base ccy + capture time. |

**How it integrates with M2-3 (critical — see ADR-011):** M2-3 net worth computes liabilities from
`Account.isLiability` rows. The `Debt` model is a **parallel, richer** liability representation. To stay
**backward-compatible and avoid double-counting**, M2-5 **does not change how M2-3 net worth is computed** —
accounts remain the net-worth liability source, and `DebtSnapshot` is a **separate** immutable series capturing
debt detail. The **M2-6 Financial Snapshot seam** is where the two are reconciled into one household financial
snapshot (it consumes both `NetWorthSnapshot` and `DebtSnapshot` + the M2-4 cashflow summary — no re-query).
Both snapshot types share the household base currency and `FxService`, so figures reconcile. (A future opt-in
to represent each debt as a liability `Account`, or to post debt balances into net worth, is an extension point,
not M2-5.)

## 7. Historical rules

Once captured, a `DebtSnapshot`'s values are **immutable** (ADR-004): later edits to a debt, payments, rate
changes, or lifecycle transitions **never** rewrite a past snapshot. The `breakdown` JSON freezes the
per-debt/per-type detail at capture. Corrections are made by capturing a **new** snapshot, never by editing an
old one — identical to the M2-3 net-worth timeline, so debt history is reproducible for trends/reports/scores
and, later, the M2-6 seam.

## 8. Recalculation rules

- **Live reads recompute; snapshots are frozen.** `GET …/debts/summary` and `…/debts/payoff` are **computed on
  read** from live `active` debts (FX-converted per debt, then aggregated) — never stored.
- **Events that change live figures** (and thus the next summary/payoff/snapshot): debt **create / update /
  delete / archive**, a **payment recorded** (decrements `outstandingMinor`), a **status transition**
  (active→closed/written_off/archived), and a **rate/EMI edit**. None of these touch existing snapshots.
- **Snapshot capture** is the only write that persists history — explicit `POST …/debts/snapshot` in M2-5 (a
  scheduled cadence is deferred to M0, like M2-8). No implicit recompute of prior snapshots ever occurs.

## 9. Performance considerations

- **Avoid unnecessary recomputation** — summary/payoff are O(active debts) in-memory over a single indexed
  `findMany`; snapshots are cheap indexed reads (no recompute to view history).
- **Indexed queries** — `Debt` indexed on `(householdId)`, `(householdId, status)`, `(firmId)`, `(entityId)`;
  `DebtPayment` on `(debtId)`, `(householdId)`; `DebtSnapshot` on `(householdId, capturedAt)` (mirrors M2-3).
- **Efficient snapshot generation** — one scoped `findMany` of active debts + in-memory FX/aggregate + one
  insert; O(debts), no N+1. The payoff simulator has a 100-year safety cap (already in core).
- Heavy/scheduled work (amortization tables, scheduled snapshots, feeds) is deferred to the M0 worker, never the
  request path.

## 10. Future extension points

Placeholders — each slots in additively without reshaping M2-5:

- **Credit score** — a `CreditProfile` per member/household (score, bureau, pulledAt).
- **Loan refinancing** — a `RefinanceEvent` linking an old debt to a new one (rate/tenure change).
- **Interest-rate changes / floating vs fixed** — a `rateType` (`fixed` | `floating`) + a `DebtRateChange`
  history feeding period-accurate accrual.
- **Debt optimization / AI payoff recommendations** — grounded on this engine's summary + `simulateDebtPayoff`;
  surfaced via the M4 agent fleet.
- **Banking integrations** — loan statements via Account Aggregator behind an `ImportSource` (as M2-4 cashflow).
- **Tax deductions** — flag deductible interest (e.g. home-loan §24/80C) for the tax module.
- **Amortization schedules** — a core `amortize(principal, rate, tenure)` producing a schedule (pure function;
  no new storage) — the natural next core addition.

## Schema change (additive — ADR-010)

- `DebtType` += `business_loan`. New enums `DebtStatus` (`active|closed|written_off|archived`) and
  `DebtPaymentType` (`emi|extra|prepayment|foreclosure`).
- `Debt`: relax `userId` → nullable; promote `householdId` → `Household` relation (`onDelete: Cascade`); add
  `entityId` → `Entity` (`onDelete: SetNull`); add `secured`, `lender`, `outstandingMinor`, `emiMinor`,
  `startedAt`, `maturityAt`, `dueDayOfMonth`, `status @default(active)`, `note`, `createdById`, `updatedById`;
  add indexes `(householdId, status)`, `(entityId)`.
- New tables **`DebtPayment`**, **`DebtSnapshot`** (+ RLS lockdown, indexes). Back-relations `Household.debts` /
  `Household.debtSnapshots`, `Entity.debts`, `Debt.payments` / `Debt.snapshots`. No reshaping of existing models;
  retail paths untouched.
