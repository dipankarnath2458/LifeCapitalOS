# 03 — Navigation Structure

> **Doc:** Information architecture & routing. **Status:** Draft for review.
> **Related:** [Modules](./02_MODULES.md) · [Roles](./04_ROLES_PERMISSIONS.md)

This defines every surface, its route, and how users move between them. It **reuses the existing
design-system layout primitives** — `DashboardLayout`, `Sidebar`, `TopNav`, `MobileNav`, and the
`NavSection`/`NavItem` types in `apps/web/src/ui/layout/` — with **no changes to those components**.
New navigation is expressed purely as data (`NavSection[]`) passed into the existing `Sidebar`.

---

## 1. Three top-level experiences (one app, three shells)

Route prefixes keep the surfaces cleanly separated and role-gated. All are the same Next.js app
sharing the design system and `@lcos/core`.

| Experience | Prefix | Audience | Shell |
|---|---|---|---|
| **Advisor Workspace** | `/app/*` | Advisor, Analyst, Support, Firm Owner | `DashboardLayout` + firm-scoped `Sidebar` |
| **Client Portal** | `/portal/*` | Household client users | `DashboardLayout` + slim client `Sidebar` |
| **Platform Admin** | `/admin/*` (V2) | Platform Admin / Superadmin | existing `AdminShell` |
| **Public** | `/`, `/login`, `/tools/*` (V2) | Visitors / lead-gen | landing + public tools |

The existing V2 routes (`/`, `/login`, `/onboarding`, `/dashboard`, `/billing`, `/admin/*`) remain.
Phase 2 introduces `/app/*` (advisor) and `/portal/*` (client) as the primary new shells. The legacy
single-user `/dashboard` is retained for the free B2C tier and gradually folded into `/portal`.

---

## 2. Advisor Workspace — `/app/*`

Two navigation levels: a **firm-level** sidebar (the book) and, when a household is open, a
**household-level** sidebar (the family). This is the "list → detail" pattern.

### 2.1 Firm-level sidebar (`NavSection[]`)

```
Firm: {Firm Name}                       ← brand slot (MOD-1.4)
─────────────────────────────
OVERVIEW
  ▸ Home / Book overview      /app
  ▸ Households                /app/households
  ▸ Tasks                     /app/tasks               [badge: due today]
  ▸ Documents                 /app/documents
  ▸ Notifications             /app/notifications        [badge: unread]
INSIGHTS
  ▸ Alerts / Early warning    /app/alerts               [badge: at-risk]
  ▸ AI runs                   /app/ai
  ▸ Reports                   /app/reports
FIRM
  ▸ Advisors & seats          /app/firm/team            (owner)
  ▸ Firm settings             /app/firm/settings        (owner)
  ▸ Billing                   /app/firm/billing         (owner)
─────────────────────────────
[User card] {advisor} · switch firm · sign out   ← footer slot
```

### 2.2 Household detail (`/app/households/[householdId]/*`)

When an advisor opens a household, the sidebar switches to a **household-scoped** section (a
back-link returns to the book). Tabs map 1:1 to modules:

```
◂ Back to households
{Household Name}
─────────────────────────────
  ▸ Overview        /app/households/[id]                 (MOD-3, dashboard)
  ▸ Balance sheet   /app/households/[id]/balance-sheet   (MOD-4)
  ▸ Cashflow        /app/households/[id]/cashflow        (MOD-4.3)
  ▸ Goals           /app/households/[id]/goals           (MOD-5.1)
  ▸ Scores          /app/households/[id]/scores          (MOD-5.2/5.3)
  ▸ Allocation      /app/households/[id]/allocation      (MOD-5.4)
  ▸ Protection      /app/households/[id]/protection      (MOD-5.5)
  ▸ Members         /app/households/[id]/members         (MOD-3.2)
  ▸ Entities        /app/households/[id]/entities        (MOD-3.3)
  ▸ Documents       /app/households/[id]/documents       (MOD-7)
  ▸ Tasks           /app/households/[id]/tasks           (MOD-8)
  ▸ AI analysis     /app/households/[id]/ai              (MOD-6)
  ▸ Reports         /app/households/[id]/reports         (MOD-10.1)
  ▸ Timeline        /app/households/[id]/timeline        (MOD-8.5)
  ▸ Consents        /app/households/[id]/consents        (MOD-13)
```

### 2.3 Key advisor screens (detail)

