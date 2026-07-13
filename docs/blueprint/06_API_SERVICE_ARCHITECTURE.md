# 06 — API Boundaries & Service Architecture

> **Doc:** Backend architecture for Phase 2. **Status:** Draft for review.
> **Related:** [Data model](./05_DATA_MODEL.md) · [AI agents](./07_AI_AGENTS.md) · [Workflows](./08_WORKFLOWS.md)

Phase 2 keeps the V2 backend shape — **NestJS 10 modular monolith**, global prefix `/api`, Swagger at
`/api/docs`, deny-by-default `JwtAuthGuard` + `ThrottlerGuard`, thin services calling `@lcos/core`,
`FinancialSnapshotService` as the aggregation seam. It adds **tenancy middleware, a job runner, an
object-storage service, an email service, an AI orchestration layer, and new domain modules**. No
existing module is rewritten; new ones follow the split `*.controller/*.service/*.module` pattern.

---

## 1. Service topology

```
                 ┌──────────────────────────────────────────────┐
   Web (PWA)     │  NestJS API (apps/api) — modular monolith     │
   /app  /portal │  global: JwtAuthGuard → FirmContextGuard →    │
   /admin        │          ThrottlerGuard → ValidationPipe      │
       │  HTTPS  │                                               │
       └────────►│  Feature modules (see §3)                     │
                 │      │            │            │              │
                 │      ▼            ▼            ▼              │
                 │  @lcos/core   PrismaService  Providers        │
                 │  (finance/    (Postgres,     (Storage, Email, │
                 │   scoring/    RLS, tenancy    AI, AA, Razorpay)│
                 │   entitle-    middleware)                      │
                 │   ments)                                       │
                 └───────┬───────────────┬──────────────────────┘
                         │               │
                         ▼               ▼
                 ┌───────────────┐  ┌──────────────────────────┐
                 │  Job runner    │  │  External services        │
                 │  (BullMQ/Redis)│  │  Object storage (S3/R2)   │
                 │  workers:      │  │  Email (Resend/SES/…)     │
                 │  agents,       │  │  Anthropic (Claude)       │
                 │  reports,      │  │  Account Aggregator       │
                 │  snapshots,    │  │  Razorpay                 │
                 │  doc-scan,     │  └──────────────────────────┘
                 │  email-outbox  │
                 └───────────────┘
```

**Decision: stay a modular monolith.** The V2 module boundaries are clean; splitting into
microservices now would add ops cost without payoff. Extract a service only if a workload demands
independent scaling (candidate: the job/worker process, which we *do* run separately). This matches
V2 refactor **R3** (stand up cache/queue before compute-heavy modules).

---

## 2. Cross-cutting infrastructure (new)

| Concern | Approach | Ties to |
|---|---|---|
| **Tenancy** | `FirmContextGuard` resolves active `firmId` from `Membership` + `User.activeFirmId`; a Prisma middleware/wrapper injects `firmId` into every query; RLS is the backstop. | NFR-2, doc 04 §5 |
| **Scope** | `HouseholdScopeGuard` validates `householdId ∈ firm` and within caller's assigned/linked scope. | doc 04 §4 |
| **Jobs** | Redis-backed **BullMQ** worker process (separate from the web dyno). Queues: `agents`, `reports`, `snapshots`, `docscan`, `email`, `notifications`. | R-JOBS, NFR-5 |
| **Storage** | `StorageService` over S3/R2: presigned PUT/GET, server-side encryption, key convention `firm/{firmId}/hh/{householdId}/...`. | R-STORAGE |
| **Email** | `EmailService` over a provider (Resend/SES/Postmark) draining `EmailOutbox` via the `email` queue; idempotent. | R-EMAIL |
| **AI orchestration** | `AgentOrchestratorService`: gate → build grounding → run model → persist `AgentRun` → emit events. | doc 07 |
| **Observability** | Structured request logging, error reporting, `/metrics`, queue-lag metrics. | R-OBS, NFR-7 |
| **Events** | Lightweight in-process event emitter → notification fan-out + audit; can graduate to a queue. | MOD-9.5 |

Rate limiting moves from in-memory to **Redis-backed** throttling once multi-instance (V2 D4/R3).

---

## 3. Module → API surface

All routes under `/api`, JWT required unless `@Public()`, entitlement-gated where noted, firm-scoped
by `FirmContextGuard`, audited on mutations. Retained V2 routes are unchanged.

### 3.1 Existing V2 modules (reused, now tenant-aware)
`auth`, `users/profile`, `accounts`, `transactions`, `debts`, `goals`, `family`, `net-worth`,
`insights`, `tools` (public), `ai`, `billing`, `aa`, `admin`, `health`. These gain `firmId`/
`householdId` scoping in advisory contexts; their public/retail behavior is preserved.

### 3.2 New modules & representative endpoints

**FirmsModule — `/api/firms`**
- `POST /` create firm (platform admin), `GET /me` firms I belong to, `GET /:id`, `PATCH /:id` settings
- `GET /:id/members`, `POST /:id/invitations`, `PATCH /:id/members/:mid` (role/status)
- `POST /:id/switch` set active firm context

**HouseholdsModule — `/api/households`**
- `GET /` (book, firm-scoped, filter/paginate), `POST /`, `GET /:id`, `PATCH /:id`, `DELETE /:id`
- `POST /:id/assign` reassign advisor, `GET /:id/timeline`
- `GET /:id/members`, `POST /:id/members`, `POST /:id/invite-client`
- `GET /:id/entities`, `POST /:id/entities`

