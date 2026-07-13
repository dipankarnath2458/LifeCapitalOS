# 07 — AI Agents & Responsibilities

> **Doc:** AI architecture for Phase 2. **Status:** Draft for review.
> **Related:** [Modules MOD-6](./02_MODULES.md) · [API](./06_API_SERVICE_ARCHITECTURE.md) · [Workflows](./08_WORKFLOWS.md)

Phase 2 generalizes the V2 AI pattern (Wealth Coach + Second Opinion, grounded in
`FinancialSnapshot`, "never invent numbers", graceful deterministic fallback, entitlement-gated) into
a **fleet of specialized agents** behind one **orchestration layer**. Agents **assist**; humans
**decide** — anything that leaves the system or changes a client's plan is human-approved (product
principle 2, PRD §5).

---

## 1. Design tenets (carried from V2, hardened)

1. **Grounded only in real data.** Every agent's context is built from the household's
   `FinancialSnapshot` + `@lcos/core` outputs. The system prompt forbids inventing figures not in the
   grounding block. Numbers come from deterministic core functions, not the model.
2. **Deterministic core, narrative model.** Math (scores, drift, gaps, SIP) is computed in
   `@lcos/core`; the model only explains, prioritizes, and drafts prose.
3. **Human-in-the-loop.** Agent output is a **draft/alert**, never an executed action. Client-facing
   artifacts require advisor review; plan changes require client approval.
4. **Gated, audited, reproducible.** Each run checks `assertFeature`, writes an `AgentRun` row
   (kind, `inputHash`, model, tokens, outcome), and is tenant-scoped.
5. **Compliance-safe (SEBI/DPDP).** Educational tone; no specific buy/sell recommendations presented
   as personalized investment advice; no PII leaves the tenant boundary beyond the model call; prompt
   caching of the grounding block (V2 pattern).
6. **Degrade, don't fail.** No `ANTHROPIC_API_KEY` → deterministic fallback text from core, marked
   `degraded` on the run. Model errors never hard-fail the request.

---

## 2. Orchestration layer

`AgentOrchestratorService` (new; MOD-6.1) is the single entry point for every agent:

```
run(kind, householdId, triggeredBy)
  1. assertFeature(firm entitlement for `kind`)            ← gate
  2. HouseholdScopeGuard already ensured scope             ← isolation
  3. snapshot = FinancialSnapshotService.build(householdId)← grounding (real data)
  4. context  = Grounder[kind](snapshot, core-outputs)     ← per-agent context builder
  5. persist AgentRun(queued→running, inputHash)           ← audit/repro
  6. result   = ModelClient.run(prompt[kind], context)     ← Anthropic (or fallback)
  7. validate(result) — schema + "no numbers outside snapshot" post-check
  8. persist AgentRun(succeeded|degraded|failed, tokens, outputRef)
  9. emit `agent.completed` → notifications / task drafts  ← human review
```

- Runs execute in the **`agents` BullMQ queue** (never in the request path; NFR-5).
- The **post-check** re-scans generated text for numeric claims and flags any figure not present in
  the grounding block, so a hallucinated number is caught before a human sees it as fact.
- **Model:** Anthropic Claude via `@anthropic-ai/sdk` (V2), model from `ANTHROPIC_MODEL`; grounding
  block uses prompt caching.

---

## 3. The agent fleet

