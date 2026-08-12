import { FinancialSnapshotPayload, reconciledNetWorthMinor } from './financialSnapshot.js';

/**
 * AI Grounding + PII Redaction Contract (M3 hardening). A **pure, deterministic**
 * transform that turns an immutable Financial Snapshot into the ONLY object an AI layer
 * may consume: a redacted, provenance-stamped grounding context. See
 * docs/architecture/AI_GROUNDING_CONTRACT.md. No IO, clock, or randomness. AI code MUST
 * build this and MUST NOT pass raw payloads or raw tables to a model.
 */

/**
 * Bumped to 1.1.0 when `financial.netWorth` stopped being the raw payload block and became the
 * reconciled view below. Old grounding logs keep their version, so an answer can still be read
 * against the contract that produced it.
 */
export const AI_REDACTION_VERSION = 'redact-1.1.0';

/**
 * Net worth as presented to a model.
 *
 * The raw payload block was passed straight through here, and its `netWorthMinor` is assets minus
 * liability **accounts** — which for a consumer household excludes their loans entirely, because
 * the wizard writes every loan to the debt ledger. The reconciled figure was present in the
 * context all along, but only as `householdEquity.reconciledEquityMinor`, a name that does not
 * announce itself as net worth. Asked what a family was worth, a model quoted the field called
 * `netWorth.netWorthMinor` and overstated it by the size of their mortgage.
 *
 * So the field a reader will reach for now holds the figure a reader means, and the accounts-only
 * figure keeps a name that says what it is. Deliberately identical in shape and meaning to the
 * intelligence layer's `netWorth` section, so the dashboard and the model cannot describe the
 * same household differently.
 */
export interface GroundedNetWorth {
  assetsMinor: number;
  /** Liability-flagged **accounts** only (overdrafts, credit cards). Excludes the debt ledger. */
  liabilitiesMinor: number;
  /** Outstanding across the M2-5 debt ledger (home loans, personal loans, …). */
  totalDebtMinor: number;
  /** Assets minus everything owed — liability accounts **and** the debt ledger. */
  netWorthMinor: number;
  /** Assets minus liability accounts only, before the debt ledger. Not "net worth". */
  grossNetWorthMinor: number;
  /** Reconciled net worth as a share of assets — consistent with `netWorthMinor`. */
  solvencyRatio: number;
}

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
    netWorth: GroundedNetWorth;
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
 * The reconciled net-worth view, from the payload's own two figures.
 *
 * Uses the shared `reconciledNetWorthMinor` rather than subtracting here, so this and the
 * intelligence layer cannot drift apart — the drift is precisely how the gross figure survived
 * in this file after the dashboard was fixed.
 */
function groundedNetWorth(p: FinancialSnapshotPayload): GroundedNetWorth {
  const reconciled = reconciledNetWorthMinor(p);
  return {
    assetsMinor: p.netWorth.assetsMinor,
    liabilitiesMinor: p.netWorth.liabilitiesMinor,
    totalDebtMinor: p.debt?.totalOutstandingMinor ?? 0,
    netWorthMinor: reconciled,
    grossNetWorthMinor: p.netWorth.netWorthMinor,
    solvencyRatio: p.netWorth.assetsMinor > 0 ? reconciled / p.netWorth.assetsMinor : 0,
  };
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
      netWorth: groundedNetWorth(payload),
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
      // Stated in the context itself, not only in the field names: a model reads prose as
      // readily as it reads keys, and this is the distinction it got wrong.
      'netWorth.netWorthMinor is AFTER all borrowings (liability accounts and the debt ledger). ' +
        'netWorth.grossNetWorthMinor excludes the debt ledger and is not the household net worth.',
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
