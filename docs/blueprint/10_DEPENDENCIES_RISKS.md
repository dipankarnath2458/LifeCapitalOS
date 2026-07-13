# 10 — Dependencies, Risks & Implementation Order

> **Doc:** The critical path. **Status:** Draft for review.
> **Related:** [Roadmap](./09_ROADMAP.md) · [Data model](./05_DATA_MODEL.md) · [API](./06_API_SERVICE_ARCHITECTURE.md)

This document is the safety brief: what must exist before what, what can go wrong, and the order that
minimizes rework. It consolidates the V2 risk register (see `../V2_ARCHITECTURE.md` §11 and
`../V2_PROJECT_INVENTORY.md` §22) and adds Phase-2-specific risks.

---

## 1. Dependency graph (build order)

```
M0 Foundation hardening
   ├─ Redis + BullMQ worker ─────────────┐
   ├─ Object storage (S3/R2) ───────────┐│
   ├─ Email provider + outbox ─────────┐││
   ├─ Observability ───────────────────┼┼┼─── (used by every later milestone)
   └─ Encryption-key governance ───────┘││
                                        ││
M1 Tenancy & firm shell  ◄──────────────┼┼── requires nothing external; gates ALL features
   └─ Firm/Household/scope guards        ││
        │                                ││
M2 Household wealth (needs M1)           ││
   └─ Multi-currency FX (@lcos/core)     ││
        │                                ││
M3 Planning & scores (needs M2)          ││
        │                                ││
M4 AI agents (needs M2/M3 + worker) ◄────┘│
M5 Documents (needs storage + worker) ◄───┘
M6 Tasks & notifications (needs email + worker + M1–M3 events)
M7 Reporting & portal (needs M2–M6)
M8 Billing/compliance/admin (needs M1; touches all)
```

**One-line rule:** *infrastructure (M0) → tenancy (M1) → data (M2/M3) → intelligence & operations
(M4/M5/M6) → delivery (M7) → commerce & governance (M8).*

## 2. Hard prerequisites (blockers)

