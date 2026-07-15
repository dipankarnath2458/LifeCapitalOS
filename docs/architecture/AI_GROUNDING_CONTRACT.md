# AI Grounding + PII Redaction Contract

> **Status:** Active (pre-Module-4 hardening). Normative for **all** M4+ AI code. Companion to
> [`AI_INTEGRATION_ARCHITECTURE.md`](./AI_INTEGRATION_ARCHITECTURE.md) and the
> [`FUTURE_MODULE_CONTRACT.md`](./FUTURE_MODULE_CONTRACT.md). Implemented as a pure helper in
> `@lcos/core/finance/aiGrounding.ts` (`buildAiGroundingContext`, `containsNoPiiKeys`), version
> `redact-1.0.0`.

## 1. The rule

> **AI models receive an `AiGroundingContext` built from an immutable Financial Snapshot — never a raw payload,
> never raw tables, never PII.**

Every AI feature (advisor, Family CFO, insights) MUST call `buildAiGroundingContext(envelope, payload)` and pass
**only** its result to a model. It MUST NOT pass the raw `FinancialSnapshotPayload`, query engine tables, or
recompute figures.

## 2. What the context contains (redaction `redact-1.0.0`)

| Section | Included | Deliberately dropped |
| --- | --- | --- |
| `provenance` | `snapshotId`, `schemaVersion`, `engineVersion`, `fxVersion`, `currency`, `capturedAt`, `status`, `redactionVersion` | — |
| `financial` | `netWorth`, `debt`, `cashflowSummary`, `budgetSummary`, `assetAllocation`, `currencyExposure`, `householdEquity` (aggregates only) | per-account `assets[]`/`liabilities[]` rows, `entityHoldings[]` |
| `structure` | `memberCount`, `entityCount`, `accountCount` | raw `accountIds`/`entityIds` arrays |
| `demographics` | `ageYears`, `isDependent`, `relation` per member | `memberId`, names, dates of birth |
| `notes` | grounding disclaimers (base currency, do-not-recompute, redaction statement) | — |

**Never present, anywhere in the context:** names, tax ids / PAN, dates of birth, email, phone, or
account/entity/member ids. `containsNoPiiKeys()` enforces this and is asserted in tests.

## 3. Why

- **Reproducibility:** the context cites the exact `snapshotId` + `schemaVersion` + `redactionVersion`, so any
  AI answer can be re-derived and audited.
- **Safety:** the model reasons over a **validated, frozen, PII-light** aggregate — never a half-written ledger
  or identifying data.
- **Least privilege:** aggregates + counts + coarse demographics are sufficient for planning; ids/names are not
  shared with the model.
- **Determinism:** `buildAiGroundingContext` is pure (no IO/clock/randomness).

## 4. Enforcement

- **Structural:** AI services depend on `buildAiGroundingContext`; they do not import engine repositories or the
  raw payload into prompts.
- **Runtime guard:** `containsNoPiiKeys(context)` can be asserted before any model call; the redaction contract
  is covered by unit tests.
- **Versioned:** a change to what is included/redacted bumps `AI_REDACTION_VERSION` (mirrors `schemaVersion` /
  `scoreModelVersion` discipline); old grounding logs keep their version.

## 5. Scope note

This hardening ships the **contract + pure helper + tests**. The M4 AI fleet consumes it (grounding a specific
`snapshotId`, logging the grounding for audit/repro). No AI endpoint is added here.
