# Project Memory

> Durable decisions, conventions, and gotchas that survive across sessions. **Updated after every merged
> PR** per the [AI Engineering Workflow](./docs/AI_ENGINEERING_WORKFLOW.md). Keep it terse and factual.

## Architecture (as built)

- **Permanent V2 architecture docs** (post-M2, reflect the implementation — read these first for the big
  picture): [`SYSTEM_ARCHITECTURE_V2.md`](./docs/architecture/SYSTEM_ARCHITECTURE_V2.md) (component/domain/
  data-flow/module-dependency diagrams + pre-M3 review), [`FINANCIAL_KERNEL_ARCHITECTURE.md`](./docs/architecture/FINANCIAL_KERNEL_ARCHITECTURE.md)
  (engines + snapshot lifecycle), [`AI_INTEGRATION_ARCHITECTURE.md`](./docs/architecture/AI_INTEGRATION_ARCHITECTURE.md),
  [`EXTENSION_GUIDELINES.md`](./docs/architecture/EXTENSION_GUIDELINES.md) (future-module validation + explicit
  per-module extension points), [`FUTURE_MODULE_CONTRACT.md`](./docs/architecture/FUTURE_MODULE_CONTRACT.md)
  (**normative** READ allowlist / WRITE prohibitions — a future module reads consolidated truth only from
  snapshots, writes only its own tables, never mutates the kernel/engines),
  [`ADR-FINANCIAL-KERNEL.md`](./docs/architecture/ADR-FINANCIAL-KERNEL.md). `SYSTEM_ARCHITECTURE_V2.md` §10 has
  new-engineer onboarding diagrams. Slice-level ADRs stay in
  [`M2_HOUSEHOLD_WEALTH_ARCHITECTURE.md`](./docs/architecture/M2_HOUSEHOLD_WEALTH_ARCHITECTURE.md) (ADR-001…012).
- **Kernel is FROZEN (governance).** Module 2 released as `v2.0.0-financial-kernel`
  ([release notes](./docs/releases/RELEASE_v2_FINANCIAL_KERNEL.md)). Binding rules in
  [`KERNEL_GOVERNANCE.md`](./docs/architecture/KERNEL_GOVERNANCE.md): `FinancialSnapshot` append-only;
  `schemaVersion 1` field meanings/types/names **immutable** (old snapshots never rewritten); future modules
  **consume snapshots, not raw tables**; **any kernel/core schema change requires an ADR + architecture review
  first**; backward compatibility (additive-only) must be preserved. Recommended release tag not yet cut
  (awaiting approval).
- **M3-1 Financial Health Score (implemented, first kernel consumer):** design in
  [`M3_FINANCIAL_HEALTH_DESIGN.md`](./docs/architecture/M3_FINANCIAL_HEALTH_DESIGN.md). Pure core
  `computeFinancialHealthScore(payload, model)` in `@lcos/core/finance/financialHealth.ts` (model
  `fhs-1.0.0`): 5 weighted categories (net_worth 25, debt_burden 25, savings 20, liquidity 20, diversification
  10), each a monotonic piecewise-linear anchor map → explainable sub-score with metric/reason/suggestion;
  overall bands at_risk/needs_attention/fair/good/excellent. **Deterministic, no IO/clock/random.** NOTE:
  the kernel's `netWorth.solvencyRatio` is **net worth ÷ assets** (≤1), not assets÷liabilities — anchors set
  accordingly. Service `HouseholdHealthScoreService` depends **only** on `HouseholdFinancialSnapshotService`
  (reads immutable `latest()`/`getById()` snapshots — never engine repos), Prisma (own table), audit. Routes
  household-scoped: `GET /health-score/current` (live preview, not persisted; `{available:false}` if no
  snapshot), `POST /health-score` (persist, OWNER/ADVISOR/SUPPORT), `GET /health-score/{latest,timeline,:id}`.
  Own additive **RLS-locked** `FinancialHealthScore` table (references `snapshotId`; **no kernel change** —
  verified purely additive, `FinancialSnapshot`/engines untouched). Minimal UI
  `/app/households/[id]/health-score`. Reproducibility asserted (same snapshot ⇒ identical score after
  mutations). This is the reusable M3+ consumer template (FUTURE_MODULE_CONTRACT compliant).
