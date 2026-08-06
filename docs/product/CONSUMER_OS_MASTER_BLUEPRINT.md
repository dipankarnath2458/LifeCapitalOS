# Life Capital OS — Consumer OS Master Blueprint

> **"The AI Operating System for Personal & Family Wealth."**
>
> **Status:** Design review only — no code, schema, or API changed by this document.
> **Method:** Every claim below was verified against the repository at `main`. Where something
> does not exist, it is stated as absent rather than assumed.
> **Scope:** Product evolution from Advisor→Client to Consumer-first, **preserving M1–M5**.

---

## Part 0 — Executive summary

### The headline finding

**The Financial Kernel is already consumer-ready. The consumer pivot is a ~1-line schema change plus an experience layer — not a rebuild.**

Verified: `Account`, `Transaction`, `Debt`, `Goal`, `NetWorthSnapshot`, and `Recommendation` are **all dual-keyed** — nullable `userId` (retail) *and* nullable `householdId`/`firmId` (advisory), per ADR-010. The kernel does not care who owns a household. Snapshots, scores, simulation and the M5 Intelligence Layer are all **household-scoped and user-agnostic**.

A consumer **is** a household of one-or-more people. Nothing in the kernel resists that.

### The one real blocker

```prisma
model Household {
  firmId String   // ← NOT NULL. This is the only structural obstacle.
}
```

Every household must belong to a Firm. That single constraint — plus `/app` gating on **firm membership** — is what forces consumers into an advisory shell.

### What the architecture already anticipated (unused, waiting)

| Asset | Evidence | Status |
|---|---|---|
| `HouseholdMember.userId` | comment: *"set when the member has a portal login"* | modelled, unused |
| `HouseholdRole` enum | `OWNER · MEMBER · VIEWER` | modelled, unused |
| Entitlements engine | 13 `FeatureKey`s across `free / premium / family_cfo` | **built + tested, matches your business model exactly** |
| `buildAiGroundingContext()` | PII-redacted AI grounding contract | **built, tested, zero consumers** |
| M5 Intelligence object | 13 sections, `Section<T>` degradation | built, one consumer (dashboard) |

The previous architecture *designed for* this evolution. You are collecting on that investment, not writing it off.

### Answers to your nine final questions

| Question | Answer | Why |
|---|---|---|
| Preserve existing architecture? | **Yes — entirely** | Kernel is household-scoped and user-agnostic; consumer households are a first-class fit |
| Preserve the Financial Kernel? | **Yes — frozen, extend only** | It is the moat. 120 core tests, immutable snapshots, reproducible, multi-currency |
| Preserve the APIs? | **Yes — all 13 household APIs stay valid** | They are scoped by `householdId`, never by "advisor". Zero breaking changes |
| Preserve the database? | **Yes — one additive change** | Make `Household.firmId` nullable. Everything else is new tables |
| Preserve the dashboard foundation? | **Yes — the components; no — the shell** | `ScoreCard`/`NetWorthCard`/`@/ui` are reusable. "Advisor workspace" chrome is not |
| Which UI to replace? | The `/app` **shell + navigation only** | 3-item advisor nav → ~12-section consumer OS |
| Which UX to replace? | Entry, onboarding, IA, hierarchy | Advisor picks a client family; a consumer *is* the family |
| Which modules stay untouched? | **M1, M2, M3, pre-M4, M5** | All infrastructure. Only M4's shell is re-skinned |
| Which new modules? | Goals, Retirement, Insurance, Estate, Documents, Notifications, Booking, AI CFO | All are **Financial Kernel consumers** per `FUTURE_MODULE_CONTRACT` |

### ⚠️ One naming correction

