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
    /**
     * The kind of account holding this asset — `Account.type` (M5.15, Gap 6; ADR-014).
     *
     * **Optional and additive**, so `schemaVersion` stays 1 (ADR-012, contract §8, following the
     * `members` precedent). Distinct from `assetClass`, which says what kind of *asset* this is:
     * a PPF balance is `accountType: 'retirement'` with `assetClass: 'debt'`, and without this
     * field it is indistinguishable from a taxable debt fund.
     *
     * **`undefined` means "this snapshot was captured before account types were recorded".**
     * It does NOT mean `other_asset`, and it must never be defaulted to one — snapshots are
     * never rewritten (ADR-004/012), so pre-M5.15 payloads carry no type and never will.
     * Substituting a value here would assert a fact about a family that nobody recorded, which
     * is the `unknown → false` failure this codebase has fixed four times (#67, M5.9, M5.12,
     * M5.14).
     *
     * Also absent on the simulator's synthetic rows (`accountId: 'sim'`), which have no real
     * account behind them and therefore no honest type.
     *
     * **Nothing reads this yet, deliberately.** It is captured now because snapshots are
     * immutable: every period without capture is permanently typeless, and that history cannot
     * be recovered later. See `docs/architecture/GAP_6_ACCOUNT_TYPE_REVIEW.md`.
     */
    accountType?: string;
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
 * Net worth after the debt ledger — what a household means by the words.
 *
 * The payload deliberately carries two figures (ADR-012): `netWorth.netWorthMinor` is assets
 * minus liability-flagged **accounts**, while the M2-5 debt ledger (home loans, personal loans)
 * is reconciled separately into `householdEquity.reconciledEquityMinor`.
 *
 * The consumer wizard writes every loan as a Debt row and never as a liability account, so for a
 * consumer household the gross figure omits their debt entirely. Every surface that presents a
 * net worth — a dashboard panel, a narrative paragraph, or a grounding block handed to a model —
 * must read the reconciled figure.
 *
 * **This lives here, beside the payload it interprets, because it has more than one caller.** It
 * began as a private helper in the intelligence layer; the AI grounding builder read
 * `payload.netWorth` directly and so kept shipping the gross figure to a model long after the
 * dashboard was corrected. One definition, imported by both, is what stops that recurring.
 *
 * Prefers the kernel's own reconciliation rather than recomputing it. The fallback exists only
 * for snapshots captured before `householdEquity` was added to the payload.
 */
export const reconciledNetWorthMinor = (p: FinancialSnapshotPayload): number =>
  p.householdEquity?.reconciledEquityMinor ??
  p.netWorth.netWorthMinor - (p.debt?.totalOutstandingMinor ?? 0);

/**
 * The assets a family could actually retire on — everything except the roof over their head.
 *
 * ## Why this is not reconciled net worth (M5.14)
 *
 * Nobody sells the family home to buy groceries at seventy. Counting it as retirement corpus
 * funds a projection with an asset that will never be spent, and for a homeowning household that
 * is not a rounding error: on a family holding ₹80,00,000 of property against ₹20,00,000 of
 * investments, reconciled net worth reports **four times** the corpus this does.
 *
 * M5.10 established this as the right definition (Decision 1 of its architecture) and implemented
 * it in `RetirementPlanService.investableCorpusMinor` — but only there. The intelligence layer
 * kept its own fallback of reconciled net worth, so a family **without a stated plan** saw one
 * corpus on `/household` and a different one on `/household/retirement`. Same household, same
 * moment, two numbers, and nothing on either screen to say why.
 *
 * It lives here for the same reason `reconciledNetWorthMinor` does: it has more than one caller,
 * and a second copy is how the two drifted apart in the first place.
 *
 * A **selection, not a calculation** — it sums the snapshot's own allocation and drops
 * `real_estate`. It never returns a negative: debt is not netted off here, because the projection
 * treats a mortgage as a claim on income rather than on the retirement pot.
 */
export const investableCorpusMinor = (p: FinancialSnapshotPayload): number =>
  (p.assetAllocation ?? [])
    .filter((a) => a.assetClass !== 'real_estate')
    .reduce((sum, a) => sum + a.baseValueMinor, 0);

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
