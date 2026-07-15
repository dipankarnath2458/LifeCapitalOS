import { FinancialSnapshotPayload } from './financialSnapshot.js';

/**
 * AI Grounding + PII Redaction Contract (M3 hardening). A **pure, deterministic**
 * transform that turns an immutable Financial Snapshot into the ONLY object an AI layer
 * may consume: a redacted, provenance-stamped grounding context. See
 * docs/architecture/AI_GROUNDING_CONTRACT.md. No IO, clock, or randomness. AI code MUST
 * build this and MUST NOT pass raw payloads or raw tables to a model.
 */

export const AI_REDACTION_VERSION = 'redact-1.0.0';

/** The immutable snapshot envelope fields the grounding context cites for reproducibility. */
export interface GroundingProvenance {
  snapshotId: string;
  schemaVersion: number;
  engineVersion?: string;
  fxVersion?: string;
  currency: string;
  capturedAt?: string;
  status?: string;
  redactionVersion: string;
}

export interface AiGroundingContext {
  provenance: GroundingProvenance;
  /** Aggregates only — no per-account rows, no ids beyond counts. All base-currency minor units. */
  financial: {
    netWorth: FinancialSnapshotPayload['netWorth'];
    debt: FinancialSnapshotPayload['debt'];
    cashflowSummary: FinancialSnapshotPayload['cashflowSummary'];
    budgetSummary: FinancialSnapshotPayload['budgetSummary'];
    assetAllocation: FinancialSnapshotPayload['assetAllocation'];
    currencyExposure: FinancialSnapshotPayload['currencyExposure'];
    householdEquity: FinancialSnapshotPayload['householdEquity'];
  };
  /** Structure by counts only — never ids/names. */
  structure: {
    memberCount: number;
    entityCount: number;
    accountCount: number;
  };
  /** PII-light demographics — age/dependency/relation only, no member ids/names/DOB. */
  demographics: { ageYears: number | null; isDependent: boolean; relation: string }[];
  notes: string[];
}

export interface GroundingEnvelope {
  snapshotId: string;
  schemaVersion: number;
  engineVersion?: string;
  fxVersion?: string;
  currency: string;
  capturedAt?: string;
  status?: string;
}

/**
 * Build the redacted grounding context for AI consumption. **Drops** per-account rows,
 * raw id arrays, and member ids; **keeps** aggregates + coarse demographics; **never**
 * emits names, taxIds, dates of birth, or account/entity/member ids. Deterministic.
 */
export function buildAiGroundingContext(
  envelope: GroundingEnvelope,
  payload: FinancialSnapshotPayload,
): AiGroundingContext {
  return {
    provenance: {
      snapshotId: envelope.snapshotId,
      schemaVersion: envelope.schemaVersion,
      engineVersion: envelope.engineVersion,
      fxVersion: envelope.fxVersion,
      currency: envelope.currency,
      capturedAt: envelope.capturedAt,
      status: envelope.status,
      redactionVersion: AI_REDACTION_VERSION,
    },
    financial: {
      netWorth: payload.netWorth,
      debt: payload.debt,
      cashflowSummary: payload.cashflowSummary,
      budgetSummary: payload.budgetSummary,
      assetAllocation: payload.assetAllocation,
      currencyExposure: payload.currencyExposure,
      householdEquity: payload.householdEquity,
    },
    structure: {
      memberCount: payload.relationships.memberCount,
      entityCount: payload.relationships.entityCount,
      accountCount: payload.relationships.accountIds.length,
    },
    demographics: (payload.members ?? []).map((m) => ({
      ageYears: m.ageYears,
      isDependent: m.isDependent,
      relation: m.relation,
    })),
    notes: [
      `Grounded on immutable snapshot ${envelope.snapshotId} (schemaVersion ${envelope.schemaVersion}, ${envelope.currency}).`,
      'Figures are consolidated in the household base currency; do not recompute or convert.',
      'Redacted: no names, tax ids, dates of birth, or account/entity/member ids.',
    ],
  };
}

/**
 * Defensive guard: true when a value tree contains no forbidden PII-ish keys. Used by
 * tests (and callers that want a runtime assertion) to enforce the redaction contract.
 */
export function containsNoPiiKeys(value: unknown): boolean {
  const forbidden = new Set([
    'name',
    'fullName',
    'taxId',
    'pan',
    'dateOfBirth',
    'dob',
    'email',
    'phone',
    'accountId',
    'entityId',
    'memberId',
    'accountIds',
    'entityIds',
  ]);
  const walk = (v: unknown): boolean => {
    if (Array.isArray(v)) return v.every(walk);
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (forbidden.has(k)) return false;
        if (!walk(val)) return false;
      }
    }
    return true;
  };
  return walk(value);
}
