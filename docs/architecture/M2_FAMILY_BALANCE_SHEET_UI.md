# M2-7 — Family Balance Sheet UI — Architecture & Design

> **Status:** Accepted (no major architectural change — UI-only, composes existing design-system primitives;
> follows the [M2 architecture reference](./M2_HOUSEHOLD_WEALTH_ARCHITECTURE.md) and ADRs). **Slice:** M2-7.
> **Depends on:** M2-1 (FX in `@lcos/core`), M2-2 (household accounts), M2-3 (net worth + immutable snapshots).

## 1. Purpose

- **Goal.** A read-first **Family Balance Sheet** for a household in the advisor workspace: the consolidated
  net-worth position (net worth / assets / liabilities in the household base currency), the underlying
  holdings, an asset-class summary, and the net-worth **history**.
- **Relationship with M2-1/2/3.** The UI is a **thin presentation layer** over already-built backend:
  consolidated figures and history come from **M2-3** (`HouseholdNetWorthService` — immutable
  `NetWorthSnapshot`s); the holdings breakdown comes from **M2-2** (`/accounts`); all multi-currency math
  (**M2-1**) already happened server-side. **No net worth is (re)computed in the browser.**
- **Why it's the first consolidated wealth dashboard.** M1 delivered tenancy + the household shell; M2-2/2-3
  produced real, multi-currency wealth data. M2-7 is the first screen that **shows a family's whole position
  in one place** — the headline exit criterion of Module 2.

## 2. Information Architecture

Route: **`/app/households/[id]/balance-sheet`** (advisor workspace, under the `/app` firm shell).

| Element                            | Source                                         | Notes                                                                                           |
| ---------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Household selector**             | `/app/households` list + this route's `:id`    | Household chosen upstream; a "◂ Back to households" link + the household name header here.      |
| **Snapshot selector**              | M2-3 `/net-worth/timeline`                     | Dropdown of immutable snapshots (latest = "current"); default = latest.                         |
| **Net Worth summary**              | selected snapshot                              | `StatCard`s: Net worth, Total assets, Total liabilities + "as of {capturedAt}".                 |
| **Assets section**                 | M2-2 `/accounts` (current holdings)            | Table of asset accounts (name, class, native balance, currency). Labelled **current holdings**. |
| **Liabilities section**            | M2-2 `/accounts` (current holdings)            | Table of liability accounts.                                                                    |
| **Asset allocation summary**       | M2-2 `/accounts`                               | Asset **classes present** with account counts (FX-free; see §5).                                |
| **Currency indicator**             | `Household.baseCurrency` / snapshot `currency` | Base-currency `Badge` on the header + summary.                                                  |
| **Timeline / history entry point** | M2-3 `/net-worth/timeline`                     | Compact history table (date · net worth · assets · liabilities).                                |
| **Empty states**                   | —                                              | No snapshot yet → prompt (capture affordance for write roles); no accounts → "No holdings yet". |
| **Loading states**                 | —                                              | `LoadingState` / `DataTable loading` while fetching.                                            |
| **Error states**                   | —                                              | `ErrorState` (household 404 / fetch failure) with retry.                                        |

The household detail page's "Balance sheet" tab becomes a **link** to this route (was a disabled chip).

## 3. Data Flow

```
Browser (React page, /app/.../balance-sheet)
  │  apiGet(token)  — presentation only, no domain logic
  ▼
API  /api/households/:id/net-worth/timeline   ── primary (consolidated + history)
     /api/households/:id/accounts             ── secondary (current holdings breakdown)
  ▼
HouseholdScopeGuard  (household ∈ firm ∧ in caller scope; 404 otherwise)
  ▼
HouseholdNetWorthService (timeline) / HouseholdAccountsService (accounts)
  ▼
Snapshot repository (Prisma: NetWorthSnapshot, immutable) / Account repository
  ▼
Household aggregate (rows scoped by householdId/firmId)
```

**Boundaries.**

- **UI ↔ API:** HTTP + Bearer JWT via `@/lib/api`. The browser only **reads and formats** — it never sums
  across currencies or derives net worth.
- **API ↔ service:** the guard authorizes and scopes; controllers stay thin.
- **Service ↔ repository:** M2-3 reads immutable snapshots; M2-2 reads accounts. Both firm/household-scoped.
- **Repository ↔ aggregate:** every row belongs to the household aggregate root (ADR-001).

## 4. Snapshot Usage

- **Current vs historical.** The **latest** snapshot is the "current" balance sheet; older snapshots are
  "historical". Both are the same immutable row type, selected via the snapshot selector.
- **Immutable behavior.** Snapshots are read-only (ADR-004). The UI never edits or deletes them; selecting a
  different snapshot is a pure read.
