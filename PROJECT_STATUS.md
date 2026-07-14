# Project Status

> Living snapshot of where the product is. **Updated after every merged PR** per the
> [AI Engineering Workflow](./docs/AI_ENGINEERING_WORKFLOW.md).
>
> **Last updated:** after PR #12 (M1-7) — Module 1 complete.

## Current phase

**Phase 2 — Family Wealth OS.** Building the multi-tenant advisory product on the merged V2 foundation and
the [Phase 2 blueprint](./docs/blueprint/).

## Milestone progress

| Milestone | Scope                                                                            | Status                     |
| --------- | -------------------------------------------------------------------------------- | -------------------------- |
| M0        | Foundation hardening (Redis/jobs, storage, email, observability, key governance) | ⏳ not started             |
| **M1**    | **Tenancy & firm shell**                                                         | ✅ **complete (#6–#12)**   |
| M2        | Household wealth (Family Balance Sheet) + multi-currency                         | ⏭️ next (pending approval) |
| M3        | Planning, scores & analysis surfacing                                            | ◻️                         |
| M4        | AI agent fleet & orchestration                                                   | ◻️                         |
| M5        | Document Vault                                                                   | ◻️                         |
| M6        | Tasks, workflows & notifications                                                 | ◻️                         |
| M7        | Reporting & client portal                                                        | ◻️                         |
| M8        | Firm billing, compliance & admin polish                                          | ◻️                         |

### Module 1 — delivered PRs

| PR  | Slice | Summary                                                                                      |
| --- | ----- | -------------------------------------------------------------------------------------------- |
| #6  | M1-1  | Tenancy schema: `Firm`, `Membership`, `Household`, `HouseholdMember`, `Entity` + enums + RLS |
| #7  | M1-2  | `FirmContextGuard`; `/api/firms` (me / get / settings / switch); `User.activeFirmId`         |
| #8  | M1-3  | Firm membership & advisor invitations (invite→accept, OWNER gate, last-owner protection)     |
| #9  | M1-4  | Households CRUD + `HouseholdScopeGuard`; reassign; encrypted household name; soft-delete     |
| #10 | M1-5  | Household members & entities (scoped CRUD, name/taxId encrypted, analyst read-only)          |
| #11 | M1-6  | Advisory scoping columns (migration M1b) on 8 finance models — nullable, indexed             |
| #12 | M1-7  | Advisor `/app` workspace shell (book overview, households, detail skeleton)                  |

## Health snapshot (merged `main`)

- **Migrations:** 6, apply cleanly from scratch; no drift.
- **Build:** 3/3 packages · **Lint:** 4/4 · **`@lcos/core`:** 41/41 · **API e2e:** 59/59 (8 suites).
- **Vercel:** web preview builds/deploys on `apps/web` changes; skipped otherwise.
- `main` is deployable.

## What's next

**M2 — Household wealth (Family Balance Sheet).** Household-scoped wrappers over the V2 finance services
(accounts, net worth, cashflow, debt), multi-currency FX aggregation in `@lcos/core`, consolidated balance
sheet + net-worth timeline UI, scheduled snapshots. First milestone to consume the M1-6 scoping columns.
**Awaiting owner approval to begin.**