**M5.5 is already taken.** "M5.5 — V2 Activation" shipped and merged (PR #30). To avoid a collision in the roadmap, this document uses **M6 — Consumer Activation**, and shifts your subsequent milestones by one. Rename freely; the sequence matters more than the labels.

---

## Part 1 — Current architecture assessment

### 1.1 What actually exists (verified inventory)

**Two parallel application stacks share one database.**

**Stack A — V2 Advisory (the Financial Kernel).** 13 household-scoped controllers:
```
households · households/:id/{accounts, net-worth, cashflow, budget, debts,
  financial-snapshot, health-score, health-score/explanation, simulation,
  intelligence, members, entities}
```
Scoped by `HouseholdScopeGuard` (404-not-403), role-gated, audited, RLS-locked.

**Stack B — V1 Retail (the original consumer app).** 12 controllers:
```
profile · accounts · transactions · debts · goals · family · net-worth ·
insights · ai · tools · billing · aa
```
Keyed by `userId`. **This is a consumer product** — goals, family, AI coach, early-warning, free public calculators, subscriptions, and Account Aggregator integration. It was superseded by V2 but never removed.

**`packages/core`** — 20 pure modules: money, fx, networth, cashflow, debt, **retirement, goals, insurance, tax, assetAllocation**, financialHealth(+Explanation), financialSimulation, financialSnapshot, **financialIntelligence**, scores, earlyWarning, recommendations, wealthDna, entitlements. 120 tests.

**Design system** — 15 frozen components (`Badge, Button, Card, Input, Modal, Spinner, States, Table, Text, DashboardLayout, MobileNav, Sidebar, TopNav, ThemeProvider, ThemeToggle`), theme-aware.

**28 Prisma models · 13 additive migrations · RLS lockdown on every table.**

### 1.2 The critical gap: math exists, product doesn't

The pure calculators for **retirement, goals, insurance, allocation, early warning and recommendations exist and are tested** — but in the V2 household stack they are reachable **only** as read-only derivations inside the M5 Intelligence composer, using **default assumptions**.

There is **nowhere to store a household's actual retirement assumptions, insurance policies, or goals.** Confirmed absent from the schema: `Document`, `Notification`, `Booking`, `Estate`, `Beneficiary`, `Holding`, `KYC`.

This is the real M6+ work: not inventing math, but building **household-scoped engines that own inputs** and feed the kernel.

### 1.3 Production readiness (honest)

| Layer | State |
|---|---|
| Kernel, snapshots, intelligence | ✅ Production-ready, tested, frozen |
| Auth backend | ✅ Verified — all flows pass E2E |
| Tenancy, RLS, audit, encryption | ✅ Production-ready |
| Entitlements engine | ✅ Built, tested, **unused by V2** |
| Dashboard (M4/M5) | 🟡 Renders; had never rendered in production until PR #37 |
| AI | 🟡 Exists, but grounded on **V1 retail** data, not the kernel |
| Onboarding / password reset / session refresh | ❌ Blocking gaps (see Part 8) |
| Documents, notifications, booking, estate | ❌ Do not exist |

---

## Part 2 — Product vision assessment

### 2.1 The strategic logic is sound

Selling advisory software to advisors is a low-volume, high-touch, long-cycle business. Selling a free wealth dashboard to consumers and converting the qualified minority into advisory clients is a **funnel** — and you already own the expensive end of it.

The vision's real insight: **the Financial Kernel is the acquisition asset.** A consumer who has entered their balance sheet, captured snapshots, and seen a Wealth Health Score is a *pre-qualified advisory lead with their financial data already structured*. No other acquisition channel delivers that.

### 2.2 The three-user model maps cleanly to what exists

| User | Vehicle | Exists? |
|---|---|---|
| **Consumer** | A Household they own (`HouseholdRole.OWNER`) | Kernel yes; entry no |
| **Family** | Additional `HouseholdMember`s with portal logins | Modelled (`userId`, `MEMBER`/`VIEWER`), unbuilt |
| **Advisor** | A Firm with `Membership`s + assigned households | ✅ **Fully built (M1–M5)** |

The advisory product you already built becomes the **premium tier**, not wasted work.

### 2.3 The honest risk in this vision

**AI-first consumer fintech in India is a crowded, low-willingness-to-pay market.** The differentiator is not the AI — it is that your AI is grounded in a **reconciled, immutable, multi-currency family balance sheet** that competitors don't have, and that a **real SEBI-registered advisor** sits behind it. Lead with that. The moat is the kernel plus the human, not the chat box.

**Recommendation:** treat consumer free tier as **lead generation for advisory**, not as a subscription business, until data proves otherwise. Price Premium to qualify seriousness, not to fund the company.

---

## Part 3 — Asset ledger

### 3.1 Reuse unchanged (do not touch)

| Asset | Why |
|---|---|
| **Financial Kernel** (M2) — engines + immutable snapshot | Household-scoped, user-agnostic. Governed by G-1…G-6 |
| **All 13 household APIs** | Scoped by `householdId`; a consumer household works identically |
| **M3** score, explanation, simulation | Pure functions of a snapshot |
| **M5 Intelligence Layer** | Already the "one calculation, many consumers" contract the vision demands |
| **`@lcos/core`** (20 modules, 120 tests) | The math for every planned module already exists |
| **Entitlements engine** | `free / premium / family_cfo` == your FREE / PREMIUM / SUPER ADVISOR |
| **Design system `@/ui`** | Frozen, theme-aware, mobile-ready |
| **Tenancy, RLS, audit, encryption, `HouseholdScopeGuard`** | Security model is tier-agnostic |
| **`buildAiGroundingContext()`** | Built for exactly this AI product; still unused |

### 3.2 Refactor (keep the logic, change the frame)

| Asset | Change |
|---|---|
| `/app` shell (`app/layout.tsx`) | Advisor chrome + 3-item nav → consumer OS shell; split advisor into its own route group |
| Dashboard page (M4/M5) | Keep every card; re-compose for "my family", drop the household **selector** for consumers |
| `useCurrentHousehold` | Consumer resolves *their* household, not a book of clients |
| AI service | Re-ground from V1 retail `assemble(userId)` → **M5 Intelligence + `buildAiGroundingContext`** |
| Billing UI | Wire the existing entitlement engine into the V2 experience |
| `HouseholdScopeGuard` | **Extend** (not replace) to accept household-membership as well as firm-membership |

### 3.3 Retire (deliberately, later)

The **V1 retail stack** (`profile, accounts, transactions, debts, goals, family, net-worth, insights, ai, tools, billing, aa` + `/dashboard` components). It is the previous consumer app on the pre-kernel data model.

- **Do not delete yet.** Its UX patterns are the best available reference for the consumer build, and `tools` (public calculators) is a live acquisition surface.
- **Do not extend it.** Every new consumer feature goes on the kernel.
- **Retire per-module** as the kernel equivalent ships.

---

## Part 4 — Consumer Product Blueprint

### 4.1 The product in one sentence

> A consumer signs up, answers a short AI-guided onboarding, gets a **Family Balance Sheet** and a **Wealth Health Score** in under 10 minutes, receives **AI recommendations** grounded in their own immutable snapshot — and books a **human advisor** when the stakes are high.

### 4.2 Core object model (no new concepts)

```
User ──owns──▶ Household ("My Family")        ← firmId = NULL (personal)
                 ├── HouseholdMember (spouse, children — optional portal logins)
                 ├── Entity (optional: HUF, company)
                 ├── Account / Transaction / Debt          ← Financial Kernel
                 ├── FinancialSnapshot (immutable)         ← the canonical truth
                 ├── FinancialHealthScore                  ← M3
                 └── Intelligence (derived, M5)            ← every screen reads this
```

When a consumer engages an advisor, the household is **linked to a Firm** — `firmId` moves from `NULL` to the advisor's firm. **The same household, the same data, no migration.** That is the funnel, expressed in one nullable column.

### 4.3 Information architecture

```
MY FINANCIAL OS  (consumer home)
├── Dashboard              Wealth Health Score · net worth · top 3 AI actions
├── AI Family CFO          chat + proactive insights            [PREMIUM]
├── Wealth Health          score breakdown, explainability, history
├── Money
│   ├── Family Balance Sheet   assets & liabilities
│   ├── Net Worth              trend, composition
│   ├── Cash Flow              income, expenses, savings rate
│   └── Documents              vault                            [PREMIUM]
├── Plan
│   ├── Goals                  targets, SIP required, progress
│   ├── Retirement             corpus, gap, readiness
│   ├── Insurance              cover vs need, protection gap
│   ├── Investments            allocation, drift, holdings
│   └── Estate                 beneficiaries, will status       [PREMIUM]
├── Insights                Recommendations · Alerts · Reviews · Simulations
├── Advisor                 Book · Meetings · Shared docs       [FAMILY CFO]
└── Settings                Profile · Family · Subscription · Security
```

**Design principle — one object, many screens.** Every screen above reads a *section* of the M5 `HouseholdFinancialIntelligence` object. No screen recomputes. This is already the architecture; the consumer UI simply consumes more of it.

### 4.4 Navigation map

| Surface | Route group | Who | Shell |
|---|---|---|---|
| Marketing + free tools | `/`, `/tools/*` | Public | Marketing |
| Auth | `/login`, `/signup` | Public | Minimal |
| Onboarding wizard | `/welcome/*` | New consumer | Focused, no chrome |
| **Consumer OS** | **`/me/*`** | Consumer + family | **New consumer shell** |
| **Advisor workspace** | **`/advisor/*`** (from `/app/*`) | Firm members | Existing shell, unchanged |
| Admin | `/admin/*` | Platform admins | Existing |

**Recommendation:** move the advisor experience to `/advisor` and give consumers `/me`. Post-login routing: firm member → `/advisor`; household owner → `/me`; both → a chooser. This keeps the advisor product **intact and shipping** while the consumer product is built beside it, and it is honest about which product the user is in.

### 4.5 Screen inventory (39 screens)

| # | Screen | Reads | Tier | New/Reuse |
|---|---|---|---|---|
| 1 | Landing | — | Free | ✅ exists |
| 2 | Free tools (Health check, retirement, insurance) | core calcs | Free | ✅ exists (`/tools`) |
| 3 | Sign up / Log in | auth | Free | 🟡 refactor |
| 4–8 | Onboarding wizard (Welcome → Profile → Family → Assets/Debts → First Snapshot) | kernel writes | Free | 🆕 |
| 9 | **Consumer Dashboard** | intelligence | Free | 🟡 re-skin M4 |
| 10 | Wealth Health detail | health-score + explanation | Free | 🟡 exists (advisor) |
| 11 | Score history | health-score/timeline | Free | 🟡 |
| 12 | Family Balance Sheet | snapshot | Free | 🟡 exists |
| 13 | Net Worth trend | net-worth/timeline | Free | 🟡 exists |
| 14 | Cash Flow | cashflow | Free | 🟡 exists |
| 15 | Add/Edit account | accounts | Free | 🟡 |
| 16 | Debt & payoff | debts/payoff | Free | 🟡 exists |
| 17–19 | Goals (list, detail, create) | 🆕 goals engine | Free | 🆕 |
| 20–21 | Retirement (plan, assumptions) | 🆕 retirement engine | Premium | 🆕 |
| 22–23 | Insurance (coverage, gap) | 🆕 insurance engine | Premium | 🆕 |
| 24–25 | Investments (allocation, holdings) | assetAllocation | Premium | 🆕 |
| 26–27 | Estate (beneficiaries, docs) | 🆕 estate engine | Premium | 🆕 |
| 28 | Documents vault | 🆕 documents | Premium | 🆕 |
| 29 | **AI Family CFO** chat | intelligence + grounding | Premium | 🆕 (panel exists) |
| 30 | Recommendations | intelligence.recommendedActions | Free (limited) | 🟡 |
| 31 | Alerts / notifications | 🆕 notifications | Free | 🆕 |
| 32 | Simulations / What-if | simulation | Premium | 🟡 exists |
| 33 | Reports | intelligence | Premium | 🆕 |
| 34–36 | Advisor (browse, book, meetings) | 🆕 booking | Family CFO | 🆕 |
| 37 | Subscription / upgrade | billing | All | 🟡 exists |
| 38 | Family & members | members | Free | 🟡 exists |
| 39 | Settings / security | auth | All | 🟡 |

**~20 reuse or re-skin · ~19 new.** The 19 new screens are mostly thin UIs over calculators that already exist.

### 4.6 Screen-by-screen UX — the five that matter

**① Onboarding wizard (the single most important screen set).** Conversion lives or dies here.
- 5 steps, progress bar, **skippable**, resumable. Never block on completeness.
- Step 1 *You*: name, DOB, city, dependants. Step 2 *Family*: add members (skippable). Step 3 *Money in*: income, expenses. Step 4 *What you own/owe*: 3 quick asset rows + debts. Step 5 *Capture snapshot* → **score reveal**.
- **Time-to-value target: < 10 minutes to first Wealth Health Score.** Every extra field costs conversion; the kernel's `Section<T>` degradation means partial data still produces a usable object.

**② Consumer Dashboard.** Answers "how are we doing?" in 5 seconds.
- Hero: **Wealth Health Score** (big, with band + trend) and **Net Worth**.
- Then: **Top 3 AI actions** (from `intelligence.recommendedActions`) — the single highest-value element on the page.
- Then: Capital Health cards (already built), Recent activity, Quick actions.
- **Never** show an empty dashboard: if no snapshot, show the completion path.

**③ AI Family CFO.** Chat + proactive cards. Grounded strictly via `buildAiGroundingContext` on an immutable snapshot; every answer cites *"as of <capturedAt>"*. Free tier gets 3 questions/month as a taste; Premium unlimited. **Never** gives regulated product advice — it routes to the advisor. That boundary is both a compliance requirement and the conversion mechanic.

**④ Goals.** The most emotionally engaging feature and the best retention hook. Card per goal: target, date, progress ring, **"₹X/month needed"** (`planGoal` already exists). Nudge when off-track.

**⑤ Book an Advisor.** The commercial endpoint. Shows the advisor's credentials, what they'll review (pulled from the user's actual weak scores — *"Your protection gap is ₹X; a 30-min review is recommended"*), calendar slot, payment. **Contextual, not generic** — this is why the kernel matters commercially.

### 4.7 Wireframe recommendations

- **Mobile-first.** Indian consumer wealth usage is overwhelmingly mobile; the current design system already has `MobileNav`.
- **Bottom tab bar on mobile** (Dashboard · Money · Plan · AI · More); sidebar on desktop.
- **Card-per-insight**, one number per card, band colour + plain-language sentence.
- **Progressive disclosure:** free users see Premium cards **populated but blurred** with an upgrade CTA — the strongest converter, and honest (the data is theirs).
- **Never a blank state:** every empty card carries the exact action that fills it.
- Accessibility: never colour alone; the existing `ScoreCard` already conveys state in text.

---

## Part 5 — Business model

### 5.1 Tiers (map directly to the existing engine)

| Tier | Price (suggested) | Features (existing `FeatureKey`s) |
|---|---|---|
| **FREE** | ₹0 | `wealth_health_check`, `family_balance_sheet`, `asset_allocation`, `retirement_calculator`, `goal_planning`, `debt_payoff_basic` + limited AI |
| **PREMIUM** | ₹499/mo *(already seeded)* | `ai_recommendations`, `scenario_simulator`, `advanced_analytics`, `account_aggregation`, `knowledge_vault` |
| **FAMILY CFO** | ₹1,999/mo *(already seeded)* + advisory fees | `advisor_consultation`, `family_members_unlimited` |

**No engine work required** — `resolveEntitlements()` and `assertFeature()` already implement tier inheritance and per-user overrides.

**New `FeatureKey`s to add** (additive to the union): `estate_planning`, `tax_planning`, `document_vault`, `unlimited_snapshots`, `financial_reports`.

### 5.2 Feature matrix

| Capability | Free | Premium | Family CFO |
|---|---|---|---|
| Wealth Health Score | ✅ | ✅ | ✅ |
| Balance sheet · Net worth · Cash flow | ✅ | ✅ | ✅ |
| Goals | 3 goals | Unlimited | Unlimited |
| Snapshots | 1/month | Unlimited | Unlimited |
| AI Family CFO | 3 Q/month | Unlimited | Unlimited |
| Retirement · Insurance · Tax | Calculator only | Full planning | Full + advisor |
| Simulations | — | ✅ | ✅ |
| Documents vault | — | ✅ | ✅ |
| Estate planning | — | ✅ | ✅ |
| Reports | — | ✅ | ✅ |
| Human advisor | — | — | ✅ |
| Product execution (MF/PMS/AIF/insurance) | — | — | ✅ |

### 5.3 The commercial thesis

Free tier is **customer acquisition for the advisory business**, not a revenue line. A user who completes onboarding has handed you a structured balance sheet — the most expensive artifact in advisory sales — for free. Premium filters for seriousness. Family CFO is where the real economics sit (advisory fees + product margin).

**Instrument accordingly:** the metric that matters is **onboarding-completion → snapshot-captured → advisor-booked**, not MRR from Premium.

---

## Part 6 — Impact analysis

### 6.1 Database impact

**Change to an existing table: exactly one.**

```prisma
model Household {
  firmId String?   // was: String — allows personal (unadvised) households
  firm   Firm?     @relation(...)
}
```
Additive and backward-compatible: every existing row keeps its `firmId`. Requires updating queries that assume `firmId` is present, plus `HouseholdScopeGuard`.

*Alternative considered and rejected:* auto-creating a hidden "personal firm" per consumer. Zero schema change, but it pollutes the firm table, corrupts advisory analytics, and forces "firm" semantics into consumer code forever. **Take the nullable column.**

**New tables** (all additive, RLS-locked, household-scoped, per `FUTURE_MODULE_CONTRACT`):

| Table | Module | Notes |
|---|---|---|
| `HouseholdGoal` | Goals | Not the retail `Goal` (userId-keyed) |
| `RetirementPlan` | Retirement | The assumptions M5 currently defaults |
| `InsurancePolicy` | Insurance | Existing cover — M5's missing input |
| `EstatePlan`, `Beneficiary` | Estate | |
| `Document` | Vault | + object storage (S3/R2) |
| `Notification` | Alerts | |
| `AdvisorBooking` | Booking | |
| `AiConversation`, `AiMessage` | AI CFO | grounded, `snapshotId`-referenced |
| `FinancialIntelligence` | M5 persistence | deferred in M5; needed for reports/history |

**Unchanged: all 28 existing models** except the one nullable column. `FinancialSnapshot` `schemaVersion 1` is **untouched** — governance G-3 holds.

### 6.2 API impact

**Zero breaking changes. All 13 household APIs remain valid verbatim.**

| Change | Type |
|---|---|
| `POST /households/self` — create my personal household | 🆕 additive |
| `GET /me/household` — resolve the caller's household | 🆕 additive |
| `HouseholdScopeGuard` accepts household-membership | 🟡 **extend**, not replace |
| `/households/:id/{goals, retirement, insurance, estate, documents, notifications}` | 🆕 additive, mirrors existing engine shape |
| `POST /households/:id/ai/*` | 🆕 additive |
| `POST /advisor/bookings` | 🆕 additive |
| `POST /households/:id/link-firm` | 🆕 the funnel: consumer → advised |
| Existing `/firms/*`, `/households/*` | ✅ unchanged |
| V1 retail `/accounts`, `/goals`, `/ai`… | 🔻 frozen, retire later |

**The guard change is the sensitive one.** It currently resolves a household → firm → membership. It must additionally allow `HouseholdMember.userId == caller` with `HouseholdRole`. This is a **security-critical change** and needs its own PR, its own e2e tests, and explicit review — a mistake here is cross-tenant data exposure.

### 6.3 Migration strategy

**No data migration.** Existing advisory households keep `firmId`; new consumer households have `firmId = NULL`. Both flow through the same kernel.

The **consumer → advised** transition is a single field update (`link-firm`), preserving all history, snapshots and scores. That is a genuine product advantage: a user's entire financial history carries into the advisory relationship with zero friction.

The V1 retail stack is **frozen, then retired module-by-module** as kernel equivalents ship. Retail users (if any) migrate via a one-time "import my data into my household" job — deferred until there are users to migrate.

---

## Part 7 — Execution

### 7.1 Development sequence & PR plan

**Phase 0 — Stabilise (must precede consumer launch).** These are live defects; see Part 8.

| PR | Scope |
|---|---|
| P0-1 | Web session refresh (users currently log out every ~15 min) |
| P0-2 | Email provider → password reset + verification |
| P0-3 | Playwright smoke test in CI (login → dashboard renders) |
| P0-4 | Ops: DB backups, credit alerts, rotate secrets, "Wait for CI" |

**Phase 1 — M6 Consumer Activation.**

| PR | Scope | Risk |
|---|---|---|
| M6-1 | **Design doc + ADR:** personal households (`firmId` nullable) | — |
| M6-2 | Schema: nullable `firmId` + migration | Low |
| M6-3 | **`HouseholdScopeGuard` extension** + e2e isolation tests | **High — security** |
| M6-4 | `POST /households/self`, `GET /me/household` | Low |
| M6-5 | Consumer route group `/me` + shell (reuses `@/ui`) | Low |
| M6-6 | Advisor moved `/app` → `/advisor`; post-login router | Medium (UX) |
| M6-7 | Onboarding wizard (5 steps) | Medium |
| M6-8 | Consumer dashboard (re-skin M4/M5 cards) | Low |
| M6-9 | Entitlements wired into V2 + upgrade UI | Low |
| M6-10 | Household Goals engine (core `planGoal` exists) | Low |

**Phase 2 — M7 Wealth Health Experience.** Score detail, history, explainability UI, improvement simulator.
**Phase 3 — M8 Family Balance Sheet & Net Worth.** Rich asset entry, categorisation, trends, AA auto-linking.
**Phase 4 — M9 AI Family CFO.** Re-ground AI on M5 + `buildAiGroundingContext`; conversations; proactive insights; quotas.
**Phase 5 — M10 Planning modules.** Retirement · Insurance · Estate · Documents (each = kernel consumer + own table).
**Phase 6 — M11 Advisor Booking & Monetisation.** Booking, meetings, `link-firm`, payments.
**Phase 7 — M12 Production Launch.** Notifications, reports, observability, performance, compliance.

### 7.2 Roadmaps

**Engineering:** Phase 0 (~1 week) → M6 (~3–4 weeks) → M7–M8 (~4 weeks) → M9 (~3 weeks) → M10 (~4 weeks) → M11 (~3 weeks) → M12 (~2 weeks). *Indicative, single-developer-plus-AI pace.*

**Product:** Free dashboard (M6–M8) → AI differentiation (M9) → Planning depth (M10) → Advisory funnel (M11) → Scale (M12).

**Business:** Pilot 10 known families (post-M6) → 100 free users (post-M8) → introduce Premium (post-M9) → advisory conversion (post-M11) → paid acquisition (post-M12).

**Go-to-market:** Free public calculators (`/tools` — already built) as top-of-funnel → Wealth Health Check as the hook → email/WhatsApp nurture on score improvement → advisor booking for high-gap users. **Do not spend on acquisition before M9** — there is no differentiated product to retain users yet.

---

## Part 8 — Risks & launch

### 8.1 Technical risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Guard change leaks cross-tenant data** | 🔴 Critical | Dedicated PR, exhaustive e2e (consumer cannot see other households; advisor scope unchanged), security review |
| **Two shells diverge** (`/me` vs `/advisor`) | 🟡 Medium | Both compose the same frozen `@/ui` and read the same M5 object |
| **No automated UI coverage** | 🔴 High | A total-crash bug reached production undetected (PR #37). Playwright smoke tests are Phase 0, not optional |
| **Kernel erosion** — new modules bypassing snapshots | 🟡 Medium | `FUTURE_MODULE_CONTRACT` + PR checklist; enforce in review |
| Session expiry (15 min) | 🔴 High | Phase 0 fix |
| Single region (US West) vs Indian users | 🟡 Medium | Plan India region before scale |
| AI cost at consumer volume | 🟡 Medium | Quotas by tier; prompt caching already used; snapshot grounding is bounded |

### 8.2 Business risks

| Risk | Mitigation |
|---|---|
| **Free users never convert** | Instrument the funnel from day one; conversion is the metric, not signups |
| **Regulatory (SEBI/IRDAI)** — AI giving investment advice | Hard boundary: AI **educates**, advisor **advises**. Compliance review before M9 ships |
| **Data trust** — families won't enter net worth into an unknown brand | Lead with encryption/DPDP; the audit trail and RLS are genuine differentiators — say so |
| Advisor capacity becomes the bottleneck | Booking limits; tier gating; this is a *good* problem — design for it |
| Building for a market of one (you) | The pilot cohort must be **10 real families you don't control** |

### 8.3 Launch checklist

**Security:** guard e2e green · secrets rotated · `SANDBOX_RETURN_SECRETS=false` · RLS on all new tables · PII encrypted · DPDP consent captured.
**Reliability:** DB backups + restore rehearsed · error alerting · uptime monitoring · Playwright smoke in CI · "Wait for CI" on.
**Product:** onboarding completes in < 10 min · dashboard never empty · every Premium gate has an upgrade path · mobile verified · AI cites its snapshot and refuses regulated advice.
**Commercial:** plans priced · payment tested end-to-end · advisor calendar live · funnel analytics instrumented.
**Legal:** T&C · privacy policy · advisory disclosure · SEBI/IRDAI positioning reviewed.

---

## Part 9 — PRD (condensed)

**Product.** Life Capital OS — The AI Operating System for Personal & Family Wealth.
**Problem.** Indian families have no consolidated, trustworthy view of household wealth, and no affordable access to competent advice.
**Solution.** A free AI-guided family wealth dashboard built on an immutable financial kernel, with a human advisor one click away.
**Primary user.** The financially-responsible adult in an Indian household, 30–55, multiple accounts, dependants, no consolidated view.
**Core loop.** Capture → Score → Understand → Act → Re-capture. Each cycle deepens the data and improves the AI's grounding.
**Success metrics.** Onboarding completion > 60% · first snapshot < 10 min · 30-day return > 40% · free→premium > 5% · premium→advisor > 10%.
**Non-goals (v1).** Not a budgeting/expense-tracking app · not a trading terminal · not an advisor CRM (that already exists as the premium tier).
**Compliance.** AI educates; humans advise. All product transactions execute through the regulated advisory entity.

---

## Part 10 — Final recommendation

**Proceed. Do not rebuild anything.**

The previous architecture was built with enough discipline — household scoping, dual-keyed tables, an entitlements engine, a PII-redacted AI grounding contract, a frozen kernel with a formal consumer contract — that this evolution is **an experience layer plus one nullable column**. That is an unusually good position, and it is a direct result of the engineering rigour already applied.

**The three things I would insist on before writing consumer code:**

1. **Fix Phase 0 first.** Shipping a consumer product where users are logged out every 15 minutes and can never reset a password will burn the launch. One week.
2. **Treat the guard change as a security project,** not a feature. It is the only change in this entire plan that can expose one family's finances to another.
3. **Get 10 real families using it before building M9–M11.** Every roadmap item after M8 is a guess until real consumers touch the product. The kernel is proven; the *product* is not.

**What I would not do:** do not delete the advisor workspace, do not fork the codebase, do not start a new repository, and do not touch `schemaVersion 1`.

---

*Design review only. No code, schema, API, or ADR was modified in producing this document.*