- **Selection logic.** Default to the newest by `capturedAt`. The selector lists snapshots newest-first,
  labelling the newest as "Latest". Selecting one swaps the displayed summary; no refetch of others.
- **No recalculation while viewing history.** Displaying a snapshot shows its **stored** figures verbatim.
  Changing the selection never triggers a recompute; the browser does no aggregation. (The **holdings**
  section always reflects _current_ accounts and is labelled as such, so historical totals are never conflated
  with live account detail.)

## 5. Multi-Currency Rules

- **Household base currency.** Consolidated figures are already in `Household.baseCurrency` (server-side, M2-3).
  The UI reads `currency` off the snapshot and renders in that currency.
- **FX conversion source.** All FX happened server-side via `@lcos/core` + `FxService` (M2-1/2-3). **The UI
  performs no FX.**
- **Display currency rules.** Consolidated totals render in the base currency. Individual holdings render in
  their **native** currency (as stored) — never converted client-side.
- **Rounding.** Amounts are integer minor units from the API; the UI only formats for display
  (`Intl.NumberFormat`, currency-aware, no fractional digits) — it does not round for computation.
- **Unsupported currencies.** Currencies come from the backend's supported set; the UI renders whatever ISO
  code the API returns. A missing/unknown code falls back to a plain number + the raw code (no crash).

## 6. Performance Strategy

- **Avoid recomputing on every load.** The balance sheet reads **immutable snapshots**, not the live
  `/current` recompute — so a page load is a cheap indexed read, not an O(accounts) aggregation.
- **Read latest snapshot whenever available.** Default view = newest snapshot from the timeline (one query on
  the `(householdId, capturedAt)` index).
- **Cache strategy.** Client fetches once per mount; snapshot switching is in-memory (all snapshots already
  loaded from the timeline). No redundant refetch. (HTTP caching can be layered later.)
- **Pagination for history.** The timeline is small initially; when it grows, add `skip/take` pagination to
  the history table (the `{ total, data }` convention is already used elsewhere).
- **Future optimization.** Server-side "latest snapshot" endpoint; cached/materialized rollups; incremental
  history loading; ETag/If-None-Match on snapshot reads.

## 7. Security

- **Household isolation.** Every request is `HouseholdScopeGuard`-gated; out-of-scope/cross-firm → **404**.
  The UI is only the UX layer — the API is the boundary.
- **Authorization.** Viewing is available to any in-scope member (incl. `ANALYST`, read-only). The optional
  **capture-snapshot** affordance is shown only to write roles (`OWNER/ADVISOR/SUPPORT`) and delegates to the
  gated M2-3 `POST /net-worth/snapshot` — the browser performs no computation.
- **Read-only historical snapshots.** The UI exposes no edit/delete for snapshots; history is immutable.
- **Audit.** Reads are not audited; the (optional) snapshot capture is audited server-side by M2-3
  (`household.networth.snapshot` with `{ firmId, householdId }`). No new audit surface in the UI.

## 8. Future Extension Points

The page is composed so later modules slot in as **additional sections/tabs** without reworking it:

- **Cash Flow (M2-4)** — a cashflow section/tab beside the balance sheet.
- **Debt Dashboard (M2-5)** — a liabilities/payoff detail view linked from the Liabilities section.
- **Financial Snapshot seam (M2-6)** — richer per-snapshot detail (allocation/liquidity) once the seam exposes
  it, upgrading the allocation summary from "classes present" to FX-normalized percentages.
- **AI Insights (M4)** — a "run analysis" panel grounded on the snapshot.
- **Goal tracking / Retirement / Estate / Tax / Insurance dashboards** — sibling household tabs reusing the
  same shell, guard, and `@/lib/api` pattern.

Design rule: new sections consume **their own** household-scoped endpoints; the balance sheet does not grow
business logic.

## 9. Acceptance Criteria

- `/app/households/[id]/balance-sheet` renders for an in-scope member and is reachable from the household
  detail page.
- **Net Worth summary** shows net worth / assets / liabilities from the **selected immutable snapshot**, in the
  base currency, with the capture date and a currency indicator.
- **Snapshot selector** lists snapshots newest-first, defaults to latest, and switching is a pure client-side
  read (no recompute).
- **Assets** and **Liabilities** sections list current accounts (native currency) split by `isLiability`; the
  **allocation summary** shows asset classes present.
- **History** section lists past snapshots (date · net worth).
- **Empty** (no snapshot / no accounts), **loading**, and **error** states are handled.
- **No net worth is computed in the browser**; no cross-currency summation client-side; only immutable
  snapshots are read for consolidated figures.
- **No `apps/web/src/ui/*` changes**; composes existing primitives only.
- Web `tsc --noEmit` + `pnpm build` pass; lint passes; existing API tests unchanged (69/69); migrations clean
  (no schema change); Vercel preview green; no architecture drift.
