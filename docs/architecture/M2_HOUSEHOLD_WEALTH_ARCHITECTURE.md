# Module 2 — Household Wealth (Family Balance Sheet) — Architecture Reference

> **Status:** Active — the **single source of truth** for all Module 2 (Household Wealth) development.
> Every M2 feature (M2-1 … M2-7) is built against this document.
> **Builds on:** Module 1 (tenancy/firm shell, PRs #6–#12), the [Phase 2 blueprint](../blueprint/), and the
> [AI Engineering Workflow](../AI_ENGINEERING_WORKFLOW.md).
> **Scope note:** this documents the _target_ M2 architecture. Where something is not yet built it is marked
> **(planned)**; where it exists today it is described as-is.

---

## 1. Purpose

### What Module 2 solves

Module 1 delivered the multi-tenant backbone (firms → households → members/entities) but no wealth data at
household scope. **Module 2 makes a household's money real:** it brings the V2 finance engine (accounts, net
worth, cashflow, debt) into **household scope**, normalizes **multiple currencies** to the household's base
currency, and surfaces a **consolidated Family Balance Sheet with history**.

### Business objectives

- An advisor can see a household's **consolidated net worth** across all its accounts, entities, and
  currencies — a single correct number, plus assets/liabilities and allocation.
- A **net-worth timeline** shows how the household's position moves over time.
- Wealth data is assembled through **one grounding seam** (`FinancialSnapshot`) so later modules (scores,
  AI agents, reports) reason from identical, real numbers.
- Everything stays **tenant-isolated, audited, and encrypted** by default.

### Scope (in)

- FX conversion boundary in `@lcos/core` (**R-FX**).
- Household-scoped **accounts** (assets & liabilities, entity-owned), **net worth** + on-demand snapshots,
  **cashflow/budget**, **debt** + payoff.
- Multi-currency aggregation to `Household.baseCurrency`.
- Household-scoped **FinancialSnapshot** seam.
- Consolidated **Family Balance Sheet UI** + timeline (advisor `/app`).

### Scope (out — later milestones)

- Scores, early-warning, allocation drift, protection gap, persisted Top Actions — **M3**.
- AI agents (analyst/allocation) — **M4**.
- **Scheduled** snapshot jobs per firm cadence — needs the **M0** BullMQ/Redis worker; M2 ships _on-demand_
  capture only.
- Account Aggregator auto-sync (MOD-4.6), live FX provider, scenario simulator (MOD-5.7), client-portal
  views — later modules.
- Retail (`userId`-keyed) product changes — untouched.

---

## 2. Guiding Principles

| Principle                  | What it means for M2                                                                                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Household-first**        | Every wealth record is scoped to a `householdId` (and `firmId`); the household is the aggregation root. `HouseholdScopeGuard` is mandatory on every M2 route.                                                          |
| **Modular design**         | New code lives in focused NestJS modules (`*.controller/service/dto/module`) and pure `@lcos/core` functions; no god-services. FX math is pure and provider-agnostic.                                                  |
| **Small PRs**              | One M2 slice per PR, 200–500 lines where practical (workflow §3).                                                                                                                                                      |
| **Security by default**    | Deny-by-default guards; 404-not-403 for out-of-scope; PII encrypted; every mutation audited with `firmId`+`householdId`.                                                                                               |
| **Backward compatibility** | Additive only. Retail `userId` paths and existing tables are never reshaped; M1-6 scope columns are _promoted_ to relations (nullable, no backfill).                                                                   |
| **Performance**            | Aggregation is O(accounts); indexed scope columns (`householdId`/`firmId`/`entityId`); no N+1 (batch queries via `Promise.all`/`findMany`). Heavy/scheduled work is deferred to the M0 worker, never the request path. |
| **Scalability**            | Modular monolith + firm-scoped queries + RLS backstop; the worker process scales independently when M0 lands.                                                                                                          |
| **Testability**            | Pure core functions are unit-tested; every API surface has an e2e suite proving isolation + role gating + numeric correctness.                                                                                         |
| **Maintainability**        | One grounding seam (`FinancialSnapshot`); reuse over duplication; consistent DTO/serialization patterns; this document kept current.                                                                                   |

---

## 3. High-Level Architecture

