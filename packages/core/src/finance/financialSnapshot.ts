import { CurrencyCode } from '../money/money.js';

/**
 * The Financial Snapshot contract (M2-6) — the canonical, versioned read model.
 * See docs/architecture/M2_FINANCIAL_SNAPSHOT_CONTRACT.md. This module is **pure**
 * (browser-safe, no crypto/IO): version constants, the payload shape, a canonical
 * serializer for hashing, and the schema up-converter registry. The SHA-256 checksum
 * itself is computed server-side (node crypto) over `canonicalStringify(payload)`.
 */

/** Payload shape version. Bumped only on a breaking payload change (additive-only otherwise). */
export const FINANCIAL_SNAPSHOT_SCHEMA_VERSION = 1;

/** Semver of the composing logic + core finance used to build a payload. */
export const FINANCIAL_SNAPSHOT_ENGINE_VERSION = 'm2-6.1.0';

export interface FinancialSnapshotPayload {
  netWorth: {
    assetsMinor: number;
    liabilitiesMinor: number;
    netWorthMinor: number;
    solvencyRatio: number;
  };
  assets: {
    accountId: string;
    name: string;
    assetClass: string | null;
    entityId: string | null;
    nativeCurrency: string;
    nativeBalanceMinor: number;
    baseBalanceMinor: number;
  }[];
  liabilities: {
    accountId: string;
    name: string;
    entityId: string | null;
    nativeCurrency: string;
    nativeBalanceMinor: number;
    baseBalanceMinor: number;
  }[];
  debt: {
    totalOutstandingMinor: number;
    totalMonthlyPaymentMinor: number;
    weightedAvgRatePct: number;
    debtCount: number;
    byType: { type: string; outstandingMinor: number }[];
  };
  cashflowSummary: {
    period: string;
    incomeMinor: number;
    expenseMinor: number;
    netMinor: number;
    savingsRate: number;
    byCategory: { category: string; amountMinor: number }[];
  };
  budgetSummary: {
    period: string;
    exists: boolean;
    totalBudgetMinor: number | null;
    totalSpentMinor: number;
    overTotal: boolean;
  };
  assetAllocation: { assetClass: string; baseValueMinor: number; pct: number }[];
  currencyExposure: { currency: string; baseValueMinor: number; pct: number }[];
  householdEquity: {
    netWorthMinor: number;
    totalDebtMinor: number;
    reconciledEquityMinor: number;
  };
  entityHoldings: {
    entityId: string | null;
    assetsMinor: number;
    liabilitiesMinor: number;
    debtOutstandingMinor: number;
    netMinor: number;
  }[];
  relationships: {
    memberCount: number;
    entityCount: number;
    entityIds: string[];
    accountIds: string[];
  };
  /**
   * Coarse household demographics (M3 hardening) — **optional, additive to schemaVersion
   * 1**. Deliberately PII-light: `ageYears` (not date of birth), dependency, and relation
   * only — never names/DOB/taxIds (ADR-006). Enables Retirement / Insurance / AI-CFO
   * planning without reaching around the kernel. Absent on pre-existing snapshots.
   */
  members?: {
    memberId: string;
    ageYears: number | null;
    isDependent: boolean;
    relation: string;
  }[];
}

/**
 * Deterministic canonicalization: recursively sort object keys so the same logical
 * payload always serializes to the same string (a stable checksum input). Arrays keep
 * their order (order is meaningful in the payload).
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Canonical JSON string of a payload — the exact bytes the checksum is taken over. */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Up-convert a stored payload to a newer schema version on read, without mutating
 * storage. Identity for v1 — the registry exists so future versions can present old
 * snapshots at the latest shape for consumers that want only one shape.
 */
export function upgradePayload(
  payload: FinancialSnapshotPayload,
  fromVersion: number,
  toVersion: number,
): FinancialSnapshotPayload {
  if (fromVersion === toVersion) return payload;
  // No breaking versions exist yet; future up-converters chain here.
  return payload;
}

export interface FinancialSnapshotMeta {
  currency: CurrencyCode;
  schemaVersion: number;
  engineVersion: string;
  fxVersion: string;
}
