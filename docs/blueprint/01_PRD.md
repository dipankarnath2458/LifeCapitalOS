# 01 — Product Requirements Document (PRD)

> **Doc:** Phase 2 PRD. **Status:** Draft for review.
> **Related:** [Modules](./02_MODULES.md) · [Roles](./04_ROLES_PERMISSIONS.md) · [Roadmap](./09_ROADMAP.md)

---

## 1. Product summary

**Life Capital OS** is an **AI-powered Family Wealth Operating System**. It gives wealth
firms, advisors, and family offices a single platform to run the entire financial life of the
HNI families they serve — balance sheet, cashflow, goals, protection, documents, tasks, and
reporting — with AI agents doing the analytical heavy lifting and families getting a clean,
secure client portal.

**One-line positioning:** *"The operating system a wealth firm runs its families on."*

The V2 foundation already proves the single-family engine (net worth, scoring, early warning,
AI coach). Phase 2 turns that engine into a **multi-tenant, multi-household advisory platform**.

## 2. Problem statement

Wealth managers and family offices today stitch together spreadsheets, portfolio tools, CRMs,
document folders, and email. The result:

- **No single balance sheet per family.** Assets, liabilities, entities, and goals live in
  fragments; the advisor rebuilds the picture manually for every review.
- **Advisory doesn't scale.** Each family needs periodic analysis, rebalancing checks, and
  protection reviews that are done by hand, so an advisor caps out at a few dozen households.
- **Client experience is opaque.** Families get a PDF quarterly and little else; they can't see
  their own position or what to do next.
- **Operations are ad hoc.** Tasks, document requests, review cycles, and compliance consent
  live in inboxes, not a system of record.

Life Capital OS solves this by being the **system of record + analysis engine + client portal**
in one, with AI agents automating the repetitive analysis.

## 3. Target users & personas

| Persona | Role in system | Primary jobs-to-be-done |
|---|---|---|
| **Firm Principal / Owner** | Firm admin (tenant owner) | Configure the firm, manage advisors & seats, see book-wide analytics, billing |
| **Financial Advisor / RM** | Advisor | Onboard & serve a book of households; run reviews; act on AI insights; message clients |
| **Family Office Analyst** | Analyst | Deep analysis, reporting, data quality across households (read-heavy) |
| **Operations / Support** | Support | Document collection, task follow-up, data entry, client admin (limited) |
| **HNI Family Head** | Client (household owner) | See the family's whole position; approve actions; upload documents; message the advisor |
| **Family Member / Dependent** | Client member | Scoped view of shared goals/documents relevant to them |
| **Platform Admin / Superadmin** | Internal Life Capital OS staff | Provision firms, plans, flags, trust & safety across all tenants |

Full permission matrix in [doc 04](./04_ROLES_PERMISSIONS.md).

## 4. Goals & non-goals

### 4.1 Product goals (Phase 2)
- G1. A firm can onboard, with multiple advisors, each managing a **book of households**.
- G2. A household has one consolidated, real-time **Family Balance Sheet** across members and
  entities, with net-worth history.
- G3. AI agents produce **analysis, alerts, and draft actions** per household on a schedule and
  on demand, grounded only in that household's real data.
- G4. A **Document Vault** stores family documents (statements, wills, policies, deeds) with
  secure upload, classification, and retention.
- G5. **Tasks & workflows** track everything an advisor/ops must do per household, with reminders.
- G6. **Notifications** (in-app + email) keep advisors and clients informed of alerts, tasks,
  approvals, and reports.
- G7. **Reporting** produces branded household reports and firm-level book analytics.
- G8. A **client portal** gives families a scoped, secure, read-mostly view + approvals + messaging.