- **M3-2 Explainable Financial Health Engine (additive over M3-1):** design in
  [`M3-2_HEALTH_EXPLANATION_DESIGN.md`](./docs/architecture/M3-2_HEALTH_EXPLANATION_DESIGN.md). Pure core
  `explainFinancialHealth(score, payload?)` in `@lcos/core/finance/financialHealthExplanation.ts` — **consumes**
  an existing `FinancialHealthScore`, **never recomputes a score** (reads `categories[].weight/score` directly,
  doesn't need the anchors). Returns `HealthExplanation`: summary, categoryBreakdown (pointsContributed/
  pointsLost = ±score·weight/Σweight), strengths/weaknesses (partition at 75), recommendations (title,
  description, affectedCategory, priority high/med/low, priorityRank, estimatedScoreImprovement =
  (90−score)·weight/Σweight, financialImpact {summary, gapMinor from snapshot}, recommendedAction, reasonCode),
  priorityRanking, potentialScoreImprovement (capped so overall≤100), confidence (data completeness), stable
  `reasonCodes[]` (AI contract). **Deterministic, no LLM, no persistence, no DB/schema/kernel change** (verified:
  0 new migrations; schema.prisma, kernel, and M3-1 financialHealth.ts all unchanged). Service
  `HouseholdHealthExplanationService` depends only on `HouseholdHealthScoreService` (get the score) +
  `HouseholdFinancialSnapshotService` (immutable payload). Read-only routes under
  `/households/:id/health-score/explanation/{current,latest,:scoreId}` (any in-scope member incl. analyst; 404
  out-of-scope). UI: explanation surfaced on the health-score page (recommendations + potential + confidence).
  This is the grounding contract for the M4 AI Wealth Advisor.
- **Monorepo** (pnpm + turbo): `apps/api` (NestJS 10 modular monolith, global `/api`), `apps/web`
  (Next.js + Tailwind), `packages/core` (`@lcos/core` pure finance/scoring), `packages/config`.
- **DB:** Postgres via Prisma. Money = `BigInt` minor units. PII = AES-256-GCM via `CryptoService`
  (format `iv:tag:ciphertext`, hex). RLS lockdown on every table (RLS on, no policies; Prisma owner role
  bypasses — closes the PostgREST surface).
- **Auth:** JWT access token in `localStorage 'lcos_access'`; deny-by-default global `JwtAuthGuard` with a
  fresh per-request user lookup (so role/`activeFirmId` are always current); `RolesGuard` for global roles.
- **CI:** `.github/workflows/ci.yml` — Postgres 16 service; install → prisma generate → build → lint →
  core tests → `prisma migrate deploy` → seed → API e2e. Env: `DATABASE_URL`, `FIELD_ENCRYPTION_KEY`
  (all-zero test key), `SANDBOX_RETURN_SECRETS=true`.

## Multi-tenancy model (Module 1)

- **Two authority axes:** global `User.role` × firm-scoped `Membership.firmRole` (`OWNER/ADVISOR/ANALYST/
SUPPORT`) × resource scope (`Household.advisorId` / `HouseholdMember` link).
- **`FirmContextGuard`** (`apps/api/src/firms/`): resolves the active firm from route param `:id`/`:firmId`,
  `x-firm-id` header, or `User.activeFirmId`; requires an **active** membership; a non-member gets **404**
  (no cross-tenant existence leak); enforces `@FirmRoles(...)`. Attaches `req.firmContext`.
- **`HouseholdScopeGuard`** (`apps/api/src/households/`): resolves household → its firm → active membership,
  then intersects read scope with assignment (OWNER/ANALYST = firm-wide; ADVISOR/SUPPORT = assigned only).
  Out-of-scope/cross-firm → **404**. Attaches `req.firmContext` + `req.household`.
- **404-not-403 discipline:** hide existence of tenants/households a caller can't see.
- **Data-entry write roles** for household sub-resources = `OWNER/ADVISOR/SUPPORT`; `ANALYST` is read-only.
- **Firm-scoped audit:** mutations write `AuditLog` with `firmId` in `metadata` (the `AuditLog.firmId`
  column was added in M1-6 and is not yet populated — wire it when convenient).

## Key decisions

