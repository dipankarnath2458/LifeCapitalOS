# M4 — Dashboard Foundation — Design

> **Status:** Proposed (design only — awaiting approval before any code). **Module:** M4-1 (Dashboard
> Foundation for Wealth Health Check™). **Depends on:** M2-2/3/4 + M3-1 (read-only APIs). **Constraints:**
> presentation-only; **no Financial Kernel change, no ADR change, no renamed exports, no breaking API change,
> no new endpoints**; composes the **frozen** `@/ui` design system; reuses existing services. Companion:
> [`SYSTEM_ARCHITECTURE_V2`](./SYSTEM_ARCHITECTURE_V2.md), [`FUTURE_MODULE_CONTRACT`](./FUTURE_MODULE_CONTRACT.md).

## 1. Objectives

- Ship the **first production-quality customer dashboard** — the **home page after login** — that answers, at a
  glance: **"How financially healthy is my family?"**
- Establish the reusable **Dashboard Foundation** (layout, household selector, card system) that Wealth Health
  Check™ and future score modules plug into **without redesign**.
- **Consume existing APIs** for everything already available (net worth, health score, snapshot, family
  composition); render **placeholder cards** for scores not yet computed (Risk, Retirement, Insurance).
- **Do not** implement any score calculation. This is foundation + wiring, not new domain logic.
- Executive-grade feel: **professional, minimal, premium, fast, responsive, mobile-friendly.**

**Explicit non-goals:** no new backend, no kernel/ADR/schema change, no Risk/Retirement/Insurance score math,
no AI implementation (panel is a placeholder), no changes to `src/ui/*`.

## 2. User flow

```
Login ──▶ /app (Dashboard = new home)
   │        │
   │        ├─ AppLayout resolves active firm (existing behavior)
   │        ├─ Load the advisor's households  → GET /households
   │        ├─ Select the "current family": remembered (localStorage) or first household
   │        │
   │        ▼  (for the selected household, in parallel)
   │     GET /households/:id                     → family summary
   │     GET /households/:id/members             → members
   │     GET /households/:id/entities            → entities
   │     GET /households/:id/net-worth/current   → Net Worth summary
   │     GET /households/:id/health-score/current→ Wealth Health Score (overall + band)  [M3-1]
   │     GET /households/:id/financial-snapshot/latest    → snapshot presence + asset allocation
   │     GET /households/:id/financial-snapshot/timeline  → recent activity
   │     GET /households/:id/health-score/timeline        → recent activity
   │
   ▼
Render: family summary · net worth · wealth-health hero · score grid (live + placeholders) ·
        recent activity · quick actions · AI Family CFO (placeholder)
Switch family via the Household selector → selection persists → dashboard re-loads.
No snapshot yet → graceful CTA ("Capture a Financial Snapshot") instead of empty scores.
```

The current advisor **"Book overview"** (firm-level) relocates to **`/app/book`** (nav item kept) so nothing is
lost; `/app` becomes the family Dashboard as required.

## 3. UI hierarchy

```
DashboardLayout (existing shell, unchanged)
└─ DashboardPage (/app)
   ├─ Header:  "Wealth Health Check" · HouseholdSelector · baseCurrency badge
   ├─ FamilySummaryCard        (name · members · entities · advisor · status)
   ├─ Hero row (2-up, stacks on mobile)
   │   ├─ NetWorthCard         (net worth / assets / liabilities — M2-3 current)
   │   └─ WealthHealthScoreCard(overall 0–100 + band — M3-1 current; CTA if no snapshot)
   ├─ Score grid (responsive 1/2/3-col)
   │   ├─ AssetAllocationCard  (class mix % — from snapshot payload; "score pending")
   │   ├─ EmergencyFundCard    (liquidity sub-score from M3-1 if snapshot exists, else placeholder)
   │   ├─ RiskScoreCard        (placeholder — "Coming soon")
   │   ├─ RetirementScoreCard  (placeholder)
   │   └─ InsuranceScoreCard   (placeholder)
   ├─ Lower row (2-up)
   │   ├─ RecentActivity       (recent snapshots + saved scores)
   │   └─ QuickActions         (links to existing flows)
   └─ AiCfoPanel               (full-width placeholder — disabled input + teaser)
```

Design language: generous whitespace, one accent color, large numerals for the two headline metrics (net
worth + wealth health), muted supporting text, subtle card borders, skeleton loaders, mobile-first grid
(`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`).

## 4. Components (all presentation-only; compose `@/ui`)

| Component | Responsibility | Data source |
| --- | --- | --- |
| `HouseholdSelector` | pick the current family; persist selection | `GET /households` |
| `FamilySummaryCard` | family name, members, entities, advisor, status | `GET /households/:id`, `/members`, `/entities` |
| `NetWorthCard` | net worth / assets / liabilities (base currency) | `GET /net-worth/current` (M2-3) |
| `WealthHealthScoreCard` | headline 0–100 score + band; CTA when no snapshot | `GET /health-score/current` (M3-1) |
| `ScoreCard` (reusable) | uniform card: title, value-or-placeholder, status chip, hint | props |
| `AssetAllocationCard` | asset-class mix %; "weighted score pending" | `financial-snapshot/latest` payload `assetAllocation` |
| `EmergencyFundCard` | months-of-expenses / liquidity sub-score (read-only from M3-1) or placeholder | `health-score/current` category `liquidity` |
| `RiskScoreCard` / `RetirementScoreCard` / `InsuranceScoreCard` | placeholder score cards | — (placeholder) |
| `RecentActivity` | latest captured snapshots + saved scores, newest first | `financial-snapshot/timeline`, `health-score/timeline` |
| `QuickActions` | navigate to existing flows (capture snapshot, run what-if, view balance sheet, add account) | links to existing pages |
| `AiCfoPanel` | AI Family CFO™ teaser (disabled) | placeholder |