| Screen | Purpose | Primitives used |
|---|---|---|
| Book overview `/app` | KPI tiles (households, at-risk, tasks due, AUM proxy) + at-risk list + activity feed | `Card`, `Table`, `Badge`, stat tiles |
| Households `/app/households` | Searchable/sortable table of the book; filters (advisor, risk band, plan) | `Table`, `Pager`, `Input`, `Badge` |
| Household Overview | Snapshot: net worth, score, top actions, recent docs/tasks, run-analysis button | `Card`, charts (`NetWorthChart`, `AllocationDonut`) |
| Tasks `/app/tasks` | Cross-household task list; group by due/priority; quick-complete | `Table`, `Badge`, `Modal` |
| Documents `/app/documents` | Cross-household document library + requests | `Table`, `Modal`, upload widget |
| Alerts `/app/alerts` | Early-warning signals across the book, sortable by severity | `Table`, `Status`, `Badge` |
| Reports `/app/reports` | Generate / schedule / download household & firm reports | `Table`, `Modal`, `Button` |
| Firm team `/app/firm/team` | Invite/manage advisors, seats, roles | `Table`, `Modal` |

---

## 3. Client Portal — `/portal/*`

Calm, read-mostly, single-household by default (a client belongs to one household). Slim sidebar:

```
{Family Name}
─────────────────────────────
  ▸ Overview       /portal                 (MOD-11.1: net worth, score, goals)
  ▸ Balance sheet  /portal/balance-sheet    (read-only)
  ▸ Goals          /portal/goals
  ▸ Documents      /portal/documents        (view + fulfill requests)  [badge: requested]
  ▸ Approvals      /portal/approvals        [badge: pending]
  ▸ Messages       /portal/messages         [badge: unread]
  ▸ Consents       /portal/consents
─────────────────────────────
[User card] {family member} · sign out
```

Client screens are deliberately fewer and lower-density than the advisor workspace. No firm data,
no other households, no destructive actions.

---

## 4. Platform Admin — `/admin/*` (V2, extended)

Keeps the existing V2 admin routes and `AdminShell`; adds firm provisioning.

```
  ▸ Dashboard / metrics   /admin                 (V2)
  ▸ Firms                 /admin/firms           (NEW — provision/suspend firms)
  ▸ Users                 /admin/users           (V2)
  ▸ Plans                 /admin/plans           (V2, + firm plans)
  ▸ Flags                 /admin/flags           (V2)
  ▸ Audit                 /admin/audit           (V2)
```

---

## 5. Public / lead-gen (V2, unchanged)

```
  ▸ Landing               /                      (V2)
  ▸ Login / signup        /login                 (V2)
  ▸ Public tools          /tools/*               (V2 — Wealth Health Check, Retirement, etc.)
  ▸ Onboarding            /onboarding            (V2 — routed by role after first login)
```

---

## 6. Cross-cutting navigation elements

| Element | Behavior | Source |
|---|---|---|
| **Global search** (`/app`) | Jump to a household, document, or task | new `Input`-based command palette (composed from primitives) |
| **Notification bell** (TopNav) | Unread count → `/app/notifications` or `/portal` inbox | MOD-9.1 |
| **Firm switcher** (footer) | For users in >1 firm; sets active `firmId` context | MOD-1.5 |
| **Theme toggle** | Light/dark | existing `ThemeToggle` (unchanged) |
| **Breadcrumbs** | Firm ▸ Household ▸ Tab on advisor detail routes | composed, no new component |
| **Active-route highlight** | Handled by existing `Sidebar` `isActive` logic | unchanged |

---

## 7. Routing rules & guards

1. **Role/route mapping** is enforced server-side (`RolesGuard` + firm membership) — the client
   nav only *shows* what a role can reach; the API is the real boundary (same pattern as V2 admin).
2. `/app/*` requires an **advisor-class** firm role; `/portal/*` requires a **client** role scoped
   to a household; `/admin/*` requires platform admin roles (V2).
3. **Firm context** (`firmId`) is resolved from membership on entry to `/app/*`; every data call is
   firm-scoped (NFR-2).
4. **Household context** (`householdId`) is validated to belong to the active firm before any
   household route renders.
5. First-login routing (`/onboarding`): advisors → firm setup / first household; clients → portal
   welcome; retail free users → legacy `/dashboard`.

---

## 8. Responsive & accessibility notes

- Desktop: persistent `Sidebar` (md+). Mobile: `MobileNav` drawer — both already in the design
  system; new nav is just data fed to them.
- All new screens preserve keyboard nav, focus rings (`ring` token), and light/dark parity that the
  design system provides. No new color tokens or component variants are introduced.