**Household finance (scoped wrappers over V2 services)**
- `GET/POST /households/:id/accounts` · `/net-worth/current|snapshot|timeline` · `/goals` · `/debts`
  · `/allocation` · `/protection` · `/scores` · `/early-warning` — each delegates to the existing
  service with `householdId` scope and multi-currency aggregation.

**DocumentsModule — `/api/documents`**
- `POST /upload-url` presigned PUT, `POST /` register uploaded doc, `GET /` (scoped list), `GET /:id`,
  `GET /:id/download-url`, `PATCH /:id` (classify/tag), `DELETE /:id` (soft)
- `POST /requests`, `GET /requests`, `POST /requests/:id/fulfil`

**TasksModule — `/api/tasks`**
- `GET /` (filter by firm/household/assignee/status), `POST /`, `PATCH /:id`, `POST /:id/complete`
- `GET /templates`, `POST /templates`, `POST /households/:id/apply-template/:tid`

**NotificationsModule — `/api/notifications`**
- `GET /` (inbox, unread count), `POST /:id/read`, `POST /read-all`
- `GET /preferences`, `PUT /preferences`

**AgentsModule — `/api/agents`** (entitlement-gated)
- `POST /run` `{ kind, householdId }` → enqueue, returns `AgentRun` id
- `GET /runs` (scoped), `GET /runs/:id`, `GET /runs/:id/output`

**ReportsModule — `/api/reports`**
- `POST /household/:id` generate (enqueue), `POST /firm` book report, `GET /` list, `GET /:id`,
  `GET /:id/download-url`, `POST /schedule`

**ApprovalsModule — `/api/approvals`**
- `POST /` (advisor requests), `GET /` (scoped), `POST /:id/decide` (client), (portal-facing)

**MessagesModule — `/api/messages`**
- `GET /threads`, `POST /threads`, `GET /threads/:id`, `POST /threads/:id/messages`

**Client-portal endpoints** reuse the above with a `HouseholdScopeGuard` bound to the client's
household and a read-mostly policy (no firm/book routes exposed).

**Platform admin additions — `/api/admin/firms`**
- `GET /firms`, `POST /firms`, `PATCH /firms/:id/status`, plus V2 admin routes unchanged.

---

## 4. Request lifecycle (advisory route)

```
Client → JwtAuthGuard (fresh user, deny-by-default)
       → FirmContextGuard (resolve + verify active firmId)
       → RolesGuard / firm-role check (@Roles / firm policy)
       → HouseholdScopeGuard (householdId ∈ firm ∧ in caller scope)
       → ThrottlerGuard (Redis)
       → ValidationPipe (DTO whitelist + transform)
       → Controller → Service
           → firm-scoped Prisma (firmId injected) / @lcos/core pure fn
           → enqueue job if heavy (agents, reports, snapshots, docscan, email)
           → AuditService.write(actor, firmId, action, entity, ip) on mutation
       → serialize (BigInt boundary) → response
Heavy work continues in a worker → emits domain event → NotificationsService fan-out.
```

`FinancialSnapshotService` remains the single seam that assembles a household's `FinancialSnapshot`
and maps it to `@lcos/core` inputs, so scoring, early-warning, reports, and AI agents all reason from
identical real data (now household-scoped and multi-currency-normalized).

---

## 5. Background jobs (BullMQ queues)

| Queue | Producer | Worker does | Emits |
|---|---|---|---|
| `agents` | `POST /agents/run`, schedules | run agent via orchestrator, persist `AgentRun` | `agent.completed` |
| `reports` | `POST /reports/*`, schedules | render report → storage, update `Report` | `report.ready` |
| `snapshots` | cron per firm cadence | capture `NetWorthSnapshot` per household | `snapshot.captured` |
| `docscan` | doc upload | virus/type scan, set `DocStatus`, optional AI classify | `document.scanned` |
| `email` | `EmailOutbox` inserts | send via provider, mark sent/failed, retry | — |
| `notifications` | domain events | create `Notification` rows + enqueue `email` | — |

Schedules (cron): per-firm review-cadence snapshots & digests, weekly at-risk sweep, retention purge.
Nothing compute-heavy runs in the request path (NFR-5).

---

## 6. API conventions

- **Versioning:** additive within `/api`; breaking changes behind `/api/v2/*` if ever needed.
- **Pagination:** cursor or page+limit on all list endpoints (reuse V2 `Pager` contract).
- **Errors:** consistent problem shape; never leak cross-tenant existence (404 vs 403 discipline).
- **Idempotency:** webhooks (Razorpay/AA) and email sends are idempotent (V2 pattern extended).
- **Serialization:** explicit `serialize()` at the boundary; retire the global `BigInt.toJSON` patch
  (V2 refactor R2).
- **Swagger:** every new endpoint documented; DTOs validated with `class-validator`.
- **Contract source of truth:** `@lcos/core` Zod schemas + Nest DTOs; shared types flow to the web app.

---

## 7. Deployment shape

- **API (long-running)** on Railway (V2, kept) — the primary runtime; the serverless path is retired
  (V2 refactor R2).
- **Worker process** (BullMQ) as a second Railway service sharing the codebase + Redis.
- **Redis** promoted from "declared but unused" to a real dependency (throttling + queues).
- **Web (PWA)** on Vercel (V2, kept).
- **Object storage** S3/R2; **email** provider; **Postgres** (system of record) with RLS.

Each new external dependency is abstracted behind a service interface (as AA/Razorpay already are),
so sandbox/live and provider swaps stay contained.