```
                         ┌──────────────────────────────────────────────────────────┐
   Advisor (browser)     │                 Web App — Next.js (apps/web)             │
   /app/households/:id   │   /app shell → AppContext(firm) → household pages         │
        │  HTTPS + JWT   │   composes @/ui primitives (NetWorthChart, AllocationDonut)│
        │  (lcos_access) │   calls @/lib/api with Bearer token                       │
        ▼                └───────────────────────────┬──────────────────────────────┘
 ┌───────────────────────────────────────────────────▼──────────────────────────────┐
 │                          API — NestJS modular monolith (apps/api), prefix /api     │
 │                                                                                    │
 │  Global guards (order):  JwtAuthGuard ─► (route) FirmContextGuard / Household-      │
 │                          ScopeGuard ─► @FirmRoles ─► ThrottlerGuard ─► Validation   │
 │                                                                                    │
 │  ┌──────────────┐   ┌───────────────────────────┐   ┌───────────────────────────┐ │
 │  │ Household     │   │  Business services (M2)   │   │  Cross-cutting            │ │
 │  │ finance ctrls │──►│  household-accounts       │──►│  PrismaService (Postgres) │ │
 │  │ /households/  │   │  household-networth (+FX) │   │  CryptoService (PII)      │ │
 │  │  :id/accounts │   │  household-cashflow       │   │  AuditService (AuditLog)  │ │
 │  │  :id/net-worth│   │  household-debts          │   │  FxService (rate provider)│ │
 │  │  :id/cashflow │   │  household FinancialSnap-  │   └───────────────────────────┘ │
 │  │  :id/debts    │   │  shot seam                │                                  │
 │  └──────────────┘   └─────────────┬─────────────┘                                  │
 │                                   │ pure calls                                      │
 │                                   ▼                                                 │
 │                     @lcos/core: money + fx (R-FX) + computeNetWorth /               │
 │                     computeLiquidity / evaluateBudget / compareDebtStrategies       │
 └───────────────────────────────────┬────────────────────────────────────────────────┘
                                      │
              ┌───────────────────────▼───────────────────────┐   ┌────────────────────┐
              │  Postgres (Prisma, RLS lockdown)               │   │ Future (M0/M4)     │
              │  Account · Transaction · Debt · NetWorthSnap-  │   │ BullMQ worker      │
              │  shot · Goal · Household · Entity · AuditLog    │   │ (scheduled snaps,  │
              └────────────────────────────────────────────────┘   │  AI agents)        │
                                                                    └────────────────────┘
```

**Component responsibilities**

- **Web App** — presentational household pages composing `@/ui` primitives; no business logic; auth token
  from `localStorage 'lcos_access'`; firm context resolved by the `/app` layout.
- **API Layer** — NestJS controllers/services; thin controllers, business logic in services delegating to
  `@lcos/core`; explicit BigInt serialization at the boundary.
- **Authentication** — `JwtAuthGuard` (global, deny-by-default) with a **fresh per-request user lookup**
  (role/`activeFirmId` always current).
