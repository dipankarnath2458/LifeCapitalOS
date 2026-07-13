# 08 — Core Workflows

> **Doc:** End-to-end flows. **Status:** Draft for review.
> **Related:** [Modules](./02_MODULES.md) · [API](./06_API_SERVICE_ARCHITECTURE.md) · [AI agents](./07_AI_AGENTS.md)

Each workflow lists actors, the step sequence, the modules/APIs involved, and the events it emits.
"System" steps run as background jobs (doc 06 §5). Every mutation is audited; every household step is
firm- and household-scoped.

---

## 1. Onboarding

### 1.1 Firm onboarding (platform admin → firm owner)
```
Platform Admin: create Firm (plan, seats)         → Firm(status=active)
      │ emails invite to Firm Owner (EmailOutbox → email queue)
Firm Owner: accept invite → set password/2FA      → Membership(OWNER, active)
      │ complete firm settings (brand, currency, cadence)   [MOD-1.4]
Firm Owner: invite advisors/analysts/support      → Membership(role, invited)
Advisors: accept → active
```
Modules: MOD-14 → MOD-1 → MOD-2. Events: `firm.created`, `member.invited`, `member.joined`.

### 1.2 Household onboarding (advisor)
```
Advisor: create Household (name, base currency)    → Household(firmId, advisorId)
Advisor: add members + entities                    → HouseholdMember[], Entity[]  [MOD-3]
Advisor: apply "Onboarding" workflow template      → Task[] (collect docs, add accounts) [MOD-8.2]
Advisor/Client: add accounts & liabilities         → Account[] (entity-scoped) [MOD-4]
Advisor: request documents (statements, KYC)       → DocumentRequest[] [MOD-7.4]
Client: accept household invite → portal access     → HouseholdMember.userId set [MOD-2.4]
System: first NetWorthSnapshot + wealth_analyst run → snapshot + AgentRun [MOD-6]
Advisor: review AI analysis → confirm plan          → Recommendation[] persisted [MOD-5.6]
```
Completion criterion: balance sheet non-empty, ≥1 snapshot, onboarding tasks closed.
Events: `household.created`, `snapshot.captured`, `agent.completed`, `household.onboarded`.

---

## 2. Wealth management (ongoing)

The recurring loop that makes advisory scale.

```
(scheduled per firm cadence, e.g. quarterly)
System: capture NetWorthSnapshot per household           [snapshots queue]
System: recompute scores + early-warning (@lcos/core)    [FinancialSnapshotService]
System: at-risk sweep → raise alerts on threshold cross   → Notification(alert) [MOD-9]
System: enqueue wealth_analyst + allocation agents        → AgentRun[] [MOD-6]
Ops agent: draft follow-up Tasks from alerts              → Task[] (draft) [MOD-8]
Advisor: reviews book overview → at-risk households first  [/app , /app/alerts]
Advisor: opens household → reviews analysis + drift        [/app/households/:id/*]
Advisor: adjusts goals/allocation targets, assigns tasks   → Goal/Task writes
Advisor: proposes an action → Approval to client           → Approval(pending) [MOD-11.3]
Client: approves/declines in portal                        → Approval decided
Advisor: generates household report → sends                → Report + Notification [MOD-10]
```
This is the core value loop: **data → scores/alerts → AI drafts → advisor decision → client
approval → report**. Events: `snapshot.captured`, `alert.raised`, `agent.completed`,
`approval.decided`, `report.ready`.

---

## 3. Document management

```
Advisor: create DocumentRequest (member, due date)   → DocumentRequest(open) + Notification
Client (portal): open request → upload file
      │ API issues presigned PUT (StorageService)     → object storage
      │ client registers Document(status=uploaded)     [MOD-7.1]
System (docscan queue): virus/type scan               → DocStatus: clean|quarantined
System: document agent classifies + extracts fields   → suggested type/tags/fields [MOD-6.5]
Advisor: confirms classification, links to entity/goal → Document(type, links)
System: request marked fulfilled                       → DocumentRequest(fulfilled) + Notification
Any view/download                                      → audited [MOD-7.6]
Retention job: purge past retainUntil                  → Document(archived/purged) [MOD-13.5]
```
Modules: MOD-7, MOD-6.5, MOD-9, MOD-13. Guardrails: encrypted at rest, scoped access, every access
audited. Events: `document.requested`, `document.uploaded`, `document.scanned`, `request.fulfilled`.