- **Retail tier kept; no backfill.** M1 columns are additive + nullable; existing `userId`-keyed retail
  paths are untouched. Do **not** migrate retail users into households implicitly.
- **Firm provisioning is platform-admin-only** (`POST /api/firms` seats an `OWNER`). Self-serve firm signup
  deferred.
- **Advisor invitations = existing users only** (pending `Membership` + self-accept). New-user email-token
  invites depend on the M0 email transport — deferred.
- **M1-6 scoping columns are plain scalars** (not FK relations) for reversibility; **M2 promotes** the ones
  it consumes to typed relations with explicit `onDelete`.
- **Firm context in the web `/app` shell** is set by `POST /firms/:id/switch` only when it changed, so
  household calls scope off server-side `activeFirmId` — no custom fetch headers; `lib/api.ts` untouched.
- **Design system frozen:** `apps/web/src/ui/*` is never edited; screens compose primitives; nav is
  `NavSection[]` data.

## Module 2 (household wealth) decisions

- **M2 architecture reference** is the source of truth:
  [`docs/architecture/M2_HOUSEHOLD_WEALTH_ARCHITECTURE.md`](./docs/architecture/M2_HOUSEHOLD_WEALTH_ARCHITECTURE.md)
  (16 sections incl. ADR-001..010). Update it in the same PR when an M2 change diverges.
- **FX only in the domain layer (ADR-003, M2-1):** `@lcos/core/fx.ts` — `FxRateProvider`,
  `convertMoney`/`convertMinor`/`sumInBaseCurrency`. `money.ts` throws on mixed currencies; store native
  currency, convert to household base **at aggregation**. Rates via provider (static `StaticFxRateProvider`
  now; live later). All supported currencies use 100 minor units/major, so conversion applies the major-unit
  rate directly to minor units.
- **`Account.userId` relaxed to nullable (M2-2):** a row is **either** retail (`userId` set) **or** advisory
  (`householdId` set). Same pattern will apply to `Transaction`/`Debt`/`NetWorthSnapshot` when M2-3/4/5 scope
  them. Relaxing NOT NULL is backward-compatible (existing rows keep `userId`).
- **Scope columns → relations (M2-2):** `Account.householdId` → `Household` (`onDelete: Cascade`),
  `Account.entityId` → `Entity` (`onDelete: SetNull`); `firmId` kept as an indexed scalar. Back-relations
  `Household.accounts` / `Entity.accounts` added.
- **Household finance module pattern:** `apps/api/src/households/household-<resource>.{controller,service,dto}.ts`,
  mounted at `/api/households/:id/<resource>`, under `HouseholdScopeGuard`; writes gated to
  `OWNER/ADVISOR/SUPPORT` (analyst read-only); a sub-resource is verified to belong to the path household
  before update/delete; every mutation audited with `{ firmId, householdId }`. Native-currency accounts stored
  as-is; hard delete (history lives in snapshots, not per-account).
- **`schema.prisma` is not `prettier`/`prisma format` canonical** on `main` and no gate enforces it — do **not**
  run `prisma format` (it reformats the whole file → large unrelated diff). Edit models by hand matching local
  style. Prettier has no `.prisma` parser (schema.prisma is skipped by `prettier --check .`).
- **Family Balance Sheet UI (M2-7):** `/app/households/[id]/balance-sheet` (advisor `/app`). **Presentation
  only** — reads M2-3 `/net-worth/timeline` (immutable snapshots) for the consolidated summary + history and
  M2-2 `/accounts` for the current-holdings breakdown; **never computes/converts net worth in the browser**
  (no cross-currency summation client-side). Snapshot selector defaults to newest; historical views are
  read-only; an optional "Capture snapshot" affordance (write roles) delegates to the M2-3 POST. Composes
  `@/ui` primitives only (**no `ui/*` changes**); money formatted via `Intl.NumberFormat` (display only).
  Household detail page links to it (the "Balance sheet" chip is now live). Design:
  [`docs/architecture/M2_FAMILY_BALANCE_SHEET_UI.md`](./docs/architecture/M2_FAMILY_BALANCE_SHEET_UI.md).
