# M2-3 — Household Net Worth & Snapshots — Design

> **Status:** Accepted (no major architectural change — follows the
> [M2 architecture reference](./M2_HOUSEHOLD_WEALTH_ARCHITECTURE.md), ADR-003 FX-in-domain, ADR-004 immutable
> snapshots). **Slice:** M2-3. **Depends on:** M2-1 (FX in `@lcos/core`), M2-2 (household accounts).

## Objective

Show a household's **consolidated, multi-currency net worth** computed live from its accounts, and let an
advisor **capture immutable snapshots** that form a net-worth **timeline**.

## Endpoints (`/api/households/:id/net-worth`, under `HouseholdScopeGuard`)

| Method | Route       | Access                | Purpose                                             |
| ------ | ----------- | --------------------- | --------------------------------------------------- |
| GET    | `/current`  | in-scope read         | Live consolidated net worth (computed, not stored). |
| POST   | `/snapshot` | OWNER/ADVISOR/SUPPORT | Capture an immutable `NetWorthSnapshot`. Audited.   |
| GET    | `/timeline` | in-scope read         | Ordered snapshot history.                           |

## Snapshot creation strategy

- **On-demand** via `POST /snapshot` in M2-3. A snapshot = the _current_ consolidated figures at capture time,
  persisted as one row.
- **Scheduled** capture per firm `reviewCadence` is **deferred to M0** (BullMQ/Redis worker) — it will call
  the same service, so no rework. Never run sweeps in the request path.

## Snapshot immutability (ADR-004)

- `NetWorthSnapshot` rows are **create-only** — never updated or deleted. A correction is a _new_ snapshot.
- The service exposes no update/delete for snapshots. The timeline is therefore a trustworthy, append-only
  history.

## Historical snapshot storage

- Stored in the existing `NetWorthSnapshot` table, scoped to the household (`householdId`, `firmId`).
- Each row freezes `assetsMinor` / `liabilitiesMinor` / `netWorthMinor` in the household **base currency** at
  `capturedAt`. A new composite index `(householdId, capturedAt)` backs efficient timeline reads.

## Recalculation rules

- **`/current` is always recomputed live** from the household's accounts — never read from a stored row. So
  editing/adding/removing an account changes `current` immediately.
- **Snapshots are frozen** — past snapshots are never recomputed, even if accounts or FX rates later change.
- If `Household.baseCurrency` changes, `current` re-bases automatically (recomputed); **past snapshots keep the
  currency they were captured in** (they are historical facts).

## Multi-currency calculation flow

```
household.baseCurrency ─┐
Account[] (native ccy) ─┼─► for each account:
                        │       convertMinor(balanceMinor, account.currency, base, FxRateProvider)   [@lcos/core]
                        ▼
              converted amounts (all in base) ─► computeNetWorth(list, base)   [@lcos/core]
                        ▼
              { assetsMinor, liabilitiesMinor, netWorthMinor, solvencyRatio, currency: base }
```

- Every account is converted to the base currency **individually, then summed** — never a mixed-currency sum
  (`money.ts` throws on mismatch; ADR-003).

## FX conversion boundaries

- **All FX math lives in `@lcos/core`** (`convertMoney`/`convertMinor`/`sumInBaseCurrency`, M2-1).
- **Rates are supplied by a `FxRateProvider`.** M2-3 adds a **`FxService`** (API layer, `common/`) that
  **implements `FxRateProvider`** over a **static/config rate table** (defaults from core
  `DEFAULT_USD_PER_UNIT`, overridable via config). It is injected into the net-worth service.
- **Swap-in rule:** replacing the static provider with a live one means providing a different
  `FxRateProvider` implementation to `FxService`/DI — **the domain layer and call sites do not change.**

## Performance considerations

- `current` is **O(accounts)**: one indexed `findMany` by `householdId` + in-memory conversion. No N+1.
- `snapshot` is a single `INSERT`; `timeline` is one indexed query on `(householdId, capturedAt)`.
- Static FX lookups are O(1) map reads. Heavy/scheduled work (sweeps) is deferred to the M0 worker, off the
  request path.

## Future extension points

- **FX providers:** live feed (ECB/OpenExchangeRates) behind the same `FxRateProvider`; add historical rates
  so back-dated snapshots use the rate as-of `capturedAt`.
- **Valuation providers:** mark-to-market for market-linked/illiquid assets, behind a `ValuationProvider`
  interface, feeding account balances before aggregation.
- **Pricing engines:** instrument-level pricing (units × price) resolved to a balance upstream of net worth.
- A snapshot may later record the **rate set / valuation source** used, for full reproducibility.

## Risks & trade-offs

| Risk                                                    | Mitigation                                                                                         |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Static FX rates are indicative / stale (**R-FX-RATES**) | Documented as dev defaults; provider interface lets a live feed drop in without domain changes.    |
| Snapshots use **capture-time** rates (no historical FX) | Acceptable for M2-3; historical-rate snapshots are a future FX-provider enhancement.               |
| Snapshot storage grows with cadence                     | Bounded; retention/pruning is a later policy (immutability preserved).                             |
| `BigInt`→`Number` + FX rounding drift (**R-PRECISION**) | Convert per account, round to minor units, serialize explicitly; assert within tolerance in tests. |
| Base-currency change re-bases `current` but not history | By design — snapshots are historical facts; documented in recalculation rules.                     |
| Cross-tenant leakage                                    | `HouseholdScopeGuard` + isolation e2e; snapshots scoped to `householdId`/`firmId`.                 |

## Schema change (additive, backward-compatible — ADR-010)

- Relax `NetWorthSnapshot.userId` → nullable (retail **or** advisory row, mirroring M2-2 `Account`).
- Promote `householdId` → `Household` relation (`onDelete: Cascade`); keep `firmId` scalar; add back-relation
  `Household.netWorthSnapshots`.
- Add composite index `(householdId, capturedAt)`. No new tables → no new RLS.
