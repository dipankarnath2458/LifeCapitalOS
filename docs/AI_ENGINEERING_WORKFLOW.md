# AI Engineering Workflow

> **Status:** Active — this is the **default engineering workflow** for all future development in this
> repository. Every contributor (human or AI) follows it unless the repository owner explicitly overrides
> a step for a specific task.
>
> **Scope:** How work is planned, implemented, verified, reviewed, and merged. It codifies the incremental,
> one-milestone-per-PR process used to deliver Module 1 (PRs #6–#12).

---

## 0. Golden rules (non-negotiable)

1. **Never merge a Pull Request without the owner's explicit approval.**
2. **Never force-push to `main`.** (`--force-with-lease` is allowed **only** on a feature branch, and only
   to restart it from `main` after its previous PR merged.)
3. **Never bypass CI.** No `--no-verify`, no skipping required checks, no merging red.
4. **Keep `main` deployable at all times.** Every change is additive/backward-compatible; if a change can't
   keep `main` green, it is split until it can.
5. **If uncertain, stop and ask** — do not guess on anything ambiguous, architecturally significant, or
   destructive.

---

## 1. Before starting any work

1. **Sync with the latest `main`.**
   ```bash
   git checkout main
   git fetch origin main
   git reset --hard origin/main   # local main == origin/main
   ```
2. **Understand the roadmap.** Read [`docs/blueprint/09_ROADMAP.md`](./blueprint/09_ROADMAP.md) and the
   module docs; know which milestone this branch delivers and its definition of done.
3. **Review the existing architecture** before writing code:
   - Foundation: [`docs/V2_ARCHITECTURE.md`](./V2_ARCHITECTURE.md), [`docs/V2_PROJECT_INVENTORY.md`](./V2_PROJECT_INVENTORY.md).
   - Product: [`docs/blueprint/`](./blueprint/) (data model, API, roles, navigation).
   - Current state: [`../PROJECT_STATUS.md`](../PROJECT_STATUS.md) and [`../PROJECT_MEMORY.md`](../PROJECT_MEMORY.md).
4. **Avoid duplicate code.** Search first; **reuse existing components, services, guards, and helpers before
   creating new ones** (see §7).
5. **Follow the existing design system and coding standards** (see §6).

## 2. One milestone per feature branch

- **Work on only ONE roadmap milestone per feature branch.** Do not mix milestones or unrelated changes.
- Branch name: the owner-designated branch for the milestone (e.g. `claude/<milestone>-<slug>`).
- **After a branch's PR has merged**, that PR is finished. To start the next milestone on the same branch
  name, restart it from the fresh default branch — never stack new work on already-merged history:
  ```bash
  git fetch origin main
  git checkout -B <branch-name> origin/main
  ```
- **Never change already-completed modules** unless the milestone genuinely requires it; if it does, call
  it out explicitly in the PR and report.

## 3. Small PRs

- Target **200–500 changed lines** whenever practical. Prefer several small, independently shippable,
  reviewable PRs over one large one.
- Each PR delivers one coherent, testable feature and lands with its migration + tests + docs.

## 4. Implementation standards

- **Additive, not destructive.** New tables + new nullable columns; backfill then tighten. Don't reshape
  coherent existing models (R-SCHEMA-DRIFT).
- **Every new table ships a migration + RLS lockdown.** Every premium capability adds a `FeatureKey` +
  `assertFeature` gate. Every PII field goes through `CryptoService`; every advisor/admin mutation is
  audited with `firmId`.
- **Tenancy is first-class:** firm/household scope is enforced in guards **and** verified by tests; no
  cross-tenant read/write.
- **Design system is off-limits:** compose existing primitives from `apps/web/src/ui/*`; **do not** add
  color scales, fork components, or edit `ui/*`. New navigation is data (`NavSection[]`), not new components.

## 5. After implementation — verification pipeline (run in this order)

Run the checks the change touches; a docs-only change skips the DB/test steps but must still build & lint.

```bash
# From repo root. Local DB required for migrations + e2e (Postgres 16, matching CI).
export DATABASE_URL="postgresql://lcos:lcos@127.0.0.1:5432/lcos?schema=public"
export FIELD_ENCRYPTION_KEY="<32-byte hex>"   # dev key; CI uses the all-zero test key
export SANDBOX_RETURN_SECRETS=true

pnpm --filter @lcos/api prisma:generate      # 1. regenerate Prisma client if schema changed
pnpm exec prettier --check .                 # 2. formatting
pnpm lint                                    # 3. lint / type-check (tsc --noEmit across packages)
pnpm --filter @lcos/web exec tsc --noEmit    #    web type-check (when apps/web changed)
pnpm --filter @lcos/api exec prisma migrate reset --force   # 4. migrations apply cleanly from scratch
pnpm --filter @lcos/api exec prisma migrate diff \
  --from-migrations apps/api/prisma/migrations \
  --to-schema-datamodel apps/api/prisma/schema.prisma --exit-code   #    no schema drift
pnpm --filter @lcos/core test                # 5. unit tests
pnpm db:seed                                 #    seed (e2e depends on it)
pnpm --filter @lcos/api test:e2e             #    e2e (incl. tenant-isolation + role-gating suites)
pnpm build                                   # 6. the application builds successfully (all packages)
```

**A PR is not opened until every applicable step is green**, migrations apply up cleanly with no drift,
and tenant-isolation / entitlement tests pass.

## 6. Formatting & coding standards

- **Prettier** (`.prettierrc`) is the source of truth for formatting; run it before committing.
- **TypeScript strict**; `pnpm lint` is `tsc --noEmit`. No new `any` unless unavoidable and commented.
- Money is `BigInt` minor units; serialize explicitly at the API boundary. PII is encrypted at rest.
- Match the surrounding code's naming, structure, and comment density. NestJS modules follow the split
  `*.controller.ts` / `*.service.ts` / `*.module.ts` / `*.dto.ts` pattern.

## 7. Reuse before creating

Before adding anything new, search for and prefer:

- **Backend:** `@lcos/core` pure functions; `FinancialSnapshotService`; `PrismaService`, `CryptoService`,
  `AuditService`; `FirmContextGuard`, `HouseholdScopeGuard`, `RolesGuard`; existing DTO patterns.
- **Frontend:** the `@/ui` primitives (`Card`, `StatCard`, `DataTable`, `Badge`, `Button`, `Modal`,
  `Input`/`Select`, `DashboardLayout`, `Sidebar`, `EmptyState`/`ErrorState`/`LoadingState`); `@/lib/api`.

## 8. Pull Request flow

1. Commit with a clear, descriptive message (Conventional-Commits style: `feat(...)`, `fix(...)`, `docs(...)`).
2. Push the feature branch:
   ```bash
   git push -u origin <branch-name>     # feature branch only; retry on transient network errors
   ```
3. **Open a Draft Pull Request automatically** against `main`. If the repo has a PR template, mirror its
   sections. Include the implementation report (§10) in the body.
4. Subscribe to the PR's activity to catch CI + review events.
5. **Stop immediately after creating the PR.** Do not merge. Do not start the next milestone.

## 9. CI handling

- CI runs on push (`build-test`: install → prisma generate → build → lint → core tests → migrate deploy →
  seed → API e2e). **Never bypass or disable it.**
- **If CI fails:** diagnose, fix the underlying issue, push the fix to the same branch, and let CI re-run.
  Repeat until green. **Do not ask** unless human input is genuinely required (ambiguous fix,
  architectural decision, or a failure outside the diff's control).
- Webhooks don't deliver CI _success_ or merge-conflict transitions, so re-check PR state proactively
  (a scheduled self check-in) until the PR is merged or closed.

## 10. Implementation report (after every PR)

Post a short report (in the PR body and to the owner) with exactly these sections:

- **What changed** — the feature and the files/areas touched.
- **Tests executed** — which checks ran and their results (build, lint, unit, e2e, migrations, drift).
- **Build status** — pass/fail for each package.
- **Risks** — anything to watch, follow-ups, or deferred work.
- **Next milestone** — what comes next per the roadmap.

## 11. After the owner merges

The subscription/loop is not finished until the PR is **merged or closed**. On detecting a merge:

1. **Detect the merge automatically** (webhook or scheduled re-check).
2. **Sync the latest `main`** (§1.1).
3. **Verify repository health** — run the §5 pipeline against merged `main`.
4. **Report the verification results.**
5. **Continue to the next approved roadmap milestone automatically** — restart the branch from `main`
   (§2) and begin the next milestone. Only proceed to milestones the owner has approved; if the next
   milestone is not yet approved, stop and ask.
6. **Update [`PROJECT_MEMORY.md`](../PROJECT_MEMORY.md) and [`PROJECT_STATUS.md`](../PROJECT_STATUS.md)**
   to reflect the merged PR (decisions, current state, next up).

## 12. Living documents

| File                                        | Updated               | Contains                                                         |
| ------------------------------------------- | --------------------- | ---------------------------------------------------------------- |
| [`PROJECT_STATUS.md`](../PROJECT_STATUS.md) | after every merged PR | current milestone/PR status, health snapshot, what's next        |
| [`PROJECT_MEMORY.md`](../PROJECT_MEMORY.md) | after every merged PR | durable decisions, conventions, gotchas, resolved open questions |

---

## Quick checklist (per PR)

- [ ] Synced with latest `main`; branch delivers exactly one milestone.
- [ ] Read roadmap + architecture; reused existing components; no duplication.
- [ ] No design-system (`ui/*`) changes; standards & Prettier followed.
- [ ] New tables have migration + RLS; PII encrypted; mutations audited; isolation tested.
- [ ] Format, lint, type-check, migrations (up + no drift), unit + e2e, build — **all green**.
- [ ] Draft PR opened with the implementation report; **stopped** — awaiting approval.
- [ ] `main` still deployable; CI not bypassed; no force-push to `main`.
- [ ] After merge: synced, health-verified, reported, `PROJECT_MEMORY.md` + `PROJECT_STATUS.md` updated.