---

## 4. Tasks & workflows

```
Source of a task:
  • Advisor creates manually
  • Workflow template instantiated (onboarding, annual review, protection review)  [MOD-8.2]
  • Ops agent drafts from an alert                                                 [MOD-6.6]
  • Document request creates a linked follow-up

Task lifecycle: open → in_progress → (blocked) → done | cancelled
  • assignee, dueAt, priority, linked household/document/goal
  • Reminders: due-soon & overdue → Notification (+ email)                          [MOD-8.4]
  • Escalation: overdue high/urgent → notify FIRM_OWNER
  • Completion updates the household Timeline                                       [MOD-8.5]
```
Modules: MOD-8, MOD-9. Events: `task.created`, `task.due`, `task.overdue`, `task.completed`.

---

## 5. Notifications

```
Any domain event (alert.raised, task.due, approval.decided, report.ready, message.posted, invite)
      │ EventBus → NotificationsService
      ├─ create Notification row (in-app inbox)                    [MOD-9.1]
      └─ if user preference enables email for this category:
             insert EmailOutbox row → email queue → provider send  [MOD-9.2]
Digest job (scheduled):
      • Advisor daily digest: due tasks, new alerts, pending approvals
      • Client periodic summary: net-worth trend, new documents, actions needed     [MOD-9.4]
User: preferences control channel × category, quiet hours                           [MOD-9.3]
```
Reliability: email is **outbox-driven** (insert in the same transaction as the event, drained by the
worker) so a provider outage never loses a notification. Events consumed: all domain events; emits
`email.sent`/`email.failed`.

---

## 6. Reporting

```
Trigger: advisor "Generate report" | schedule | end of review cadence
API: create Report(status=queued)                          [MOD-10]
Reports queue worker:
  1. build household FinancialSnapshot (or firm book aggregate)
  2. compute sections via @lcos/core (net worth, scores, goals, allocation, actions)
  3. report agent drafts narrative sections                  [MOD-6.7]
  4. render branded PDF (firm logo/brand from MOD-1.4) → storage
  5. Report(status=ready, storageKey)
System: Notification(report ready) + optional client email
Advisor: reviews/edits narrative before client delivery (human-in-the-loop)
Client (portal): views report                               [MOD-11]
Firm book report: same pipeline, firm-scoped aggregate (households, AUM proxy, at-risk) [MOD-10.4]
```
Numbers always come from `@lcos/core`; the agent only writes prose (doc 07 §1). Events:
`report.queued`, `report.ready`.

---

## 7. Compliance sub-flows (cross-cutting)

| Flow | Steps |
|---|---|
| **Consent (DPDP/AA)** | Client grants consent in portal → `Consent(granted, version)` at household scope → financial linking (AA) or processing enabled; revocation disables the dependent capability. [MOD-13.1/13.2] |
| **Data export** | Firm owner / client requests → job assembles household export bundle → delivered via secure download. [MOD-13.3] |
| **Erasure** | Request → SUPERADMIN executes household/user erasure (irreversible, confirmable, audited). [MOD-13.4, NFR-10] |
| **Audit review** | Firm owner views firm-scoped audit; platform admin views cross-tenant. [MOD-14.5] |

---

## 8. Event catalogue (summary)

| Event | Emitted by | Consumers |
|---|---|---|
| `firm.created`, `member.invited/joined` | firms module | email, notifications |
| `household.created/onboarded` | households module | agents (analyst), notifications |
| `snapshot.captured` | snapshots job | scores/alerts, agents, notifications |
| `alert.raised` | at-risk sweep | ops agent, notifications, tasks |
| `agent.completed` | orchestrator | notifications, task drafts |
| `document.uploaded/scanned` | docs / docscan job | document agent, notifications |
| `request.fulfilled` | documents module | notifications, tasks |
| `task.due/overdue/completed` | tasks + reminder job | notifications, escalation |
| `approval.decided` | approvals module | advisor notification, timeline |
| `report.ready` | reports job | notifications, client email |
| `message.posted` | messages module | notifications |
| `email.sent/failed` | email worker | observability, retry |

All events flow through the in-process EventBus (doc 06 §2), fan out to notifications, and are
audited where they represent a mutation.
