# Life Capital OS — Phase 2 Product Blueprint

> **Status:** Draft for review. Documentation only — no product code changes.
> **Scope:** The complete product blueprint that Phase 2 feature work will be built against.
> **Owner:** Product + Architecture.
> **Foundation:** Builds on the V2 Foundation (see [`../V2_ARCHITECTURE.md`](../V2_ARCHITECTURE.md)
> and [`../V2_PROJECT_INVENTORY.md`](../V2_PROJECT_INVENTORY.md)), which merged into `main`.

---

## What this is

Life Capital OS is evolving from a **B2C family-finance PWA** (V1/V2 foundation) into an
**AI-powered Family Wealth Operating System** for **wealth managers, financial advisors,
family offices, and HNI families**. This blueprint is the single, executable source of truth
for that product before any Phase 2 module is built.

It is deliberately **design-only**. It does not:

- modify the existing V2 design system (`apps/web/src/ui/*`),
- add or change business features, or
- alter the existing Prisma schema, API, or `@lcos/core`.

Everything here is a plan to be reviewed and approved first.

## The strategic shift (read this first)

| Dimension | V1 / V2 Foundation (built) | Phase 2 Target (this blueprint) |
|---|---|---|
| Buyer | Individual family / retail user | Wealth firm, RIA/advisor, family office |
| Served entity | One user + family members | Many **households**, each with members & legal entities |
| Tenancy | Single-tenant (one user root) | **Multi-tenant** (firm → advisors → households) |
| Primary job | "Know my financial health" | "Run a family's whole financial life at scale" |
| New surfaces | — | Advisor workspace, document vault, tasks, reporting, notifications |

The foundation's crown jewels — `@lcos/core`, the auth/RBAC model, the entitlement engine,
the audit log, field encryption, the `FinancialSnapshotService` seam — are **reused, not
replaced**. Phase 2 layers a tenancy + advisory + operations model on top of them.

## Document set

Read in order; each is standalone but cross-referenced.

| # | Document | Answers |
|---|---|---|
| 01 | [Product Requirements (PRD)](./01_PRD.md) | Who is it for, what problem, what must it do, success metrics |
| 02 | [Modules & Submodules](./02_MODULES.md) | The full product surface, module by module |
| 03 | [Navigation Structure](./03_NAVIGATION.md) | Every screen, route, and how users move between them |
| 04 | [Roles & Permissions](./04_ROLES_PERMISSIONS.md) | Who can see/do what, across tenants |
| 05 | [Data Model & ERD](./05_DATA_MODEL.md) | Schema additions, entities, relationships, migrations |
| 06 | [API & Service Architecture](./06_API_SERVICE_ARCHITECTURE.md) | Service boundaries, API surface, background jobs |
| 07 | [AI Agents](./07_AI_AGENTS.md) | Each agent, its job, inputs, guardrails |
| 08 | [Core Workflows](./08_WORKFLOWS.md) | Onboarding, wealth mgmt, documents, tasks, notifications, reporting |
| 09 | [Development Roadmap](./09_ROADMAP.md) | Milestones M0–M8, scope per milestone |
| 10 | [Dependencies, Risks & Implementation Order](./10_DEPENDENCIES_RISKS.md) | What blocks what, what can go wrong, the safe build order |

## Guiding constraints (apply to every document)

1. **Do not modify the V2 design system.** New screens compose existing primitives
   (`Button`, `Card`, `Table`, `Sidebar`, `DashboardLayout`, semantic color tokens). No new
   color scales, no forked components.
2. **Extend `@lcos/core`, never fork it.** New finance/scoring is pure functions added to the
   shared package.
3. **Every new table ships a migration and RLS lockdown.** No table is added without both.
4. **Every premium capability adds a `FeatureKey` + an `assertFeature` gate.** No ad-hoc gating.
5. **Every PII field goes through `CryptoService`; every admin/advisor mutation is audited.**
6. **Tenancy is a first-class column, not an afterthought.** Introduced in M1, before any
   multi-household feature ships (see risk R-TEN in doc 10).

## Traceability

Requirement IDs (`FR-*`, `NFR-*`), module IDs (`MOD-*`), and risk IDs (`R-*`) are stable across
documents so a reviewer can follow a requirement from the PRD → module → data model → roadmap
milestone. The roadmap (doc 09) maps every milestone back to the modules it delivers.
