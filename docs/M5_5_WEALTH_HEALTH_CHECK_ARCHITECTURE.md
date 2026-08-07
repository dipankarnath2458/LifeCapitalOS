# M5.5 — Wealth Health Check — Architecture

> **Status:** Design, approved for implementation (PR-3). **Module:** M5.5 (Consumer Activation),
> priority 3. **Depends on:** M5.5 PR-1 (#48, personal household provisioning), PR-2 (#49, onboarding
> creates the household), the frozen Financial Kernel (M2-6 `FinancialSnapshot`), M3-1 Health Score.
> **Constraints:** Financial Kernel **frozen** — no schema change, no migration, no kernel code
> modified; authentication kernel untouched; design system composed, never edited; backward
> compatible.
> Companion: [`M5-5_CONSUMER_ACTIVATION`](./architecture/M5-5_CONSUMER_ACTIVATION.md),
> [`M3_FINANCIAL_HEALTH_DESIGN`](./architecture/M3_FINANCIAL_HEALTH_DESIGN.md),
> [`M2_FINANCIAL_SNAPSHOT_CONTRACT`](./architecture/M2_FINANCIAL_SNAPSHOT_CONTRACT.md),
> [`KERNEL_GOVERNANCE`](./architecture/KERNEL_GOVERNANCE.md).

---

## 1. What this is, and the one risk that shapes it

The Wealth Health Check is the consumer's first real output from the platform: they answer a short
series of questions and receive an explainable score of their financial position.

Everything below is shaped by a single risk. **The score must never be computed on data the user
thinks they provided but which never reached the snapshot.** A wrong number rendered confidently in
a financial product is worse than an error message, because nothing on screen distinguishes it from
a right one. Two concrete instances of that risk are live in this codebase today and are the reason
this design is written before the code:

1. **Wrong keying.** Consumer onboarding writes accounts to the retail path (`Account.userId`). The
   Financial Snapshot reads household accounts (`Account.householdId`). A wizard that reused the
   retail path would score an **empty** snapshot while showing the user the balance they just typed.
2. **Missing cashflow.** Household cashflow is derived from `Transaction` rows, not from a profile
   field. A wizard that collected "monthly income" into `Profile.annualIncomeMinor` would leave the
   snapshot's income at zero, scoring **Savings 0 / 20** and depressing the overall score for a user
   whose finances are fine.

Both produce a plausible-looking number. Neither throws.

## 2. Decision: household-scoped, single path

Every record the Wealth Health Check writes is **household-scoped**. The wizard writes through the
existing household APIs and reads the score back through the existing health-score API. No new
persistence, no new aggregation, no duplicated business logic.

The alternative — dual-keying consumer rows so they carry both `userId` and `householdId` — was
examined and is technically safe (every `Account` query in the API filters on exactly one key, and
none unions them, so nothing double-counts). It was **not** chosen: it contradicts the documented
either/or invariant in `schema.prisma`, and the retail surfaces it would preserve are themselves
scheduled for replacement in PR-4. Choosing it would trade a one-PR inconvenience for a permanent
ambiguity about which key owns a row.

**Consequence, stated plainly:** until PR-4, a consumer who entered a balance during onboarding
(retail) and then runs the Wealth Health Check (household) enters it twice. Nothing is lost and
nothing is wrong; it is redundant. PR-4 replaces the V1 retail dashboard with a household-backed
consumer dashboard, after which there is one path and one place to enter anything.

## 3. Wizard flow

Route: **`/wealth-health`**. Authenticated. Not firm-scoped from the client's point of view — the
consumer never sees or chooses a firm.

| Step | Collects | Writes |
| --- | --- | --- |
| 0 (implicit) | — | `POST /api/onboarding/household` — idempotent; guarantees a household exists even for users who registered before PR-2 or skipped onboarding |
| 1 · What you own | cash & savings, investments, property | `POST /api/households/:id/accounts` — one account per non-zero figure, `isLiability: false` |
| 2 · What you owe | loan balance, monthly payment, interest rate | `POST /api/households/:id/debts` |
| 3 · Money in, money out | monthly income, monthly expenses | `POST /api/households/:id/cashflow` — two `Transaction` rows dated **today** |
| 4 · Result | — | `POST /api/households/:id/financial-snapshot`, then `GET /api/households/:id/health-score/current` |

Design rules the steps follow:

- **Asset classes are set deliberately**, not defaulted. Cash → `assetClass: 'cash'` (this is what
  the Emergency Liquidity category counts); investments → `'equity'`; property → `'real_estate'`.
  Diversification scores off the spread of these classes, so a wizard that filed everything as
  `other` would understate a well-diversified family.
- **Transactions are dated to the current month.** The snapshot composes cashflow for
  `period ?? currentMonth()`. A transaction dated outside the current month is invisible to the
  score — the same silent-zero failure as collecting nothing at all.
- **Transactions need an account.** `CreateHouseholdTransactionDto.accountId` must reference an
  account in the household, so step 1 necessarily precedes step 3.
- **Zero is skipped, not written.** A family with no debt should produce no `Debt` rows, which the
  score reads as "No outstanding debt" rather than as a debt of zero.
