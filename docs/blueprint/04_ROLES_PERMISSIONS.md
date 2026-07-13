# 04 — Roles & Permissions

> **Doc:** Access-control model. **Status:** Draft for review.
> **Related:** [PRD](./01_PRD.md) · [Data model](./05_DATA_MODEL.md) · [API](./06_API_SERVICE_ARCHITECTURE.md)

Phase 2 adds **tenancy** and **advisor↔client** relationships to the V2 RBAC model. The V2 global
`Role` enum (`USER, ADVISOR, SUPPORT, ANALYST, ADMIN, SUPERADMIN`) and the deny-by-default JWT guard +
`RolesGuard` are **reused**. What is new is that most authority is resolved **within a firm** and
**within a household**, not globally.

---

## 1. Two axes of authority

Access = **global platform role** (who you are to Life Capital OS) **×** **firm-scoped role** (what
you are inside a given firm) **×** **resource scope** (which households/entities you may touch).

```
Global role (platform)      Firm role (per firm membership)      Scope
──────────────────────      ──────────────────────────────      ─────────────────────────
SUPERADMIN / ADMIN     →     (n/a — cross-tenant)                all firms (guardrailed)
USER (staff)           →     OWNER / ADVISOR / ANALYST / SUPPORT  firm's households (book)
USER (client)          →     CLIENT / CLIENT_VIEWER               one household (+ scope)
```

- **Global roles** come from the existing `User.role` (unchanged): `SUPERADMIN`/`ADMIN`/`ANALYST`/
  `SUPPORT` for internal platform staff; `ADVISOR`/`USER` for firm and client people.
- **Firm roles** are new, stored on a `Membership(userId, firmId, firmRole)` join (see doc 05).
- **Household scope** for clients is stored on a `HouseholdMember`/client link.

This avoids reshaping the existing global `Role` enum while giving each firm its own role space.

## 2. Role catalogue

### 2.1 Platform (internal Life Capital OS staff)
| Role | Who | Authority |
|---|---|---|
| **SUPERADMIN** | Platform founders/ops leads | Everything, incl. destructive (firm delete, user erasure, role change). Cross-tenant. |
| **ADMIN** | Platform ops | Provision firms, plans, flags, metrics, audit. No irreversible erasure/role-change (SUPERADMIN only). |
| **ANALYST** | Platform analytics | Read-only cross-tenant metrics & audit. |
| **SUPPORT** | Platform support | Read user/firm status; limited assists; no plan/flag edits. |

### 2.2 Firm-scoped (a wealth firm's staff)
| Firm role | Who | Authority within the firm |
|---|---|---|
| **FIRM_OWNER** | Principal / firm admin | Manage the firm: advisors, seats, settings, billing, all households, reassign books. |
| **ADVISOR** | RM / financial advisor | Full read/write on **their assigned households**; run agents; manage docs/tasks; message clients. Read-only on unassigned households only if firm policy allows. |
| **FIRM_ANALYST** | Analyst | Read/analyze across the firm's households; run reports & agents; **no** client-facing mutations (no messaging/approvals). |
| **FIRM_SUPPORT** | Ops | Manage tasks, document requests, and data entry on assigned households; no billing/settings; no destructive deletes. |

### 2.3 Client-scoped (the HNI family)
| Client role | Who | Authority within the household |
|---|---|---|
| **HOUSEHOLD_OWNER** | Family head | Read the whole household; approve/decline proposed actions; upload documents; manage consents; message advisor; invite other family members. |
| **HOUSEHOLD_MEMBER** | Spouse / adult member | Read the household (or scoped subset); upload requested docs; message advisor. |
| **HOUSEHOLD_VIEWER** | Read-only member (e.g., older child) | Read a scoped subset (e.g., only goals linked to them). No uploads/approvals. |

## 3. Permission matrix (representative capabilities)

Legend: **F** full · **W** write (own/assigned scope) · **R** read · **—** none.