- **Cashflow & budget engine (M2-4):** the household `Transaction` ledger is the **single source of truth**
  for financial activity — future modules (M2-5 debt, M2-6 seam, statements, goals…) **consume its service
  summaries** rather than re-aggregating. Types `income|expense|transfer|adjustment` (`adjustment` added
  additively); `transfer`/`adjustment`/`void` are **excluded** from income/expense (core `summarizeCashflow`).
  Store **native** currency + `baseCurrency` reference; **no converted amount stored** — convert at aggregation
  via `FxService`/`convertMinor` (ADR-003). `Transaction.userId` relaxed nullable + `householdId`→`Household`
  relation (mirrors M2-2/2-3); added `baseCurrency`/`tags`/`status`/`createdById`/`updatedById` +
  `(householdId, occurredAt)` index. **Budget engine:** `Budget` (one per `(householdId, periodMonth 'YYYY-MM')`,
  optional overall cap) + `BudgetLine` (per-category envelope, unique `(budgetId, category)`); POST **upserts**
  (replaces the envelope set in a `$transaction`); budget-vs-actual pulls live actuals from the ledger and runs
  core `evaluateBudget`. Routes mounted household-scoped (`/households/:id/cashflow`, `.../cashflow/summary`,
  `.../cashflow/timeline`, `/households/:id/budget`) under `HouseholdScopeGuard`; writes `OWNER/ADVISOR/SUPPORT`
  (spec's "SUPERVISOR" maps to `SUPPORT` — no such role, avoid drift), analyst read-only. New tables get RLS
  lockdown. Minimal UI: `/app/households/[id]/cashflow` (month summary + ledger + add-form + budget-vs-actual),
  presentation-only. Design:
  [`docs/architecture/M2_CASHFLOW_ENGINE.md`](./docs/architecture/M2_CASHFLOW_ENGINE.md).
- **Debt & payoff engine (M2-5, ADR-011):** `Debt` is a **detailed liability ledger parallel to the M2-3
  net-worth accounts** — M2-5 **does not change how net worth is computed** (accounts stay the net-worth
  liability source), so debt and liability accounts **don't double-count**; the **M2-6 seam** reconciles them.
  Reuses core `simulateDebtPayoff` + new `summarizeDebt` (outstanding-weighted avg rate, by type); FX per debt
  via `FxService`/`convertMinor` (ADR-003). Schema (additive): `DebtType += business_loan`; new enums
  `DebtStatus` (`active|closed|written_off|archived`) + `DebtPaymentType` (`emi|extra|prepayment|foreclosure`);
  `Debt.userId` relaxed nullable + `householdId`→`Household` relation + `entityId`→`Entity` (`SetNull`,
  entity-owned); added `secured`/`lender`/`outstandingMinor`(current vs `principalMinor` original)/`emiMinor`/
  lifecycle dates/`status`/provenance + `(householdId, status)` index. New tables **`DebtPayment`** (principal
  reduces `outstandingMinor`; foreclosure → `closed`; optional `transactionId` link to the M2-4 ledger — reuse,
  not duplicate) and immutable **`DebtSnapshot`** (create-only per ADR-004; `breakdown` JSON freezes per-debt
  detail; mirrors `NetWorthSnapshot`). Routes household-scoped under `HouseholdScopeGuard`
  (`/households/:id/debts` CRUD, `.../debts/summary`, `.../debts/payoff?strategy=&extraMonthlyMinor=`,
  `.../debts/:debtId/payments`, `.../debts/snapshot`, `.../debts/timeline`); writes `OWNER/ADVISOR/SUPPORT`,
  analyst read-only; audited. Only `active` debts feed summary/payoff/snapshot. New tables get RLS lockdown.
  Minimal UI: `/app/households/[id]/debt` (summary + list + add-form + payoff projection), presentation-only.
  Design: [`docs/architecture/M2-5_DEBT_DESIGN.md`](./docs/architecture/M2-5_DEBT_DESIGN.md).
- **Financial Snapshot kernel (M2-6, ADR-012):** the **canonical read model** — an **immutable, versioned,
  checksummed** `FinancialSnapshot` that **composes** M2-2…M2-5 (accounts, net worth, cashflow/budget, debt) into
  one base-currency payload. **Every future module (and all AI) reads snapshots, never raw tables, and never
  re-aggregates** — the seam introduces **no new aggregation math** (it calls the existing services + core FX).
  Envelope: `id`/`householdId`/`entityId?`(reserved, null in v1)/`capturedAt`/`snapshotVersion`(ordinal, per
  household)/`schemaVersion`(=1, the payload **contract** consumers pin to)/`engineVersion`(`m2-6.x`)/`fxVersion`
  (from `FxService.version`, `static-v1`)/`generatedBy`/`checksum`(SHA-256 over **canonical** JSON — sorted keys,
  in core `canonicalStringify`)/`status`/`provenance`/`payload`. Payload (`schemaVersion 1`): netWorth, assets,
  liabilities, debt, cashflowSummary, budgetSummary, assetAllocation, currencyExposure, **householdEquity**
  (reconciles M2-3 net worth vs M2-5 debt — `reconciledEquityMinor = netWorth − totalDebt`; the one place the two
  liability views unify, resolving ADR-011), entityHoldings, relationships (ids/counts only — **no PII**, ADR-006).
  **Immutable** (ADR-004): capture inserts a new row; **no update/delete**; reading a stored snapshot returns it
  **verbatim** (proven by an e2e reproducibility test — checksum/net worth unchanged after later mutations). The
  **only** live path is `GET …/financial-snapshot/current` (composed preview, **never persisted**, no id/checksum).
  Schema evolution is **additive-only**; breaking → bump `schemaVersion` (old rows never rewritten) + `upgradePayload`
  registry (identity for v1) in core. Routes household-scoped under `HouseholdScopeGuard`: `POST` (capture,
  OWNER/ADVISOR/SUPPORT, audited), `GET current|latest|timeline|:snapshotId` (any in-scope member; analyst
  read-only). New table has RLS lockdown; M2-2…M2-5 untouched. Minimal UI: `/app/households/[id]/financial-snapshot`
  (composed view + capture + timeline), presentation-only. Contract:
  [`docs/architecture/M2_FINANCIAL_SNAPSHOT_CONTRACT.md`](./docs/architecture/M2_FINANCIAL_SNAPSHOT_CONTRACT.md).
- **Net worth + snapshots (M2-3):** `FxService` (`common/`, global) implements the core `FxRateProvider` over
  a **static/config** table (defaults from `DEFAULT_USD_PER_UNIT`, override via `FX_USD_PER_UNIT` JSON env);
  swap for a live provider without touching call sites. `HouseholdNetWorthService` FX-converts each account to
  `Household.baseCurrency` (`convertMinor`) then `computeNetWorth` — `/current` is **computed live** (never
  stored). `POST /net-worth/snapshot` creates an **immutable** `NetWorthSnapshot` (create-only; no
  update/delete); `/timeline` reads history ordered by `capturedAt` (composite index `(householdId,
capturedAt)`). `NetWorthSnapshot.userId` relaxed to nullable + `householdId`→`Household` relation, mirroring
  the M2-2 Account pattern. Snapshot capture is a write (OWNER/ADVISOR/SUPPORT); analyst read-only. Design:
  [`docs/architecture/M2-3_NET_WORTH_DESIGN.md`](./docs/architecture/M2-3_NET_WORTH_DESIGN.md).

## Conventions & gotchas

- **Feature branch reuse:** after a milestone's PR merges, restart the designated branch from `origin/main`
  (`git checkout -B <branch> origin/main`) — never stack on merged history. `--force-with-lease` is fine
  for the feature branch then; **never** force-push `main`.
- **Migrations:** generate with `prisma migrate dev`; append RLS `ENABLE ROW LEVEL SECURITY` for any **new**
  table (existing tables already locked). Verify `migrate reset` (clean apply) + `migrate diff` (no drift).
- **Local verification** needs a Postgres 16 instance at `DATABASE_URL`; run the pipeline in
  [`docs/AI_ENGINEERING_WORKFLOW.md`](./docs/AI_ENGINEERING_WORKFLOW.md) §5.
- **`noUncheckedIndexedAccess`** is on in web tsconfig — guard array-index access (`arr[0]` is `T |
undefined`).
- **Vercel** skips deployment for backend-only PRs (expected); builds a preview when `apps/web` changes.

## Open questions (deferred, revisit when relevant)

- Firm plan/pricing model (per-seat vs per-household) — MOD-12 / M8.
- Client portal write scope — M7.
- Platform-support impersonation — deferred (doc 04 §7).
- AA auto-sync at household scope; data-residency requirements.