- **Every step is re-runnable.** Re-running the check adds a new snapshot; snapshots are immutable
  and append-only by contract (ADR-004), so history accumulates rather than being overwritten.

## 4. Snapshot lifecycle

```
household accounts ─┐
household debts ────┼──► compose() ──► FinancialSnapshotPayload ──► FinancialSnapshot row
household txns  ────┘     (pure)         schemaVersion 1              (immutable, append-only)
                                                                            │
                                                                            ▼
                                                        computeFinancialHealthScore() (pure)
                                                                            │
                                                              ┌─────────────┴─────────────┐
                                                              ▼                           ▼
                                                    GET .../health-score/current   POST .../health-score
                                                    (live preview, not stored)     (persisted score row)
```

- **Composition is read-only.** `compose()` reads the household engines (accounts, net worth,
  cashflow, budget, debt) and performs FX to the household base currency. It writes nothing back.
- **Snapshots are immutable.** Captured with `schemaVersion 1`, never updated, never deleted. Each
  run of the Wealth Health Check produces one more snapshot; the timeline is the history.
- **The score references its snapshot.** Every score carries `snapshotId`, `schemaVersion` and
  `scoreModelVersion`, so any number shown to a user is reproducible from the exact immutable inputs
  it was computed from.
- **The wizard uses the live preview** (`GET .../health-score/current`) for the result screen and
  does **not** persist a score row. Persisting is a separate, audited action; a consumer looking at
  their result has not asked for a permanent record, and writing one on every render would pollute
  the timeline.

## 5. Scoring pipeline

`computeFinancialHealthScore` is a **pure** function in `@lcos/core` (`finance/financialHealth.ts`).
It takes a snapshot payload and returns a weighted, explainable score. The API never re-implements it.

| Category | Weight | Driven by | Depends on the wizard collecting |
| --- | --- | --- | --- |
| Net Worth & Solvency | 25 | assets vs liabilities | steps 1, 2 |
| Debt Burden | 25 | DTI + debt-to-assets | steps 1, 2, 3 |
| Savings | 20 | savings rate | **step 3** |
| Emergency Liquidity | 20 | liquid assets ÷ monthly expense | **steps 1, 3** |
| Diversification | 10 | spread across asset classes | step 1 |

**Behaviour when inputs are absent is honest, and that is why step 3 is mandatory in practice.** With
no income recorded the model drops DTI from Debt Burden and reports *"no income recorded to assess
DTI"*, and Savings scores 0 with the reason *"No income recorded for this period."* The score is
explainable rather than silently wrong — but it is still 20 points lower than the family deserves.
Collecting cashflow is therefore a correctness requirement, not a nicety.

The result screen renders `overall`, `band`, and every category's `score`, `reason` and `suggestion`
as returned by the API. **The UI computes no financial figure of its own** — per the kernel
governance rule that business math never lives in the browser.

## 6. Compatibility strategy

**Nothing existing changes.** This is additive: one new route, one new web module, zero API changes,
zero schema changes, zero migrations.

| Surface | Effect |
| --- | --- |
| Financial Kernel | Untouched. No schema change, no migration, `schemaVersion 1` intact. Consumed read-only through published APIs. |
| Authentication kernel | Untouched. |
| V1 retail dashboard (`/dashboard`) | Unchanged. Still reads retail (`userId`) data and still works for existing retail users. |
| Consumer onboarding (`/onboarding`) | Unchanged by this PR. Still writes retail records; still provisions the household. |
| Advisor workspace (`/app`) | Unchanged. Advisors already have households; the wizard's `ensureHousehold` returns their existing workspace rather than provisioning a second one. |
| Design system (`src/ui/**`) | Composed only. Nothing edited. |
| Existing users | A user who registered before PR-1 has no household. The wizard's step 0 provisions one idempotently on first use, so no backfill or migration is required. |

**Roles.** The household write endpoints require `OWNER`, `ADVISOR` or `SUPPORT`. A consumer is
`OWNER` of their personal firm by construction (PR-1), so every call the wizard makes is authorised
without any change to `HouseholdScopeGuard` or the role model.

**Rollback.** Additive and route-scoped: reverting the PR removes `/wealth-health` and leaves every
other surface untouched. Records already written by the wizard are ordinary household accounts, debts
and transactions and remain valid and readable; snapshots already captured remain immutable and
correctly scored. There is no data migration to undo. See the PR's rollback plan for the operational
steps.

## 7. What is deliberately not in this PR

- **Persisting a score row / score history UI** — the wizard shows a live preview. Timeline
  endpoints already exist and belong to the dashboard work in PR-4.
- **Unifying retail and household entry** — PR-4, when the V2 consumer dashboard replaces `/dashboard`.
- **Reconciling the two scoring models.** A V1 retail scorer (`computeWealthHealth` — emergency
  fund, protection, retirement gap) still silently grounds the AI coach, while this pipeline uses the
  V2 kernel model. They can disagree about the same family. Flagged, not addressed here; it belongs
  with the AI work in PR-5.