| Capability | SUPERADMIN | ADMIN | FIRM_OWNER | ADVISOR | FIRM_ANALYST | FIRM_SUPPORT | HH_OWNER | HH_MEMBER |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Provision/suspend firms | F | W | — | — | — | — | — | — |
| Edit plans / flags | F | W | — | — | — | — | — | — |
| Manage firm advisors/seats | F | R | F | — | — | — | — | — |
| Firm settings / branding | F | R | F | — | — | — | — | — |
| Firm billing | F | R | F | — | — | — | — | — |
| View all firm households | F | R | F | R* | R | R* | — | — |
| Create/edit household | F | — | F | W | — | — | — | — |
| Reassign household to advisor | F | — | F | — | — | — | — | — |
| Edit balance sheet / accounts | F | — | W | W | — | W | — | — |
| Run AI agents | F | — | W | W | W | — | — | — |
| Manage documents | F | — | W | W | R | W | W(own) | W(own) |
| Create/assign tasks | F | — | W | W | R | W | — | — |
| Generate reports | F | — | W | W | W | — | R(own) | R(own) |
| Message client ↔ advisor | — | — | W | W | — | W | W | W |
| Approve proposed action | — | — | — | — | — | — | W | —/W** |
| Manage consents (household) | F | — | R | W | — | — | W | R |
| DPDP export / erasure (household) | F | R | W*** | — | — | — | request | request |
| View audit log | F | R | R(firm) | R(own actions) | R(firm) | — | — | — |

\* Read on **unassigned** households only if firm policy enables it (default: assigned-only).
\** A household member can approve only if the owner delegates approval rights.
\*** Firm owner can trigger export; **erasure** is SUPERADMIN-executed (irreversible; NFR-10).

## 4. Scoping rules (how "assigned" is computed)

1. **Firm isolation (NFR-2):** every domain query is filtered by the caller's active `firmId`.
   No role can read across firms except platform ADMIN/SUPERADMIN (audited).
2. **Advisor → household:** an advisor sees a household iff they are the assigned advisor
   (`Household.advisorId`) **or** listed as a collaborator, **or** firm policy grants firm-wide read.
3. **Client → household:** a client sees a household iff they have a `HouseholdMember` link with a
   client role; sub-scoping (e.g., viewer sees only linked goals) is enforced in the service layer.
4. **Entity/document scope:** documents and entities can be marked member-restricted; the service
   intersects role scope with the resource's own scope.

## 5. Enforcement architecture

- **Global guard (V2):** `JwtAuthGuard` deny-by-default + fresh user lookup (role/status always current).
- **RBAC (V2):** `@Roles()` + `RolesGuard` for global-role gates (platform admin routes).
- **Firm guard (NEW):** a `FirmContextGuard`/interceptor resolves the active firm from membership,
  attaches `firmId` to the request, and rejects requests to firms the user isn't a member of.
- **Scope guard (NEW):** a reusable `HouseholdScopeGuard` validates that the target household is in
  the active firm and within the caller's assigned/linked scope.
- **Query layer (NEW):** a firm-scoped Prisma wrapper (or middleware) ensures every read/write
  carries `firmId`, so isolation can't be forgotten per-endpoint (belt-and-suspenders with RLS).
- **Entitlement gate (V2):** `assertFeature` still gates premium capabilities; firm-tier keys added.
- **Audit (V2):** every advisor/admin mutation writes to `AuditLog` with actor, `firmId`, entity, IP.

## 6. Invitations & lifecycle

| Flow | Who initiates | Result |
|---|---|---|
| Invite advisor/analyst/support | FIRM_OWNER (or platform ADMIN) | New/existing user gets a `Membership` in the firm with a firm role. |
| Invite client to household | ADVISOR / FIRM_OWNER / HH_OWNER | User gets a `HouseholdMember` link + portal access. |
| Reassign book | FIRM_OWNER | `Household.advisorId` changes; ownership history recorded; audited. |
| Suspend/offboard staff | FIRM_OWNER / ADMIN | Membership disabled; sessions revoked; households reassigned. |
| Client removal | HH_OWNER / ADVISOR | HouseholdMember link revoked; portal access removed. |

## 7. Guardrails on powerful actions

- **Impersonation** (platform support viewing a firm) is explicit, time-boxed, and heavily audited;
  never silent. Deferred unless needed; documented here so it's designed, not bolted on.
- **Erasure / firm delete** are SUPERADMIN-only, confirmable, and audited (NFR-10).
- **Cross-firm access** by platform roles is always audited with justification metadata.
- **Least privilege default:** new firm users default to the narrowest role (SUPPORT) unless set.
