# V1 Consumer Experience — Retirement Plan

> **Status:** Report only. **No code has been deleted, moved, or modified.** This document exists for
> approval before any implementation begins, per the product decision that V2 becomes the single
> official Life Capital OS consumer experience.
> **Method:** every claim below comes from a per-module import graph over `apps/web/src` and
> `apps/web/e2e`, matching `@/`, `./` and `../` import forms — not from naming or inspection by eye.
> Companion: [`M5_6_HOUSEHOLD_DASHBOARD_ARCHITECTURE`](./M5_6_HOUSEHOLD_DASHBOARD_ARCHITECTURE.md),
> [`M5_5_WEALTH_HEALTH_CHECK_ARCHITECTURE`](./M5_5_WEALTH_HEALTH_CHECK_ARCHITECTURE.md),
> [`M5-5_CONSUMER_ACTIVATION`](./architecture/M5-5_CONSUMER_ACTIVATION.md).

---

## 1. Headline: three findings that change the shape of this work

Before the inventory, three things the audit surfaced that are not obvious from the file names and
that make a naïve deletion dangerous.

**1. `components/dashboard/` is the ADVISOR workspace, not the consumer dashboard.** All seven files
(`ScoreCard`, `NetWorthCard`, `AiCfoPanel`, `FamilySummaryCard`, `HouseholdSelector`, `QuickActions`,
`RecentActivity`) are imported **only** by `app/app/page.tsx` — the Advisor Workspace. Deleting a
directory called "dashboard" during a dashboard retirement would take down the advisory product.
**Preserve, untouched.**

**2. Retiring `/dashboard` severs the only route into onboarding.** A new consumer reaches
`/onboarding` exactly one way: the V1 dashboard detects zero accounts and redirects. Login goes to
`resolvePostLoginDestination` → `/dashboard` or `/app`; nothing else links to `/onboarding`. Delete
the V1 dashboard without replacing that nudge and **every new consumer lands on an empty V2 dashboard
having never been asked to create a household.** This is the single highest-risk item in the plan.

**3. Retiring `/dashboard` makes `/billing` unreachable.** `/billing` is linked from exactly three
places — `dashboard/page.tsx`, `WealthCoach`, `SecondOpinion` — all V1 consumer surfaces. Remove them
and the paid-plan page still exists but **no user can navigate to it.** Revenue-critical, and easy to
miss because the route itself keeps working.

A fourth, smaller: the V1 dashboard is also the **only** link to `/admin` anywhere in the product.

---

## 2. Current V1 inventory

### 2.1 Routes

| Route | Classification | Notes |
| --- | --- | --- |
| `app/dashboard/page.tsx` | **Safe to delete** (after §5 migrations) | V1 consumer home. Carries the onboarding nudge, the `/billing` link and the `/admin` link — all must move first. |
| `app/page.tsx` (landing) | **Preserve** | Public marketing site, not consumer app. |
| `app/billing/page.tsx` | **Preserve — requires migration** | Paid plans. Route is fine; its *inbound links* all live on V1 surfaces. |
| `app/onboarding/page.tsx` | **Preserve — requires migration** | Part of the new journey. Still writes retail-keyed records (§5.3). |
| `app/wealth-health/`, `app/household/` | **Preserve** | V2 canonical. |
| `app/login/`, `forgot-password/`, `reset-password/`, `verify-email/` | **Preserve** | Authentication. |
| `app/app/**` (11 routes) | **Preserve** | Advisor Workspace — a separate product, not V1 consumer. |
| `app/admin/**` (5 routes) | **Preserve** | Platform administration. |
| `app/design-system/` | **Preserve** | Design-system reference. |

### 2.2 Components — classified by import graph

**Group A — V1 consumer-only. Safe to delete once §5 migrations land.**
Every one is imported *only* by `app/dashboard/page.tsx`:

| Component | Retail API it calls |
| --- | --- |
| `AddAccount.tsx` | `/accounts` |
| `AllocationDonut.tsx` | `/accounts` |
| `NetWorthChart.tsx` | `/net-worth/*` |
| `EarlyWarning.tsx` | `/insights/early-warning` |
| `Goals.tsx` | `/goals` |
| `Family.tsx` | `/family` |
| `Protection.tsx` | `/profile` |
| `WealthCoach.tsx` | `/ai/coach` |
| `SecondOpinion.tsx` | `/ai/second-opinion` |

> The **APIs these call are NOT removed** — they are platform surface and stay per the decision.
> Only the presentation layer goes.

**Group B — CORRECTED: there are no orphans. All three are shared and must be preserved.**

