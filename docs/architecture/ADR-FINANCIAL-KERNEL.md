# ADR — The Financial Kernel (consolidated)

> **Status:** Accepted · **Date:** post-M2 (PRs #15–#20 merged) · **Supersedes:** nothing · **Consolidates:**
> ADR-001…004, 010, 011, 012 from the [M2 architecture reference](./M2_HOUSEHOLD_WEALTH_ARCHITECTURE.md).
> This is the single permanent record of **why** Life Capital OS V2 is built around an immutable, versioned
> Financial Snapshot. Detail: [`FINANCIAL_KERNEL_ARCHITECTURE.md`](./FINANCIAL_KERNEL_ARCHITECTURE.md),
> [`M2_FINANCIAL_SNAPSHOT_CONTRACT.md`](./M2_FINANCIAL_SNAPSHOT_CONTRACT.md).

## Context

Module 2 delivered five household financial engines — **Accounts** (M2-2), **Net Worth** (M2-3), **Cashflow &
Budget** (M2-4), **Debt & Payoff** (M2-5) — each owning a slice, each multi-currency. Every planned module
above them (health score, retirement, goals, estate, insurance, tax, forecasting, risk, AI advisor, family
office dashboard) needs the household's **whole** financial position. Letting each consumer re-query and
re-reconcile four engines would multiply logic, drift assumptions, couple every module to internal schemas,
and give AI/reporting an unstable, non-reproducible input.

## Decision

Introduce a **Financial Kernel**: the engines plus an **immutable, versioned, checksummed `FinancialSnapshot`**
that **composes** them into one canonical, base-currency read model. This crystallizes a set of decisions that
apply system-wide:

1. **Household is the aggregate root** (ADR-001). Every financial row is scoped by `householdId` (+ `firmId`);
   aggregation is always at household scope.
2. **FX only in the domain layer** (ADR-003). Store native currency; convert at aggregation via `FxService` +
   `@lcos/core`; stamp the rate-set version (`fxVersion`) into each snapshot for reproducibility.
3. **Immutable financial history** (ADR-004). `NetWorthSnapshot`, `DebtSnapshot`, and `FinancialSnapshot` are
   **append-only** — never updated or deleted. Live figures are computed; only snapshots persist history.
   Corrections are new snapshots, never edits.
4. **The snapshot is the canonical read model** (ADR-012). Consumers and AI **read snapshots, never raw
   tables, and never re-aggregate.** The kernel introduces **no new aggregation math** — it calls the engine
   services + core.
5. **Reconciliation lives in the kernel** (ADR-011 → resolved by ADR-012). Net worth stays account-based
   (unchanged, backward-compatible); the debt ledger is parallel; `householdEquity` is the one place the two
   liability views are unified (`reconciledEquity = netWorth − totalDebt`), with no double-counting.
6. **The payload shape is a versioned contract** (`schemaVersion`, additive-only). Old snapshots are never
   rewritten; breaking needs bump the version with an `upgradePayload` up-converter.
7. **Additive, backward-compatible evolution** (ADR-010). New tables (RLS lockdown) or nullable columns only;
   retail (`userId`) and advisory (`householdId`) rows coexist; every migration verified drift-free.
8. **Uniform tenancy & audit** (ADR-002/005). One `HouseholdScopeGuard` (404-not-403), write gate
   `@FirmRoles(OWNER, ADVISOR, SUPPORT)` (ANALYST read-only), append-only audit on every mutation, encrypted
   PII (ADR-006), RLS lockdown on every table.

## Consequences

**Positive**
- Consumers depend on a **stable contract**, not engine internals; M3+ ships without touching M2.
- Reads are **O(1) indexed** snapshot fetches, not O(household) recomputes.
- History is **reproducible and auditable** (checksum + engine/FX versions) — the foundation for trustworthy
  AI, reporting, and compliance.
- Multi-currency is **resolved once**; no consumer does FX.
- AI has a **safe, bounded, reproducible** grounding input and a structural rule that keeps it off raw tables.

**Negative / accepted trade-offs**
- Snapshot storage grows with capture cadence (bounded; retention/pruning is future policy; scheduled capture
  deferred to the M0 worker).
- The `FinancialSnapshot.payload` is embedded JSON — large family-office books may need payload pagination in
  a future `schemaVersion`.
- `householdEquity` reconciliation assumes debts aren't also liability accounts (no FK yet); exact linkage is
  an additive future `Debt.accountId`.
- `snapshotVersion` is a best-effort ordinal (no unique constraint); `capturedAt+id` is authoritative.

## Alternatives considered

- **Live virtual aggregate, no persistence** — rejected: not reproducible, no frozen AI/reporting input,
  O(n) every read.
- **Each consumer re-aggregates the engines** — rejected: duplicated logic, drifting assumptions, tight
  coupling to internal schemas; the exact problem the kernel removes.
- **Fold everything into `NetWorthSnapshot`** — rejected: overloads M2-3, breaks its shape/immutability, no
  room for cashflow/debt/versioning.
- **Post debt balances directly into net worth** — rejected: double-counts, mutates the M2-3 computation,
  breaks immutability (ADR-011).

## Compliance & validation

- **Verified in code** (M2-6): immutable capture, checksum over canonical JSON, engine/FX/schema versions,
  reconciliation, and an e2e test proving a stored snapshot is **byte-identical after later mutations**.
- **Future-module fit validated** in [`EXTENSION_GUIDELINES.md`](./EXTENSION_GUIDELINES.md): all twelve planned
  modules are supportable without redesign (seven today; five via small additive extensions).