**Reuse note (FUTURE_MODULE_CONTRACT):** cards consume snapshot-backed reads; no card recomputes a score or
reads raw tables. `ScoreCard` is the single reusable primitive every future score module (Risk, Retirement,
Insurance…) will drop into — the extension seam.

## 5. API usage (all existing, read-only)

No new endpoints, no mutations added to the dashboard itself (Quick Actions **navigate** to existing pages;
"Capture snapshot" reuses the existing `POST /financial-snapshot`). Endpoints consumed:

- `GET /api/households` (selector + book)
- `GET /api/households/:id` · `/members` · `/entities`
- `GET /api/households/:id/net-worth/current`
- `GET /api/households/:id/health-score/current` and `/timeline` (M3-1)
- `GET /api/households/:id/financial-snapshot/latest` and `/timeline`

All are already firm/household-scoped by `HouseholdScopeGuard` server-side; the dashboard is the UX layer only.
Graceful degradation: any card whose source 404s/empties shows its own empty/placeholder state (never blocks
the page).

## 6. Folder structure (additive)

```
apps/web/src/
├─ app/app/
│  ├─ page.tsx                 # NEW: Dashboard (was "Book overview")
│  ├─ book/page.tsx            # MOVED: the existing advisor Book overview
│  └─ layout.tsx               # MINOR: add "Dashboard" + keep "Book overview"/"Households" nav
├─ components/dashboard/       # NEW: presentation-only dashboard components
│  ├─ HouseholdSelector.tsx
│  ├─ FamilySummaryCard.tsx
│  ├─ NetWorthCard.tsx
│  ├─ WealthHealthScoreCard.tsx
│  ├─ ScoreCard.tsx            # reusable score-card primitive
│  ├─ AssetAllocationCard.tsx
│  ├─ EmergencyFundCard.tsx
│  ├─ RecentActivity.tsx
│  ├─ QuickActions.tsx
│  └─ AiCfoPanel.tsx
└─ lib/
   └─ useCurrentHousehold.ts   # NEW: small hook — resolve/persist the selected household
```

`src/ui/*` (the design system) is **not touched**. `components/dashboard/*` compose `@/ui` primitives only.

## 7. Risks & mitigations

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Changing `/app` from Book overview to Dashboard could disorient advisors | Medium | Relocate Book overview to `/app/book`, keep it in nav; the Dashboard is the intended new home per spec. |
| Scores depend on a captured snapshot; a new family has none | Medium | Every score card degrades gracefully; a prominent CTA prompts "Capture a Financial Snapshot" (reuses existing flow). |
| Several parallel API calls per household | Low | All are O(1) reads; fire in parallel with skeletons; no N+1. Failures are isolated per card. |
| Placeholder cards look unfinished | Low | Uniform `ScoreCard` with a tasteful "Coming soon" state → premium, intentional look. |
| Mobile/responsiveness | Low | Mobile-first grid, `max-w`, `overflow-x-auto` where needed; test at sm/md/lg. |
| Scope creep into score calculation | Medium | Hard rule: consume existing APIs only; Risk/Retirement/Insurance stay placeholders; no new domain logic. |
| Design-system drift | Low | Compose `@/ui` only; no edits to `src/ui/*`. |
| "Customer" vs advisor framing | Low | Foundation is household-scoped with a selector; works for the advisor-operated model today and for a future client login unchanged. |

## 8. Acceptance criteria (for the eventual implementation PR)

- `/app` renders the Dashboard as the post-login home; Book overview reachable at `/app/book`.
- Household selector switches families and **persists** the selection.
- Family summary, Net Worth, and Wealth Health Score render **live** from existing APIs; Asset Allocation and
  Emergency Fund render from existing snapshot/health-score reads (or degrade gracefully).
- Risk / Retirement / Insurance and the AI Family CFO panel render as **placeholders** (no fake numbers).
- Recent Activity + Quick Actions functional against existing endpoints/pages.
- No `src/ui/*` change; no backend/kernel/ADR change; no new endpoint; web `tsc` + `build` + lint green;
  Vercel preview healthy; responsive at mobile/tablet/desktop.

## 9. Extension points

- **`ScoreCard`** is the drop-in for every future score (Risk M4-x, Retirement, Insurance) — a module ships its
  score API + swaps its placeholder card for a live one; the dashboard layout is unchanged.
- **`AiCfoPanel`** becomes live when the M4 AI fleet lands, grounded via the `AI_GROUNDING_CONTRACT` — no
  dashboard redesign.
- **`members[]`** (pre-M4 hardening) already flows in the snapshot payload, ready for Retirement/Insurance cards.