| Prereq | Blocks | Why it must come first |
|---|---|---|
| **Multi-tenancy (M1)** | Every multi-household feature | Retrofitting `firmId` + isolation after data exists is expensive and error-prone (V2 risk #9/#10). |
| **Background jobs (M0)** | Agents, reports, snapshots, doc-scan, email | Compute-heavy work must never run in the request path (NFR-5, V2 D4/R3). |
| **Object storage (M0)** | Document Vault, report PDFs, firm logos | No blob store exists today (V2 §13). |
| **Email provider (M0)** | Invitations, notifications, reports, auth delivery | No transport exists; passwordless/reset is non-functional in prod (V2 §12). |
| **Key governance (M0)** | Any new encrypted PII | `FIELD_ENCRYPTION_KEY` is permanent and `decrypt` tolerates plaintext (V2 D6, risk #1) — fix before encrypting more. |
| **Observability (M0)** | Safe scaling of module count | V1/V2 deploy pain was a visibility problem (V2 D10). |

## 3. Risk register

Severity: 🔴 high · 🟠 medium · 🟡 low. Each risk has an ID reused across the blueprint.

| ID | Risk | Sev | Impact | Mitigation |
|---|---|:--:|---|---|
| **R-TEN** | Tenancy retrofitted late | 🔴 | Cross-tenant data leak; painful backfill | Introduce `firmId`/`householdId` in M1 before any household data; shared firm-scoped query layer + RLS backstop; automated isolation tests. |
| **R-KEY** | Encryption-key rotation breaks PII; silent plaintext on decrypt error | 🔴 | Unreadable/garbage PII; data-integrity incident | KMS-managed keys + strict-mode decrypt + rehearsed rotation **before** encrypting new fields (M0). |
| **R-JOBS** | No queue → heavy work in request path | 🔴 | Timeouts, poor UX, cost spikes | BullMQ worker + Redis in M0; all agents/reports/snapshots/scans/email async. |
| **R-STORAGE** | No object storage for documents | 🔴 | Document Vault can't ship | S3/R2 `StorageService` in M0; presigned URLs; SSE; scoped keys. |
| **R-EMAIL** | No email transport | 🔴 | Invites/notifications/auth delivery broken | Provider + outbox in M0; idempotent, retried. |
| **R-FX** | Mixed-currency sums without conversion | 🟠 | Wrong net worth for NRI/multi-currency families | FX boundary in `@lcos/core`; convert to base currency before aggregation (M2, NFR-8). |
| **R-OBS** | No structured logging/metrics/tracing | 🟠 | Blind production debugging | Observability stack in M0 before module growth. |
| **R-AI-HALL** | AI invents numbers / over-steps into advice | 🟠 | Compliance breach; client harm; trust loss | Grounded-only prompts + numeric post-check + human-in-loop + deterministic fallback (doc 07). |
| **R-ENTITLE** | Gating drift across DB plan / code default / overrides | 🟠 | Unauthorized access to premium modules | Every module adds a `FeatureKey` **and** an `assertFeature` gate; gating tests. |
| **R-RLS** | New table added without RLS lockdown | 🟠 | Table exposed via PostgREST | RLS lockdown is part of every migration's checklist (doc 09 DoD). |
| **R-SCOPE** | Advisor sees households outside assignment | 🟠 | Privacy/permission violation | `HouseholdScopeGuard` + service-layer scope intersection; tests per role (doc 04). |
| **R-PRECISION** | `BigInt`→`Number` serialization ceiling | 🟡 | Precision loss above ~9e15 minor units | Explicit `serialize()` boundary; retire global patch (V2 R2). |
| **R-COST** | Unbounded AI/report job cost | 🟡 | Runaway model/compute spend | Per-firm run quotas, token accounting, batched schedules, prompt caching (doc 07 §6). |
| **R-SESSION** | Tokens in `localStorage` across new clients | 🟠 | XSS session exfiltration | httpOnly cookie refresh token in M0 (V2 R1) before portal/mobile surfaces. |
| **R-SEED** | Seed-dependent, fragile e2e | 🟡 | CI breakage; slow delivery | Idempotent seed as part of release; expand service tests (V2 D8/D9). |
| **R-SCHEMA-DRIFT** | Existing coherent models reshaped | 🟠 | Regressions in working V2 features | Additive-only migrations; keep retail `userId` paths; backfill then tighten (doc 05 §1/§6). |
| **R-DESIGN** | New screens fork the design system | 🟡 | Inconsistent UI; violates constraint | Compose existing primitives only; no new tokens/variants (constraint from task). |

## 4. External dependencies

| Dependency | Used for | Abstraction | State |
|---|---|---|---|
| **Anthropic (Claude)** | All AI agents | `ModelClient` (extends V2 AI module) | V2 present, optional key, fallback |
| **Object storage (S3/R2/GCS)** | Documents, report PDFs, logos | `StorageService` | **new (M0)** |
| **Email (Resend/SES/Postmark)** | All transactional email | `EmailService` + outbox | **new (M0)** |
| **Redis** | Throttling + BullMQ queues | infra | declared but unused today → **activate (M0)** |
| **Razorpay** | Firm billing | `BillingService` (V2) | V2 present, sandbox default |
| **Account Aggregator (Setu)** | Financial linking | abstracted (V2) | V2 sandbox |
| **Postgres** | System of record | Prisma + RLS | V2 present |

Every new external dependency is introduced behind a service interface (matching the V2 AA/Razorpay
pattern) so sandbox↔live and provider swaps stay contained and testable.

## 5. Recommended implementation order (condensed)

1. **M0** — infra + debt paydown (storage, jobs, email, observability, key governance, session, runtime).
2. **M1** — tenancy + firm shell + scoping columns (the gate for everything).
3. **M2** — household balance sheet + multi-currency.
4. **M3** — scores, signals, allocation, protection, goals, persisted actions.
5. **M4** — AI agent fleet + orchestration (grounded on M2/M3).
6. **M5** — Document Vault (needs M0 storage/jobs).
7. **M6** — tasks, workflows, notifications (needs M0 email/jobs + M1–M3 events).
8. **M7** — reporting + client portal (needs M2–M6).
9. **M8** — firm billing, compliance flows, admin polish, 2FA.

Do **not** reorder features ahead of their infrastructure. If timelines compress, cut **scope within a
milestone** (fewer agents, fewer report types), never the prerequisite infrastructure.

## 6. Verification gates before each PR (per milestone)

- Migration applies cleanly up **and** down in CI; RLS lockdown present on new tables.
- Tenant-isolation test proves no cross-firm/household read or write.
- Entitlement gate test proves premium capability is blocked without the key.
- PII fields encrypted; mutations produce audit rows with `firmId`.
- `@lcos/core` unit tests green; new service + e2e tests added (V2 D8 remediation).
- AI features degrade deterministically without a model key.
- No design-system files changed (`apps/web/src/ui/*` untouched); screens compose primitives.
- Docs in this blueprint updated if the implemented scope diverges from the plan.

## 7. Open questions for review (decide before M1)

1. **Retail tier fate:** keep the B2C single-user product alongside the advisory product, or migrate
   all retail users into "self-managed households"? (Affects whether existing `userId` finance paths
   stay long-term.)
2. **Firm plan model:** per-seat, per-household, or hybrid pricing? (Shapes MOD-12 + entitlement keys.)
3. **Client write scope:** may clients edit their own accounts/goals, or is the portal strictly
   read + approve + upload? (Affects MOD-11 permissions.)
4. **AA at household scope:** is auto-sync in scope for Phase 2, or manual account entry only?
5. **Impersonation:** do we need platform-support "view-as-firm" in Phase 2, or defer? (doc 04 §7.)
6. **Data residency:** any firm-level residency requirements affecting storage region choice?

These are flagged, not decided, per the instruction to wait for review before implementing modules.