| Agent | Kind | Job | Inputs (grounding) | Output | Gate |
|---|---|---|---|---|---|
| **Wealth Analyst** | `wealth_analyst` | Holistic household analysis + prioritized narrative (generalizes V2 Wealth Coach) | snapshot, Life Capital Score + sub-scores, early-warning, top actions | Narrative analysis + ranked recommendations (draft) | `ai_recommendations` |
| **Allocation** | `allocation` | Detect allocation drift vs. target; suggest rebalancing bands (generalizes V2 Second Opinion) | current vs. target allocation, drift from `@lcos/core`, risk tolerance | Drift explanation + rebalancing suggestion (draft) | `ai_recommendations` |
| **Protection** | `protection` | Assess insurance adequacy vs. dependents & liabilities | insurance-gap calc, dependents, liabilities, term cover | Gap summary + coverage suggestion (draft) | `ai_recommendations` |
| **Document** | `document` | Classify uploads; extract key fields (policy no., maturity, sum assured, dates) | uploaded doc (OCR/text), type taxonomy | Suggested `DocumentType`, tags, extracted fields (for human confirm) | `document_ai` |
| **Ops/Task** | `ops` | Turn alerts & review findings into concrete draft tasks | early-warning signals, review checklist, open items | Draft `Task`s with titles/priorities/owners | `workflow_ai` |
| **Report** | `report` | Draft the narrative sections of a household/firm report | snapshot, scores, goals, period deltas | Report prose (advisor edits before send) | `advanced_analytics` |

Entitlement keys are additive to the V2 engine; each adds a `FeatureKey` + `assertFeature` gate
(never ad-hoc). Firm plans (MOD-12) bundle these keys.

---

## 4. Grounding contract (per agent)

Each agent has a **Grounder** that assembles a strict, typed context object — never free-form DB
dumps — from `FinancialSnapshot` + `@lcos/core`:

```
GroundingBlock = {
  household: { baseCurrency, memberCount, dependents, riskTolerance },
  netWorth:  { assetsMinor, liabilitiesMinor, netWorthMinor, currency },
  scores:    { lifeCapital, wealth, retirement, protection, liquidity },
  signals:   EarlyWarning[],           // traffic-light from real snapshot
  allocation:{ current[], target[], driftPct },   // allocation agent
  protection:{ recommendedCoverMinor, shortfallMinor },  // protection agent
  topActions: Recommendation[],
}
```

The model receives this block (cached) + a task-specific instruction. It must reference only these
figures. Anything outside → post-check flags it.

---

## 5. Triggers & scheduling

| Trigger | Agents | Cadence |
|---|---|---|
| Advisor clicks "Run analysis" | any | on demand (`POST /agents/run`) |
| Household created / onboarded | wealth_analyst | once, on onboarding completion |
| Document uploaded | document | on `document.scanned` event |
| Early-warning threshold crossed | ops, protection | on `snapshot.captured` sweep |
| Report generation started | report | within the `reports` job |
| Firm review cadence (quarterly) | wealth_analyst, allocation | scheduled per firm |

Scheduled runs are cron-driven jobs (doc 06 §5); their volume is entitlement- and rate-limited per
firm to control model cost.

---

## 6. Guardrails, safety & cost

- **PII minimization:** the grounding block carries figures and coarse attributes, not raw names/IDs
  where avoidable; names stay encrypted at rest and are excluded from prompts unless required.
- **No autonomous side effects:** agents never write to accounts, send client messages, or approve
  anything. They only produce drafts, alerts, and classifications for human action.
- **Rate & cost control:** per-firm run quotas; token accounting on every `AgentRun`; scheduled runs
  batched; grounding cached.
- **Auditability:** `AgentRun.inputHash` lets a run be reproduced/justified; every run is tenant-scoped
  and visible in `/app/ai` and the audit log.
- **Fallback determinism:** every agent has a deterministic `@lcos/core`-only output so the feature
  works (in reduced form) without a model key — same posture as V2.
- **Evaluation:** a golden-set of household fixtures + expected core numbers gates prompt/model
  changes; the numeric post-check is part of the test suite.

---

## 7. What stays out of scope (Phase 2)

- Fully autonomous agents that act without human approval (non-goal; principle 3).
- Agents that place trades or move money (non-goal N1/N5).
- A general chat that answers outside the household's grounded data (the analyst agent is scoped, not
  a free-roaming assistant).
- Fine-tuned/self-hosted models — we use the hosted Anthropic API with the abstraction already in V2,
  so the provider can be swapped behind `ModelClient` if ever needed.
