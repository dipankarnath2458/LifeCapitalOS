# M5.5 — Consumer Activation — Design

> **Status:** In progress. **Module:** M5.5 (Consumer Activation). **Depends on:** the frozen Financial
> Kernel (M2-6 `FinancialSnapshot`), M3-1 Health Score, M5 Financial Intelligence Layer, and the platform
> baseline tagged `v2.0-platform-stable`. **Constraints:** the **Financial Kernel remains immutable**; the
> **authentication kernel is not modified** unless a production bug is proven; **no schema change** unless
> product functionality requires it; backward compatibility preserved throughout.
> Companion: [`KERNEL_GOVERNANCE`](./KERNEL_GOVERNANCE.md),
> [`FUTURE_MODULE_CONTRACT`](./FUTURE_MODULE_CONTRACT.md),
> [`M5_FINANCIAL_INTELLIGENCE_LAYER`](./M5_FINANCIAL_INTELLIGENCE_LAYER.md),
> [`CONSUMER_OS_MASTER_BLUEPRINT`](../product/CONSUMER_OS_MASTER_BLUEPRINT.md).

---

## 1. What M5.5 is for

Everything the platform can compute about a family's finances exists and is tested. Almost none of it is
reachable by a consumer who signs up on their own. M5.5 closes that gap — onboarding, household creation,
the Wealth Health Check, the consumer dashboard, and AI insights — as a **product layer on top of the
existing platform**, not as new financial machinery.

## 2. The blocking finding: ADR-010 duality is partial

ADR-010 describes a retail/advisory duality in which financial records may be keyed either to a `User`
(retail) or to a `Household` (advisory). **That duality was only ever implemented for part of the model.**

| Model | Keying | Reachable by a firm-less consumer? |
| --- | --- | --- |
| `Account`, `Transaction`, `Debt`, `Budget`, `NetWorthSnapshot` | dual-keyed — `userId` **or** `householdId` | yes |
| **`FinancialSnapshot`** | `householdId` + `firmId`, both **NOT NULL** | **no** |
| **`Entity`** | `householdId` + `firmId`, both **NOT NULL** | **no** |
| **`FinancialHealthScore`** | household-only | **no** |

The consequence is not cosmetic. The Financial Snapshot is the canonical immutable read model that the
Financial Intelligence Layer, the health-score engine, and every AI feature consume — by contract, they
read snapshots and nothing else. So a consumer confined to the retail path **cannot have a snapshot**, and
therefore cannot have a Wealth Health Check, a health score, or AI insights.

That is M5.5 priorities 3, 4 and 5. They were blocked before any UI was written.

## 3. Decision: a personal firm per consumer

Two options existed.

**Option A — relax the snapshot to be dual-keyed.** Make `FinancialSnapshot.householdId` and
`Entity.householdId` nullable and key them to a user instead. This changes the frozen `schemaVersion 1`
snapshot contract, and with it `HouseholdScopeGuard`, the RLS lockdown, and every engine that assumes a
household is present. It is a redesign of the Financial Kernel, which is explicitly frozen (G-1…G-6).
**Rejected.**

**Option B — give each consumer a personal firm.** On onboarding, provision one `Firm`, one OWNER
`Membership`, and one `Household`. **Chosen.**

Option B costs one extra row per consumer and buys:

- **Zero schema change.** No migration, no kernel change, snapshot contract untouched.
- **Immediate reuse.** Every household-scoped engine — snapshot capture, net worth, cashflow, debt, health
  score, intelligence layer — works for consumers unchanged, already built and already tested.
- **No divergence.** There is exactly one code path for computing a family's finances, not a household one
  and a parallel consumer one that drift apart.
- **A real upgrade path.** A consumer who later engages an advisor already has the right shape.

### On the word "firm"

The firm is an **internal tenancy artifact. A consumer must never see the word.** It is not a fiction
either — a single-family office is precisely what this models. Firms created this way are named
`Personal · <email>` so whoever operates the support console can tell personal workspaces from real
advisory firms.

## 4. Provisioning contract

Two endpoints. Authenticated, but deliberately **not firm-scoped** — the caller has no firm context yet,
which is the entire point.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/onboarding/status` | What the caller already has, so the web app can choose between onboarding and dashboard |
| `POST /api/onboarding/household` | Idempotent provisioning |

Within one transaction: `Firm` → OWNER `Membership` → `Household` → `User.activeFirmId`. A firm without a
membership would lock the user out of their own data; a membership without a household would leave
onboarding half-done with no way to retry into a consistent state. Setting `activeFirmId` in the same
transaction means the consumer's first request after onboarding resolves without a firm-switch round trip.

The household name is encrypted at rest like every other household name. It falls back from what the user
typed, to their profile surname, to `My household` — and never throws, because the name is cosmetic and the
household is not.

An **advisor** who already belongs to a firm gets their existing workspace back rather than a second,
personal one.

### Idempotency is a correctness requirement, not a nicety

Two households for one consumer would put their accounts in one and their snapshot in the other —
silently, unmergeably, and with no error surfaced to anyone. So it is asserted directly rather than
inferred from the code reading correctly: a regression test drives two simultaneous requests at the
endpoint.

That test **failed on the first implementation**. Both callers passed the existence check under READ
COMMITTED and both created a household. The fix is `pg_advisory_xact_lock` keyed per user, plus a re-check
*inside* the lock, plus a flag so the loser of a race reports `provisioned: false` and emits no duplicate
audit entry.

An advisory lock rather than a unique constraint, because there is no natural unique key available: an
advisor may legitimately hold memberships in several firms, so `Membership.userId` cannot be made unique.

> **Implementation note.** `pg_advisory_xact_lock` returns `void`, which Prisma's `$queryRaw` cannot
> deserialize — it throws before the lock is ever taken. Use `$executeRaw`, which does not deserialize
> columns. The failure was loud in tests but would have been a 500 on every signup in production.

## 5. Scope and sequencing

| PR | Scope | State |
| --- | --- | --- |
| PR-1 | Consumer household provisioning (API) | This document |
| PR-2 | Consumer onboarding flow (web) | Planned |
| PR-3 | Wealth Health Check wizard | Planned |
| PR-4 | Consumer financial dashboard | Planned |
| PR-5 | AI insights via the Financial Intelligence Layer | Planned |

## 6. Constraints held

- **Financial Kernel frozen** — not redesigned, not replaced, not bypassed. No schema change, no migration,
  `schemaVersion 1` intact.
- **Authentication kernel unmodified.**
- **AI features consume the Financial Intelligence Layer**, never raw financial data it already exposes.
  PR-1 is what makes that layer reachable for a consumer at all.
- **No duplicated business logic** — household-scoped engines are reused as-is.
- **Backward compatible** — additive module only; no existing route or behaviour altered.
