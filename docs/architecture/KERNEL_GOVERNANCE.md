# Life Capital OS V2 — Financial Kernel Governance

> **Status:** Active and binding as of the `v2.0.0-financial-kernel` release. This document **freezes** the
> Financial Kernel as the permanent system of record and defines the governance rules that protect it. It is
> normative for **all** future work (Module 3+). Companion: [`FUTURE_MODULE_CONTRACT.md`](./FUTURE_MODULE_CONTRACT.md),
> [`ADR-FINANCIAL-KERNEL.md`](./ADR-FINANCIAL-KERNEL.md),
> [`M2_FINANCIAL_SNAPSHOT_CONTRACT.md`](./M2_FINANCIAL_SNAPSHOT_CONTRACT.md).

## 0. Declaration — the kernel is frozen

As of this release, the **Financial Kernel** (the M2-2…M2-6 engines and the `FinancialSnapshot` contract) is
the **permanent system of record** for household financial truth. Its shape is stable and its history is
immutable. Changes to it are governed — not ad hoc. The rules below are the guardrails.

## 1. Governance rules (normative)

### G-1 — The Financial Kernel is the permanent system of record
All consolidated household financial truth (net worth, assets, liabilities, debt, cashflow, budget,
allocation, currency exposure, equity, entity holdings) is owned by the kernel and read from **Financial
Snapshots**. No other component may claim to be the source of that truth. New financial *facts* are recorded
through the owning engine (M2-2…M2-5); new *derived* products (scores, plans, forecasts) are computed **from
snapshots** and stored in their **own** module tables.

### G-2 — `FinancialSnapshot` is append-only
Snapshots are created only by `HouseholdFinancialSnapshotService.capture`. There is **no update and no delete**
service path. Corrections are made by capturing a **new** snapshot (optionally marking the prior `status =
void`) — **never** by editing an existing row. The table carries RLS lockdown; the `checksum` makes any
out-of-band mutation detectable.

### G-3 — Existing snapshot fields are immutable
Once shipped, a payload field at a given `schemaVersion` **never changes meaning, type, or name**, and stored
snapshots are **never rewritten**. `schemaVersion 1` is now a **frozen contract**. Fields may only be **added**
(optional) under the same version, or introduced in a **new** `schemaVersion` with an `upgradePayload`
up-converter. Consumers written for version _N_ keep reading _N_ forever.

### G-4 — Future modules consume snapshots, not raw tables
Downstream modules and AI read consolidated figures **only** via `FinancialSnapshotService`
(`latest`/`getById`/`timeline`/`current`). They **must not** query or re-aggregate `Account` / `Transaction` /
`Debt` (or the engine snapshots) to reconstruct consolidated truth, and **must not** write to any M2 engine
table or to `FinancialSnapshot`. They write **only** into their own additive, RLS-locked, household-scoped
tables. (Full contract: [`FUTURE_MODULE_CONTRACT.md`](./FUTURE_MODULE_CONTRACT.md).)

### G-5 — Core schema changes require an ADR and architecture review
Any change to the kernel — a new/changed **payload field**, a `schemaVersion` bump, a change to an engine's
persisted shape, or a change to capture/reconciliation semantics — **requires**:
1. a written **ADR** (context, decision, consequences, alternatives) added to the architecture record, and
2. an **architecture review** (the design→review gate) **before** implementation.

No kernel change is made "inline" in a feature PR without this. Cosmetic/non-kernel changes (a new consumer
module, its own tables, its UI) do not require an ADR — only kernel-affecting changes do.

### G-6 — Backward compatibility must be preserved
Every kernel change is **additive and backward-compatible** (ADR-010): new tables (RLS lockdown) or new
**optional** fields/columns; **no** renames, removals, retypes, or reshaping of shipped structures. A genuinely
breaking need is expressed as a **new** `schemaVersion` (old snapshots untouched, up-converter provided) or a
new versioned route — never as a mutation of the existing contract. Migrations are verified drift-free
(`migrate reset` + `migrate diff`).

## 2. Change-control workflow for kernel changes

```
Proposed kernel change
  → ADR drafted (G-5)
  → Architecture review (design gate) ──reject──▶ revise or drop
        │ approve
        ▼
  Additive implementation (G-6) — new schemaVersion if breaking (G-3)
  → Tests: canonical/serialization + composition + reproducibility (byte-identical) + drift-free
  → Draft PR → CI → Review → Merge
  → Update contract docs (M2_FINANCIAL_SNAPSHOT_CONTRACT §3), PROJECT_MEMORY, this governance doc
```

Non-kernel modules follow the standard workflow (design → review → implement → draft PR → CI → review → merge)
and the [`FUTURE_MODULE_CONTRACT.md`](./FUTURE_MODULE_CONTRACT.md), without an ADR unless they touch the kernel.

## 3. What is frozen vs what may still evolve

| Frozen (governed by G-1…G-6) | May evolve freely (additive, no ADR) |
| --- | --- |
| `FinancialSnapshot` append-only semantics | New consumer modules + their own tables/UI |
| `schemaVersion 1` payload field meanings/types/names | New **optional** payload fields (documented, tested) |
| Immutability of stored snapshots + checksum | New `schemaVersion` (N+1) with up-converter |
| Engine persisted shapes (Account/Transaction/Debt/…) reshaping | New engines feeding the composer (additive) |
| Reconciliation semantics (`householdEquity`, ADR-012) | Swapping the FX **provider** (same contract, ADR-003) |
| Tenancy/security model (guard, RLS, roles, audit) | New pure `@lcos/core` calculators + tests |

## 4. Enforcement & review checklist (kernel-change PR gate)

- [ ] An ADR accompanies the change (G-5) and the design was reviewed **before** code.
- [ ] The change is **additive**; no shipped field renamed/removed/retyped (G-3, G-6).
- [ ] If breaking, `schemaVersion` bumped + `upgradePayload` entry added; **old snapshots untouched**.
- [ ] Append-only preserved — no update/delete path introduced on `FinancialSnapshot` (G-2).
- [ ] Reproducibility test still passes (stored snapshot byte-identical after mutation).
- [ ] Migrations additive + RLS lockdown on new tables; `migrate diff` shows **no drift**.
- [ ] Contract docs + `PROJECT_MEMORY` + this governance doc updated.
