# Architecture

## Monorepo layout

```
apps/
  api/      NestJS REST API (OpenAPI/Swagger), Prisma, JWT/RBAC
  web/      Next.js user app (App Router, PWA)
  admin/    Next.js + React-Admin control panel
packages/
  core/     Shared TS: money, domain zod schemas, finance calculators, scoring, entitlements
  config/   Shared tsconfig presets
infra/      docker-compose (Postgres + Redis)
docs/       Requirements, Architecture, Security
```

## Why this stack

- **One language (TypeScript) end-to-end** → maximal code reuse across web, admin,
  API and (Phase 7) the Expo mobile app.
- **`@lcos/core` is platform-agnostic** — no Node/DOM dependencies in the finance
  and scoring logic, so React Native can import it unchanged.
- **NestJS** mirrors the domain model as modules and gives guards, DI, validation
  and Swagger out of the box.
- **Prisma + PostgreSQL** for a typed, migratable relational model; **Redis** for
  caching, rate-limit state and BullMQ background jobs (scenario compute, AA sync).

## Request flow

1. Global `JwtAuthGuard` protects every route unless `@Public()`.
2. `RolesGuard` enforces `@Roles()` on admin endpoints.
3. Controllers validate DTOs (`class-validator`) → services → Prisma.
4. PII columns pass through `CryptoService` (AES-256-GCM) before persistence.
5. Mutating admin actions append to `AuditLog`.

## Cross-platform strategy

- Web and admin are separate Next.js apps sharing `@lcos/core`.
- Mobile (Expo/React Native) imports the same `@lcos/core`; only the presentation
  layer differs. Web is shipped as an installable PWA in the interim.
- Payments are abstracted behind `BillingService` so Razorpay (web) and native
  store billing (mobile) reconcile to the same entitlement engine.

## Scaling notes

- API is stateless (JWT) → scale horizontally behind a load balancer.
- Heavy compute (Monte-Carlo scenarios, AA sync) runs in BullMQ workers, not in the
  request path.
- Net-worth history uses periodic snapshots rather than recomputing from the full
  ledger on every read.