> An earlier revision of this document listed `Modal.tsx`, `NumberField.tsx` and `Status.tsx` as
> already-orphaned and safe to delete. **That was wrong.** The import graph behind it matched only
> `@/…`-style imports and missed relative ones (`./Modal`). Re-run including relative imports:
>
> | File | Real importers | Verdict |
> | --- | --- | --- |
> | `Modal.tsx` | `FeatureOverrides.tsx` (**admin**) | Preserve |
> | `NumberField.tsx` | `AddAccount` (V1) + `HealthCheck`, `InsuranceGap`, `RetirementCalculator` (**marketing**) | Preserve |
> | `Status.tsx` | `EarlyWarning` (V1) + `HealthCheck` (**marketing**) | Preserve |
>
> Two of the three are load-bearing for the public marketing site. Deleting them on the strength of
> the original analysis would have broken the homepage — the exact failure this report exists to
> prevent. The corrected graph is the one used everywhere below.

**Group C — MARKETING, not consumer app. Preserve.** `ToolsSection.tsx` is imported by the public
landing page (`app/page.tsx`), and pulls in `HealthCheck.tsx`, `RetirementCalculator.tsx`,
`InsuranceGap.tsx`, `WealthDna.tsx` (which calls `/tools/wealth-dna`). These are lead-generation
calculators on the marketing site. **Their names make them look like V1 consumer features; they are
not.** Deleting them would break the public homepage.

**Group D — shared infrastructure. Preserve.**
`Toast.tsx` (7 importers incl. root layout), `Skeleton.tsx`, `Pager.tsx`, `AuthCard.tsx` (3 auth
routes), `AdminShell.tsx`, `FeatureOverrides.tsx`.

**Group E — Advisor Workspace. Preserve.** All of `components/dashboard/*` — see §1.

### 2.3 Library modules

| Module | Classification |
| --- | --- |
| `lib/session.ts`, `lib/api.ts` | **Preserve** — session kernel and API client, used everywhere. |
| `lib/intelligence.ts`, `lib/wealthHealth.ts`, `lib/household.ts` | **Preserve** — V2 canonical. |
| `lib/postLoginDestination.ts` | **Preserve — requires migration** (§5.1). |
| `lib/admin.ts`, `lib/adminContext.tsx` | **Preserve — requires migration**: both hard-redirect to `/dashboard` on non-admin access. |
| `lib/appContext.tsx`, `lib/useCurrentHousehold.ts` | **Preserve** — Advisor Workspace. |

### 2.4 API — nothing is removed

Per the decision, all APIs and shared services remain: Financial Kernel, Financial Intelligence
Layer, Snapshot Engine, Wealth Health / Explainable Score engines, Household Aggregate, auth,
authz, audit, multi-tenancy, database. The retail endpoints (`/accounts`, `/goals`, `/family`,
`/net-worth`, `/insights`, `/ai`, `/tools`, `/profile`) stay: `/tools` still serves the marketing
site, `/ai` still serves the coach, and the rest remain platform surface with no consumer UI in
front of them.

**No schema change. No migration. No data is deleted by this work.**

---

## 3. Dependency analysis — what breaks if we delete naïvely

| # | Dependency | Consequence if unhandled | Severity |
| --- | --- | --- | --- |
| D1 | `/dashboard` is the only entry to `/onboarding` | New consumers never create a household; they land on an empty dashboard | **Critical** |
| D2 | `/billing` linked only from V1 consumer surfaces | Paid plans become unreachable | **High (revenue)** |
| D3 | `CONSUMER_HOME = '/dashboard'` | Login sends every consumer to a deleted route | **Critical** |
| D4 | `lib/admin.ts` + `admin/layout.tsx` redirect non-admins to `/dashboard` | Redirect to a 404 | Medium |
| D5 | `AdminShell` has two "back" links to `/dashboard` | Dead links inside admin | Medium |
| D6 | `/admin` linked only from the V1 dashboard | Admin console unreachable by navigation | Medium |
| D7 | 6 smoke tests assert `/dashboard` as the consumer destination | Red CI | Medium (caught by CI) |
| D8 | `app/app/layout.tsx` redirects firm-less users to `CONSUMER_HOME` | Advisors without a firm hit a dead route | Medium |
| D9 | Onboarding still writes retail-keyed records | Data invisible to the V2 dashboard — the double-entry problem | Medium |

---

## 4. Risk assessment

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| New consumers never onboard (D1) | **High** if unhandled | Product unusable for every new signup | Move the first-run redirect into `/household` **before** deleting; smoke test asserts a fresh consumer reaches onboarding |
| Billing unreachable (D2) | **High** if unhandled | Silent revenue loss — nothing errors | Add plans link to the V2 dashboard; smoke test asserts reachability |
| Deleting the Advisor Workspace by name confusion | Medium | Advisory product down | §2.2 Group E; the advisor smoke test must stay green |
| Breaking the marketing site | Medium | Public homepage down | §2.2 Group C; landing-page smoke test must stay green |
| Removing something still referenced | Low | Build failure | `tsc --noEmit` + build are hard gates; deletion list is import-graph verified, including relative imports |
| Import graph misses relative imports | **Occurred once** | Would have deleted 3 shared files, breaking the marketing site | Caught and corrected before approval; the graph now matches `@/`, `./` and `../` forms |
| Losing V1 as a fallback | Accepted by decision | — | Git history, tags, and Vercel rollback, per the decision |

