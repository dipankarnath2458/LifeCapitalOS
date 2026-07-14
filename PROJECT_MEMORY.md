# Project Memory

> Durable decisions, conventions, and gotchas that survive across sessions. **Updated after every merged
> PR** per the [AI Engineering Workflow](./docs/AI_ENGINEERING_WORKFLOW.md). Keep it terse and factual.

## Architecture (as built)

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