- **Authorization** — `FirmContextGuard` (firm membership) → `HouseholdScopeGuard` (household ∈ firm ∧ in
  caller's assigned scope) → `@FirmRoles` (role gate). API is the real boundary; UI only hides.
- **Household Context** — `req.firmContext` + `req.household` attached by the guards; the aggregation root
  for all M2 queries.
- **Business Services** — the M2 modules above; own persistence + FX + audit; call pure core functions.
- **Database** — Postgres via Prisma; RLS lockdown on every table; money as `BigInt` minor units.
- **Audit System** — `AuditService` writes append-only `AuditLog` rows (actor, action, entity, `firmId`,
  `householdId` in metadata) on every mutation.
- **Future AI Services** — consume the `FinancialSnapshot` seam (grounded, "never invent numbers"); run in
  the M0 worker; **not** in M2.

---

## 4. Domain Model

> M2 reuses the existing tables rather than inventing new ones. The business concepts below **map** to
> concrete Prisma models; the mapping is called out explicitly.

| Concept                    | Backing model                                                                                    | Ownership                                      | Lifecycle                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Household**              | `Household`                                                                                      | belongs to a `Firm`; assigned `advisorId`      | created by OWNER/ADVISOR; soft-deleted (`status='deleted'`); cascades children on hard delete |
| **Member**                 | `HouseholdMember`                                                                                | belongs to exactly one `Household`             | created/edited/removed by data-entry roles; optional `userId` for portal login (later)        |
| **Entity** (legal owner)   | `Entity`                                                                                         | belongs to one `Household`; carries `firmId`   | created by data-entry roles; owns accounts                                                    |
| **Asset**                  | `Account` where `isLiability=false`                                                              | scoped to `householdId`, optionally `entityId` | CRUD by data-entry roles; native `currency`; affects net worth (+)                            |
| **Investment**             | `Account` with `assetClass ∈ {equity,debt,gold,…}`                                               | same as Asset                                  | a classified Asset; feeds allocation + investment corpus                                      |
| **Liability**              | `Account` where `isLiability=true`                                                               | scoped to `householdId`                        | CRUD; affects net worth (−)                                                                   |
| **Loan**                   | `Debt`                                                                                           | scoped to `householdId`/`firmId`               | CRUD + payoff simulation; distinct from `Account` liabilities (carries rate + min payment)    |
| **Income**                 | `Transaction` `type='income'`                                                                    | scoped to `householdId` + `accountId`          | append/edit; feeds cashflow                                                                   |
| **Expense**                | `Transaction` `type='expense'`                                                                   | same                                           | append/edit; feeds cashflow/budget                                                            |
| **Cash Flow**              | derived from `Transaction`s via `evaluateBudget`                                                 | household                                      | computed, not stored                                                                          |
| **Goal**                   | `Goal`                                                                                           | scoped to `householdId`, optional `memberId`   | CRUD; surfaced with progress in M3                                                            |
| **Insurance / Protection** | `Profile` fields today (user-scoped); **household-level protection is (planned)** for M3/MOD-5.5 | —                                              | M2 does not add household protection; documented for continuity                               |
| **Snapshot**               | `NetWorthSnapshot`                                                                               | scoped to `householdId`/`firmId`               | **immutable** once captured; on-demand in M2, scheduled in M0                                 |
| **Net Worth**              | derived (`computeNetWorth`)                                                                      | household                                      | computed from current accounts, FX-normalized; not stored except as Snapshot                  |
| **Audit Log**              | `AuditLog`                                                                                       | firm-scoped (`firmId` in metadata/column)      | **append-only**; never updated or deleted                                                     |

**Relationships (target, after M2 relation-promotion)**

```
Firm 1───* Household 1───* HouseholdMember
                     1───* Entity 1───* Account
                     1───* Account 1───* Transaction
                     1───* Debt
                     1───* Goal (─? HouseholdMember)
                     1───* NetWorthSnapshot
Household/Firm ───* AuditLog (by firmId)
```

---

## 5. Database Design

### Primary tables (reused by M2)

`Account`, `Transaction`, `Debt`, `Goal`, `NetWorthSnapshot` (finance) + `Household`, `Entity`,
`HouseholdMember`, `AuditLog` (M1). **M2 adds no new tables.**

### Relationships

M1-6 added nullable scalar scope columns (`firmId?`, `householdId?`, `entityId?`, `memberId?`). **M2 promotes
the columns it consumes to typed Prisma relations** with explicit `onDelete`, and adds the matching
back-relations on `Household`/`Entity` (e.g. `Household.accounts`, `Entity.accounts`). Retail `userId`
relations remain untouched, so a row can be either retail (`userId` set, scope null) or advisory
(`householdId`/`firmId` set).

### Indexes

Every scope column is indexed (added in M1-6): `Account(firmId)`, `Account(householdId)`, `Account(entityId)`,
`Transaction(firmId|householdId)`, `Debt(firmId|householdId)`, `NetWorthSnapshot(firmId|householdId)`,
`Goal(firmId|householdId|memberId)`. Add composite indexes (e.g. `(householdId, capturedAt)` for timelines)
only when a query needs them.

### Migration strategy

- **Additive, reversible.** Relation promotion = `ADD CONSTRAINT … FOREIGN KEY` on already-nullable columns
  (nulls allowed → safe for retail rows). No backfill in M2; tighten to `NOT NULL` only later where invariant.
- Generate with `prisma migrate dev`; verify `migrate reset` (clean apply) + `migrate diff --exit-code`
  (no drift). No new tables ⇒ **no new RLS lockdown needed** (existing tables already locked).

### Encryption requirements

- **Encrypted at rest** (via `CryptoService`, AES-256-GCM): `Household.name`, `HouseholdMember.name`,
  `Entity.name`, `Entity.taxId` (M1). `Account`/`Debt` names are **not** currently encrypted (retail
  convention); if a name is treated as identifying PII at household scope, encrypt it and note it here.
- Monetary amounts are **not** encrypted (they're `BigInt`, not PII in isolation) but are tenant-isolated.

### Soft deletes

- `Household` uses `status='deleted'` (soft) — hidden from all reads, row retained. M2 finance records
  follow the household's lifecycle; prefer soft-delete/`status` for advisory records that must retain
  history, hard-delete only where no history value exists (mirror M1-5 member/entity delete).

### Audit fields

Standard row fields: `createdAt`/`updatedAt` where present. The durable audit trail is the separate
append-only `AuditLog` (not per-row history). `AuditLog.firmId` (added M1-6) should be **populated** by M2
mutations (currently `firmId` is written into `metadata`; promote it to the column when convenient).

### Versioning strategy

- **API:** additive within `/api`; breaking changes would go behind `/api/v2/*` (none expected in M2).
- **Snapshots as point-in-time versions:** the net-worth timeline is the household's versioned financial
  history — snapshots are immutable and append-only.
- **Schema:** Prisma migrations are the ordered, forward-only version history.

---

## 6. API Design

### REST endpoints (M2 surface, all under `HouseholdScopeGuard`)

```
GET/POST         /api/households/:id/accounts
PATCH/DELETE     /api/households/:id/accounts/:accountId
GET              /api/households/:id/net-worth/current
POST             /api/households/:id/net-worth/snapshot
GET              /api/households/:id/net-worth/timeline
GET/POST         /api/households/:id/cashflow            (transactions + budget)
GET/POST         /api/households/:id/debts   ·  GET /api/households/:id/debts/payoff-plan
```

- **Request validation** — `class-validator` DTOs + global `ValidationPipe` (`whitelist:true, transform:true`).
  Money in/out as integer minor units (`@IsInt`); currency as ISO code enum.
- **Error handling** — Nest exceptions map to standard HTTP; **404-not-403** for out-of-scope resources
  (never leak cross-tenant existence); `400` for validation/business-rule violations.
- **Pagination** — `skip`/`take` (default 25, cap 100), returning `{ total, data }` (matches
  `admin`/households list convention). Cursor pagination only where volume demands it.
- **Filtering / Sorting** — query params (`entityId`, `assetClass`, `status`, `from`/`to` dates);
  deterministic default order (`createdAt desc`, timelines `capturedAt asc`).
- **Response format** — plain JSON; **explicit `serialize()`** at the boundary converting `BigInt`→number for
  every money field (do not rely on the global patch, which is being retired).
- **HTTP status codes** — `200` read/update, `201` create, `200`+`{ok:true}` soft-delete, `400` invalid,
  `401` no/invalid token, `403` wrong role (in-scope), `404` out-of-scope/missing.
- **Authentication** — `Authorization: Bearer <access token>`; `@Public()` only for genuinely public routes.
- **Authorization** — `HouseholdScopeGuard` + `@FirmRoles(...)`; collection routes resolve the firm via
  `FirmContextGuard` (active firm from `x-firm-id`/`activeFirmId`).

---

## 7. Security Model

- **Role hierarchy** — global `User.role` (platform) × firm `Membership.firmRole`
  (`OWNER > ADVISOR/ANALYST/SUPPORT`) × resource scope. M2 writes: `OWNER/ADVISOR/SUPPORT` (data entry);
  **`ANALYST` is read-only**; reads: any in-scope member.
- **Household isolation** — enforced in `HouseholdScopeGuard` (household ∈ active firm ∧ in caller's assigned
  scope) **and** backstopped by RLS. Verified by an isolation e2e test per surface. No cross-tenant read/write.
- **Ownership rules** — a household owns all its finance records; an `Account` may additionally be owned by an
  `Entity` within the same household; a `Transaction` belongs to one `Account`; a resource is always verified
  to belong to the path household before update/delete (no reaching a record through the wrong household).
- **Permission model** — `@FirmRoles(...)` metadata enforced by the guard; read-scope intersection
  (OWNER/ANALYST firm-wide, ADVISOR/SUPPORT assigned-only) computed before the role check.
- **Audit logging** — every mutation → `AuditService.log({ actorId, actorRole, action, entityType, entityId,
metadata:{ firmId, householdId }, ip })`; `AuditLog` is append-only.
- **Encryption** — PII via `CryptoService` (AES-256-GCM, `iv:tag:ciphertext`); decrypt only at the response
  boundary. Key from `FIELD_ENCRYPTION_KEY` (KMS governance is an M0 hardening item).
- **Sensitive data handling** — never log decrypted PII or tokens; error responses never echo other tenants'
  data; 404 discipline prevents existence enumeration.
- **Secrets management** — env-only (`DATABASE_URL`, JWT secrets, `FIELD_ENCRYPTION_KEY`, provider keys);
  `assertProductionConfig` fails fast on dev secrets in prod; no secrets in code, logs, or commits.

---

## 8. UI Architecture

> Composes **existing** design-system primitives only. **`apps/web/src/ui/*` is never modified.** Chart
> components live in `apps/web/src/components/*` (not `ui/*`) and may be extended to accept a household-scoped
> data source.

- **Pages** — `/app/households/[id]/balance-sheet` (consolidated balance sheet + timeline + allocation);
  future household tabs (cashflow, debt) follow the same pattern.
- **Layouts** — the `/app` `DashboardLayout` shell + firm-scoped `Sidebar`; household detail sub-nav
  (`NavSection[]` data).
- **Navigation** — add the "Balance sheet" tab to the household detail nav (data only; `Sidebar` unchanged).
- **Reusable components** — `NetWorthChart`, `AllocationDonut` (extended to take a household base path),
  `@/ui` primitives below; `@/lib/api` for data.
- **Forms** — `Modal` + `Field`/`Input`/`Select`/`LabeledInput` (e.g. add account); disabled/`loading` on submit.
- **Tables** — `DataTable`/`Column` (accounts list, transactions) with built-in loading/empty.
- **Cards** — `Card`/`StatCard` (net worth, assets, liabilities KPI tiles).
- **Charts** — `NetWorthChart` (timeline), `AllocationDonut` (by asset class).
- **Dialogs** — `Modal` (portal, a11y, scroll-lock) for create/edit.
- **Loading states** — `LoadingState`/`Skeleton`/`DataTable loading`.
- **Empty states** — `EmptyState` ("No accounts yet…").
- **Error states** — `ErrorState` with retry.
- **Accessibility** — keyboard nav, focus rings (`ring` token), ARIA from primitives; charts have text
  fallbacks; preserve light/dark parity.
- **Responsive design** — mobile via `MobileNav` + responsive grids; wide tables/charts scroll in their own
  container; relative units; `max-width:100%` media.

---

## 9. Business Rules

1. **One household owns all its wealth records** (accounts, transactions, debts, goals, snapshots).
2. **Members belong to exactly one household.**
3. **Entities belong to exactly one household**; an account may be owned by an entity **within the same
   household** only.
4. **Goals belong to one household** (optionally linked to one member).
5. **Assets increase Net Worth; Liabilities (and `Debt`) decrease Net Worth.**
6. **Net worth is computed, not stored** — derived from current accounts, always FX-normalized to
   `Household.baseCurrency`.
7. **All aggregation converts to the household base currency first** — never sum mixed currencies
   (core `addMoney`/`sumMoney` throw on mismatch by design).
8. **Snapshots are immutable** — captured point-in-time; never updated or deleted; they are the net-worth
   history.
9. **Audit logs are append-only** — every advisor/admin mutation recorded; never mutated.
10. **Out-of-scope access returns 404, not 403** — existence never leaks across tenants or advisor books.
11. **`ANALYST` never writes** household wealth data; **`OWNER/ADVISOR/SUPPORT`** may (data entry).
12. **Retail (`userId`) records and code paths are never modified** by advisory features.
13. **A record is reachable only through its owning household** — verified before every update/delete.
14. **Soft-deleted households are invisible** to all reads; their finance records follow suit.

---

## 10. Data Flow

```
User request (browser, Bearer JWT)
        │
        ▼
API (NestJS controller, /api/households/:id/...)
        │
        ▼
Authentication      JwtAuthGuard — valid token? fresh user active?           → 401 if not
        │
        ▼
Authorization       FirmContextGuard / HouseholdScopeGuard — household ∈ firm │
                    ∧ in caller scope?  @FirmRoles — role allowed?            → 404 / 403 if not
        │
        ▼
Validation          ValidationPipe + DTO (whitelist, transform, types)        → 400 if invalid
        │
        ▼
Business logic      Service: load scoped rows (Prisma, indexed) → FX-convert  │
                    to base currency (@lcos/core fx) → compute (computeNetWorth│
                    / evaluateBudget / compareDebtStrategies) → persist        │
        │
        ▼
Database            Prisma (firm/household-scoped query; RLS backstop)
        │
        ▼
Audit               AuditService.log(actor, action, entity, {firmId, householdId}, ip)  (on mutation)
        │
        ▼
Response            serialize() — BigInt→number at the boundary → JSON (200/201)
```

Heavy or scheduled work (snapshot sweeps, AI runs) is **enqueued** to the M0 worker and continues out of the
request path, emitting domain events — never blocking the response.

---

## 11. Extension Points

Module 2's `FinancialSnapshot` seam and household-scoped services are the plug-in surface for later modules:

- **AI recommendations (M4)** — agents consume `FinancialSnapshot` (grounded, post-checked); `AgentRun`
  records each run. Never invent numbers.
- **Retirement planning** — `@lcos/core computeRetirement` already fed by the snapshot; surface per household.
- **Insurance analysis (M3, MOD-5.5)** — protection-gap from dependents + liabilities + cover; adds
  household-level protection data.
- **Estate / Tax / Family governance** — new household-scoped modules following the M2 controller/service
  pattern; reuse the guards + audit + FX.
- **Risk engine / Financial Health Score (M3)** — `@lcos/core scores` + early-warning from the same snapshot.
- **Notifications (M6)** — domain events from M2 mutations (e.g. `snapshot.captured`) fan out via the
  event bus.
- **Reports (M7)** — the report renderer reads the snapshot + timeline; branded PDF via the worker.
- **Integrations** — Account Aggregator (MOD-4.6) and a **live FX provider** plug in behind the existing
  provider interfaces (`FxRateProvider`, AA/Razorpay abstractions) without touching call sites.

**Design rule:** new modules depend on the _seam and the pure core functions_, not on each other.

---

## 12. Coding Standards

- **Naming** — files kebab/camel per NestJS convention; household modules prefixed `household-*`
  (e.g. `household-accounts.service.ts`) to distinguish from retail modules.
- **Folder structure** — API: `apps/api/src/households/*` for household finance; shared services in
  `apps/api/src/common/*`. Core: `packages/core/src/finance/*`. Web: `apps/web/src/app/app/households/*`.
- **Hooks (web)** — client components read firm context via `useApp()`; data via `@/lib/api`; guard
  `noUncheckedIndexedAccess` array access.
- **Services** — thin controllers; business logic in services; delegate math to `@lcos/core`; inject
  `PrismaService`/`CryptoService`/`AuditService`/`FxService`.
- **Repositories** — no separate repository layer; Prisma **is** the data layer, always firm/household-scoped
  in the service (RLS is the backstop, not the primary filter).
- **Components (web)** — compose `@/ui` primitives; never edit `ui/*`; charts in `components/*`.
- **Testing** — pure functions → unit tests (Vitest, `@lcos/core`); API surfaces → e2e (Jest+supertest)
  with isolation + role-gating + numeric-correctness cases.
- **Migrations** — additive; `migrate reset` + `migrate diff` clean before PR; new tables get RLS (none in M2).
- **Logging** — structured Nest logger; **never** log PII, tokens, or decrypted values.
- **Error handling** — throw typed Nest exceptions (`NotFound`/`Forbidden`/`BadRequest`); consistent 404
  discipline; no silent catches that hide failures.

---

## 13. Testing Strategy

| Layer                     | Tooling                                          | M2 coverage                                                                                                                     |
| ------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| **Unit**                  | Vitest (`@lcos/core`)                            | FX conversion + summation; net-worth/liquidity/budget/debt math; rounding & currency-mismatch cases.                            |
| **Integration (service)** | Jest                                             | household `FinancialSnapshot` assembler (multi-currency correctness, no double-count).                                          |
| **API**                   | Jest + supertest e2e                             | per surface: scoped CRUD, **cross-tenant/isolation → 404**, **ANALYST write → 403**, wrong-household → 404, numeric aggregates. |
| **UI**                    | `tsc --noEmit` + `next build` (+ Vercel preview) | balance-sheet page builds & typechecks; composes primitives; no `ui/*` diff. (No web unit suite in CI today.)                   |
| **Regression**            | full e2e suite each PR                           | existing 8 suites / 59 tests stay green; retail paths unchanged.                                                                |
| **Performance**           | manual/targeted                                  | aggregation is O(accounts) + indexed scope columns; watch for N+1; heavy work deferred to M0 worker.                            |
| **Security**              | e2e isolation + role tests; review               | isolation proven per surface; no PII in logs; 404 discipline; secrets in env only.                                              |

**Gate:** a PR is not opened until format/lint/type-check/migrations(up+no-drift)/unit/e2e/build are all green
(workflow §5).

---

## 14. Risks

| ID                 | Risk                                                                                   | Sev | Mitigation                                                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------- | :-: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R-FX**           | Mixed-currency sums without conversion → wrong net worth (NRI/multi-currency families) | 🔴  | FX boundary in `@lcos/core` (M2-1) **before** any aggregation; convert to base currency first; core throws on unconverted mismatch; unit-tested.                    |
| **R-FX-RATES**     | Rate source accuracy/staleness                                                         | 🟠  | Provider interface (`FxRateProvider`); static/config rates now (indicative), live provider later behind the same interface; store native currency, convert at read. |
| **R-SNAPSHOT-JOB** | Scheduled snapshots need the M0 worker (not built)                                     | 🟠  | Ship **on-demand** capture in M2; defer scheduling to M0; don't run sweeps in the request path.                                                                     |
| **R-SCHEMA-DRIFT** | Promoting scope columns to relations touches M1 models                                 | 🟠  | Additive FK on nullable columns (nulls allowed); back-relations only; `migrate diff` clean; retail rows unaffected.                                                 |
| **R-SCOPE**        | Advisor/analyst sees households outside assignment                                     | 🟠  | `HouseholdScopeGuard` scope intersection + per-surface isolation e2e; 404 discipline.                                                                               |
| **R-PRECISION**    | `BigInt`→`Number` boundary + FX rounding drift                                         | 🟡  | Explicit `serialize()`; round to minor units; document non-reversibility; assert within tolerance in tests.                                                         |
| **R-DOUBLE-COUNT** | Entity-owned accounts double-counted in household totals                               | 🟠  | Aggregate at household scope from the account set once; entities partition, don't duplicate; test with multi-entity households.                                     |
| **R-DESIGN**       | New screens fork the design system                                                     | 🟡  | Compose primitives only; charts in `components/*`; zero `ui/*` diff enforced in review.                                                                             |
| **R-ENTITLE**      | Premium gating drift                                                                   | 🟡  | If any M2 capability is premium (e.g. multi-currency), add a `FeatureKey` + `assertFeature`; gating test. (Base balance sheet is core, not gated.)                  |

---

## 15. Future Improvements (architectural backlog)

- **Live FX provider** (ECB/OpenExchangeRates) behind `FxRateProvider`, cached; historical rates for accurate
  back-dated snapshots.
- **Scheduled snapshots** per firm `reviewCadence` once the **M0** BullMQ/Redis worker exists.
- **Populate `AuditLog.firmId`** (and add `householdId`) columns; make the audit viewer tenant-scoped.
- **Tighten scope columns to `NOT NULL`** on advisory-only tables once fully populated; consider a
  `RecordScope` discriminator to formalize retail-vs-advisory.
- **Firm-scoped Prisma client extension** to inject `firmId` automatically (belt-and-suspenders with RLS)
  once the surface is large.
- **Materialized net-worth rollups** / cached aggregates if account volumes grow (perf).
- **Retire the global `BigInt.toJSON` patch** in favor of explicit boundary serialization everywhere
  (V2 R2).
- **Currency minor-unit precision** — generalize beyond the fixed `×100` assumption if a 0- or 3-decimal
  currency is ever added.
- **Event bus** for M2 domain events (`snapshot.captured`, `account.updated`) to feed M6 notifications and
  M4 agents.
- **Household protection model** (household-scoped insurance) to replace the user-scoped `Profile` fields for
  advisory households (M3).

---

_This document is maintained alongside Module 2 development. Update it in the same PR whenever an M2 change
diverges from what's written here (workflow §11.6)._