### 4.2 Non-goals (explicitly out of Phase 2)
- N1. Executing trades / being a broker or RIA of record (we inform; we do not transact).
- N2. Replacing accounting/tax-filing software (we consume tax context, we don't file).
- N3. Native mobile apps (PWA continues; Expo remains a later phase).
- N4. A public advisor marketplace (flag exists; deferred).
- N5. Real-money custody or payments movement between family accounts.

## 5. Product principles

1. **Advisor-first, client-friendly.** The advisor workspace is the power surface; the client
   portal is calm, safe, and read-mostly.
2. **AI assists, humans decide.** Agents draft and alert; a human approves anything that leaves
   the system or changes a client's plan. No agent invents numbers not in the data.
3. **One core, many surfaces.** All finance math stays in `@lcos/core`; API/web/mobile reuse it.
4. **Secure & compliant by default.** Field-level PII encryption, consent ledger (DPDP), audit
   on every mutation, tenant isolation on every row.
5. **Composable, not bespoke.** Every screen is built from the existing design system.

## 6. Functional requirements

Grouped; each maps to a module in [doc 02](./02_MODULES.md) and a milestone in [doc 09](./09_ROADMAP.md).

### 6.1 Tenancy & firm management
- **FR-1** Support multiple **Firms** (tenants); every domain row is scoped to a firm.
- **FR-2** A firm has **Advisors, Analysts, Support** users with seats and per-firm roles.
- **FR-3** Firm settings: branding (logo, name for reports), default currency, review cadence.
- **FR-4** Assign/reassign a **household to an advisor** (book management); track ownership history.

### 6.2 Households, members & entities
- **FR-5** A **Household** groups a family: members, entities, accounts, goals, documents, tasks.
- **FR-6** **Members** (people) with relationships and dependency flags (extends `FamilyMember`).
- **FR-7** **Legal entities** (individual, HUF, trust, LLP/company) that own accounts (new).
- **FR-8** Consolidated **Family Balance Sheet**: accounts & liabilities across members/entities.
- **FR-9** **Net-worth timeline** per household via periodic + on-demand snapshots.

### 6.3 Wealth analysis (reuse + extend core)
- **FR-10** Per-household **scores** (Life Capital Score + sub-scores) from real data.
- **FR-11** **Early-warning** traffic-light signals per household.
- **FR-12** **Goal planning** (SIP, target tracking) per household and per goal.
- **FR-13** **Debt payoff** simulation; **asset allocation** vs. target drift; **insurance gap**.
- **FR-14** **Multi-currency** aggregation to a household base currency (see risk R-FX).

### 6.4 AI agents
- **FR-15** A **Wealth Analyst agent** produces a grounded household analysis on demand.
- **FR-16** A **Portfolio/Allocation agent** flags drift and suggests rebalancing bands.
- **FR-17** A **Protection agent** reviews insurance adequacy vs. dependents/liabilities.
- **FR-18** A **Document agent** classifies and extracts key fields from uploaded documents.
- **FR-19** A **Task/Ops agent** proposes and drafts follow-up tasks from alerts & reviews.
- **FR-20** A **Report agent** drafts the narrative for household/firm reports.
- **FR-21** All agents run through an **AI Orchestration** layer with per-firm entitlement gating,
  audit logging, and a "no invented numbers" guardrail. Detail in [doc 07](./07_AI_AGENTS.md).

### 6.5 Document management
- **FR-22** Secure **upload** to object storage (S3/R2), virus-scanned, encrypted at rest.
- **FR-23** **Classification** (statement, policy, will, deed, KYC, tax) + tags + household link.
- **FR-24** **Document requests**: advisor asks a client for a document; client uploads to fulfill.
- **FR-25** **Versioning, retention, and access scoping** (which member/entity a doc belongs to).

### 6.6 Tasks & workflows
- **FR-26** **Tasks** with assignee, due date, status, priority, linked household/document.
- **FR-27** **Workflow templates** (onboarding checklist, annual review, protection review) that
  instantiate a set of tasks.
- **FR-28** Task **reminders and escalations** via the notification system.

### 6.7 Notifications
- **FR-29** **In-app notifications** for alerts, tasks, approvals, mentions, reports ready.
- **FR-30** **Email delivery** (transactional provider) for the same, with per-user preferences.
- **FR-31** **Digest** notifications (advisor daily book digest; client periodic summary).

### 6.8 Reporting
- **FR-32** **Household report** (balance sheet, scores, goals, allocation, actions) — branded,
  exportable to PDF.
- **FR-33** **Firm/book analytics** (households, AUM proxy, at-risk households, activity).
- **FR-34** **Scheduled reports** generated as background jobs and delivered via notification.

### 6.9 Client portal
- **FR-35** A scoped **client view** of the household's balance sheet, scores, goals, documents.
- **FR-36** Client **approvals** (approve a proposed action/plan), **messaging** with the advisor,
  and **document upload** to fulfill requests.

### 6.10 Compliance, billing & admin (extend V2)
- **FR-37** **Consent ledger** per household/member (DPDP); export & erasure at household scope.
- **FR-38** **Plans/entitlements** extended to **firm-level** tiers (per-seat / per-household).
- **FR-39** **Audit log** covers every advisor and admin mutation, tenant-scoped.
- **FR-40** **Platform admin** provisions firms, plans, flags across tenants (extends V2 admin).

## 7. Non-functional requirements

| ID | Requirement |
|---|---|
| **NFR-1 Security** | TLS in transit; AES-256-GCM field encryption for PII; object storage encrypted at rest; refresh tokens in httpOnly cookies (V2 refactor R1); RBAC + tenant isolation on every query. |
| **NFR-2 Tenant isolation** | Every domain row carries `firmId`; queries are firm-scoped in a shared layer; RLS lockdown on all tables. Cross-tenant read/write is impossible by construction. |
| **NFR-3 Compliance** | DPDP Act 2023 (consent ledger, export, erasure) at household scope; RBI Account Aggregator consent for financial linking; SEBI-safe AI (educational, no invented numbers, no specific buy/sell tips presented as advice). |
| **NFR-4 Auditability** | Append-only audit log for every mutation by advisors/admins, with actor, firm, entity, IP. |
| **NFR-5 Performance** | Stateless API scales horizontally; heavy/async work (agent runs, report generation, snapshots, document scanning) runs in **background jobs**, never in the request path. |
| **NFR-6 Availability** | Health checks; graceful AI degradation (deterministic fallback when no model key). |
| **NFR-7 Observability** | Structured request logging, error reporting, and metrics before module count grows (V2 refactor R6). |
| **NFR-8 Data integrity** | Money as integer minor units; multi-currency conversion to base currency before aggregation; no silent precision loss. |
| **NFR-9 Accessibility** | WCAG-AA: keyboard nav, focus rings, and light/dark parity — already provided by the design system; new screens must preserve it. |
| **NFR-10 Reversibility** | Destructive actions (erasure, household delete) are SUPERADMIN/firm-owner only, audited, and confirmable. |

## 8. Assumptions & constraints

- The V2 foundation (auth, RBAC, entitlements, core, audit, encryption) is stable and reused.
- Object storage, an email provider, and a background-job runner **do not exist yet** and are
  Phase 2 prerequisites (see [doc 10](./10_DEPENDENCIES_RISKS.md), risks R-STORAGE, R-EMAIL, R-JOBS).
- Multi-tenancy is **not** in the current schema and must be introduced early (risk R-TEN).
- We inform and analyze; we do not custody assets or execute transactions (non-goal N1/N5).

## 9. Success metrics

| Category | Metric |
|---|---|
| Adoption | Firms onboarded; advisors active weekly; households onboarded per advisor |
| Advisor leverage | Households served per advisor (target: 3–5× the manual baseline) |
| Engagement | AI analyses run per household/month; tasks completed on time; documents on file per household |
| Client experience | Client portal MAU; approvals completed; report open rate |
| Reliability | Agent success rate; report generation success; p95 API latency; job queue lag |
| Commercial | Firm ARPU; seat/household expansion; free→paid firm conversion; retention |

## 10. Release gating

Phase 2 is milestone-gated (see [doc 09](./09_ROADMAP.md)). No module ships until its prerequisite
infrastructure (tenancy, storage, jobs, email, observability) is in place, and every module lands
with: a migration + RLS lockdown, a `FeatureKey` + gate, audit coverage, and tests.