**Deliberately called out:** D1 and D2 are the two failures that would **not** produce an error.
Everything else fails loudly — a broken build, a 404, a red test. These two just quietly stop working,
which is why both get a smoke test rather than a manual check.

---

## 5. Migration strategy — what must happen *before* deletion

Ordered so the product is never in a broken state, and each step is independently revertible.

**5.1 Repoint the consumer home.** `CONSUMER_HOME: '/dashboard' → '/household'`. One line, and the
change every other step depends on. Fixes D3 and D8.

**5.2 Move the first-run nudge into `/household`.** The V2 dashboard already distinguishes
"no household / no snapshot" and shows a call to action. Extend it so a consumer with no household is
sent to `/onboarding`, exactly as the V1 dashboard does today. Fixes D1. **This must land before the
V1 dashboard is deleted, not with it.**

**5.3 Give the V2 dashboard the navigation the V1 one carried** — a Plans link (`/billing`) and an
Admin link for admin roles (`/admin`). Fixes D2 and D6.

**5.4 Repoint admin redirects** in `lib/admin.ts`, `app/admin/layout.tsx` and `AdminShell.tsx` from
`/dashboard` to `/household`. Fixes D4 and D5.

**5.5 Point onboarding's account step at the household path.** Resolves D9 and the double-entry
between onboarding and the Wealth Health Check. *Recommended in this work, but separable — say the
word if you would rather it be its own PR.*

**5.6 Update the smoke suite** to assert the V2 destination. Fixes D7.

**Only then**, delete: `app/dashboard/page.tsx` and the nine Group A components. **Nothing else** —
there are no orphans (see the Group B correction).

---

## 6. Rollback strategy

Per the decision, recovery is git and deployment, not a second UI.

| Layer | Mechanism |
| --- | --- |
| Web | Redeploy the previous Vercel build — instant, no rebuild |
| Code | `git revert` the merge commit; the deleted files return intact |
| API | **No rollback needed** — no API, schema or data change in this work |
| Data | **Nothing to restore** — no rows are deleted or migrated |
| Tag | Recommend tagging `v2.1-v1-retired` at merge, so the boundary is a named point |

Because no data or API changes, rollback is purely a deploy operation with no consistency window.

**Recommended sequencing for a clean revert path:** land §5 migrations as **PR A** (additive, nothing
deleted, fully reversible on its own), then deletions as **PR B**. Reverting B restores V1 without
touching V2; reverting both returns to today. Bundling them makes the revert all-or-nothing.

---

## 7. Testing checklist

Verified before merge; ✓ = automated.

**Journey**
- ✓ Register → land on the V2 dashboard, not a 404
- ✓ A consumer with no household is sent to `/onboarding`  ← guards D1
- ✓ Onboarding creates a household
- ✓ Wealth Health Check captures a snapshot and returns a score from the entered figures
- ✓ Household dashboard shows those figures with provenance
- ✓ A consumer with no snapshot sees the call to action, not zeros

**Navigation**
- ✓ No route in the app links to `/dashboard`
- ✓ `/billing` reachable from the V2 dashboard  ← guards D2
- ✓ `/admin` reachable for an admin role
- ✓ Sign out → `/login`; `/app` does not resurrect the session

**Preserved surfaces**
- ✓ Public landing page renders, including the tools/calculator section  ← Group C
- ✓ Advisor Workspace renders for a user with a firm  ← Group E
- ✓ Admin console loads for the seeded superadmin
- ✓ Password reset and email verification

**Platform**
- ✓ Full API e2e (24 suites, 154 tests) — unchanged, since no API changes
- ✓ `@lcos/core` 120, API unit 52, web unit 26
- ✓ `tsc --noEmit` and production build clean for api + web
- ✓ No orphaned modules: import-graph re-run shows no unreferenced file left behind
- ✓ Green CI

**Manual, on the Vercel preview**
- Complete the journey end to end as a new user
- Confirm no page shows a fabricated ₹0

---

## 8. What I recommend

Approve §5 as **PR A** (migrations, additive, zero deletions) and the deletions as **PR B**.

The reason is D1 and D2: both are silent failures, and separating the PRs means the migration that
prevents them is live and verified in production *before* anything is removed. If something is wrong,
reverting the deletion is a one-click deploy rollback that leaves the migrations in place.

**Awaiting approval. No files have been changed.**
