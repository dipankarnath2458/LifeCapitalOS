import { apiGet } from './api';
import { resolveHousehold } from './household';

/**
 * Financial Intelligence Layer client — the dashboard's only data source.
 *
 * Design: `docs/M5_6_HOUSEHOLD_DASHBOARD_ARCHITECTURE.md`.
 *
 * **One call, one snapshot.** Every figure the dashboard shows comes from the same
 * `snapshotId`. Assembling the page from several endpoints would let net worth come from
 * one moment and the health score from another — two panels quietly disagreeing, with
 * nothing on screen to say so.
 *
 * **No business math here.** Every value rendered is a field the engine returned. The
 * client formats; it never derives. That is the kernel governance rule, and it is what
 * stops this becoming a second, divergent implementation of the same finance.
 */

export type StatusLight = 'green' | 'yellow' | 'red';
export type Trend = 'up' | 'down' | 'flat' | 'unknown';
export type Severity = 'low' | 'medium' | 'high' | 'critical';

/**
 * A section is available with data, or unavailable *with a reason*.
 *
 * Keeping the reason is the point. A family that has recorded no insurance must see why
 * protection is unknown — a protection gap rendered as zero reads as "you are fully
 * covered", which is the exact opposite of the truth.
 */
export type Section<T> =
  | { available: true; confidence: string; data: T }
  | { available: false; reason: string };

export interface NetWorthData {
  assetsMinor: number;
  /** Liability-flagged accounts only — loans live in `totalDebtMinor`. */
  liabilitiesMinor: number;
  totalDebtMinor: number;
  /** Assets minus liability accounts *and* the debt ledger. What the family owns outright. */
  netWorthMinor: number;
  grossNetWorthMinor: number;
  solvencyRatio: number;
  trend: Trend;
  changeMinor: number | null;
  changePct: number | null;
}

export interface EmergencyFundData {
  cashMinor: number;
  monthlyExpensesMinor: number;
  monthsCovered: number;
  targetMonths: number;
  shortfallMinor: number;
  status: StatusLight;
}

export interface AllocationData {
  current: { assetClass: string; pct: number; baseValueMinor: number }[];
  diversificationIndex: number;
  topConcentration: { assetClass: string; pct: number } | null;
  concentrationRisk: StatusLight;
  suggestions: string[];
}

export interface CashflowData {
  period: string;
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
  savingsRate: number;
  status: StatusLight;
  topCategories: { category: string; amountMinor: number }[];
}

export interface WealthHealthData {
  overall: number;
  band: string;
  categories: { key: string; label: string; score: number; band: string; weight: number }[];
  trend: Trend;
}

export interface RiskData {
  topRisks: { key: string; label: string; severity: Severity; detail: string }[];
  overall: StatusLight;
}

export interface OpportunityData {
  quickWins: { key: string; title: string; rationale: string; estimatedImpact: Severity }[];
  longTerm: { key: string; title: string; rationale: string; estimatedImpact: Severity }[];
}

/** Where a figure came from (M5.14, Gap 3). Mirrors `FieldSource` in `@lcos/core`. */
export type FieldSource = 'stated' | 'derived' | 'default';

export interface ResolvedField<T = number> {
  value: T;
  source: FieldSource;
}

/** Every retirement assumption the projection used, each with its provenance (M5.14). */
export interface ResolvedRetirementAssumptions {
  retirementAge: ResolvedField;
  yearsInRetirement: ResolvedField;
  desiredAnnualIncomeMinor: ResolvedField;
  currentCorpusMinor: ResolvedField;
  inflationRatePct: ResolvedField;
  preRetirementReturnPct: ResolvedField;
  postRetirementReturnPct: ResolvedField;
  /** `null` when never stated — the one figure with no honest default. */
  monthlyContributionMinor: ResolvedField | null;
}

export interface RetirementData {
  currentCorpusMinor: number;
  requiredCorpusMinor: number;
  fundingGapMinor: number;
  readinessPct: number;
  onTrack: boolean;
  monthlySipRequiredMinor: number;
  /**
   * True when ANY assumption below is ours rather than the family's.
   *
   * Kept for compatibility, but the dashboard should read `assumptions` instead: this cannot
   * say *which* figure was assumed, which is exactly what Gap 3 was.
   */
  usingDefaultAssumptions: boolean;
  assumptions: ResolvedRetirementAssumptions;
}

export interface InsuranceData {
  recommendedCoverMinor: number;
  existingCoverMinor: number;
  protectionGapMinor: number;
  adequate: boolean;
  status: StatusLight;
  coverTracked: boolean;
}

export interface HouseholdIntelligence {
  /**
   * Money held in accounts the family said are for retirement (M5.17).
   *
   * Top level, not inside a `Section`: it is a fact about the snapshot, not an analysis that can
   * fail. It briefly lived on the retirement section, whose availability depends on a member age
   * and recorded expenses — so a family with neither could not be shown savings they had just
   * recorded, for reasons unrelated to those savings.
   *
   * `null` means the snapshot predates account-type capture — NOT that they have none. Render
   * nothing on `null`; a zero would answer a question nobody asked.
   */
  retirementAccountsMinor: number | null;
  available: true;
  household: { householdId: string; name: string | null; baseCurrency: string; memberCount: number };
  netWorth: Section<NetWorthData>;
  emergencyFund: Section<EmergencyFundData>;
  assetAllocation: Section<AllocationData>;
  retirement: Section<RetirementData>;
  insurance: Section<InsuranceData>;
  cashflow: Section<CashflowData>;
  risk: Section<RiskData>;
  opportunity: Section<OpportunityData>;
  wealthHealth: Section<WealthHealthData>;
  executiveSummary: {
    headline: string;
    paragraphs: string[];
    highlights: string[];
    watchouts: string[];
  };
  recommendedActions: {
    priority: number;
    title: string;
    rationale: string;
    sourceSection: string;
    estimatedImpact: Severity;
  }[];
  meta: {
    engineVersion: string;
    scoreModelVersion: string;
    snapshotId: string;
    currency: string;
    computedAt: string;
    confidence: string;
    dataCompleteness: { pct: number; missing: string[] };
  };
}

export type IntelligenceResponse = HouseholdIntelligence | { available: false; reason: string };

/**
 * What the dashboard needs to render, or why it cannot.
 *
 * The states that HAVE a household carry its id. Additive, and the reason is not tidiness:
 * every caller that needed the id was re-fetching `/onboarding/status` to get a value this
 * function had already resolved and thrown away. Two of those redundant calls per dashboard
 * load were enough to trip the API's rate limiter under the smoke suite.
 */
export type DashboardState =
  | { kind: 'ready'; householdId: string; intelligence: HouseholdIntelligence }
  /**
   * No household at all — the user has never onboarded. Distinct from `needs-check`
   * because the answer is different: they need the *guided* flow, not a health check.
   * This is now the only entry point into onboarding in the product; it used to live on
   * the V1 dashboard, which consumers no longer reach.
   */
  | { kind: 'needs-onboarding' }
  /** A household exists but has no snapshot yet — run the Wealth Health Check. */
  | { kind: 'needs-check'; householdId: string; reason: string }
  | { kind: 'error' };

/**
 * Loads the dashboard.
 *
 * Distinguishes "we have no data" from "we failed to load", because the two need
 * different screens: the first invites the user to run their Wealth Health Check, the
 * second must not, since their data may exist and simply be unreachable right now.
 */
export async function loadDashboard(token: string): Promise<DashboardState> {
  try {
    // Gap 7: this function already drew the distinction the shared resolver now enforces for
    // everyone — a failed lookup is `error`, an absent household is `needs-onboarding`. What
    // changes here is only that it goes through the resolver, so it reuses the session's
    // cached id instead of re-asking the most rate-limited route in the product on every load.
    const resolution = await resolveHousehold(token);
    if (resolution.kind === 'unavailable') return { kind: 'error' };
    // No household means never onboarded — send them through the guided flow rather than
    // straight at a health check they have no container for.
    if (resolution.kind === 'none') return { kind: 'needs-onboarding' };

    const householdId = resolution.householdId;
    const res = await apiGet<IntelligenceResponse>(
      `/households/${householdId}/intelligence/current`,
      token,
    );
    if (!res.available) return { kind: 'needs-check', householdId, reason: res.reason };
    return { kind: 'ready', householdId, intelligence: res };
  } catch {
    return { kind: 'error' };
  }
}

/**
 * Minor units → a display string. The only transformation the client performs, and
 * deliberately not arithmetic: no ratio, gap or total is derived here.
 */
export function formatMoney(minor: number, currency = 'INR'): string {
  const major = minor / 100;
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(major);
  } catch {
    // An unrecognised currency code must not blank out the page.
    return `${currency} ${Math.round(major).toLocaleString('en-IN')}`;
  }
}

/**
 * Asset-class keys → the words a family reads (M5.17).
 *
 * The engine's keys are not copy. `unclassified` is the composer's bucket for an asset whose
 * class we have never asked about (`household-financial-snapshot.service.ts`), and it was
 * reaching the dashboard verbatim — so a family who had just recorded their retirement savings
 * was shown the word "Unclassified".
 *
 * **The bucket keeps its meaning.** This renames nothing in the engine and merges nothing: an
 * unknown asset class still reads as unknown, because it genuinely is one. "Not yet classified"
 * says the same thing in the family's language and implies what it actually is — a gap that can
 * be closed — rather than a verdict.
 *
 * One map, shared by every V2 consumer surface, following the `BAND_LABEL` convention already
 * used by What-if. Unknown keys fall through to the previous behaviour, so a class added to the
 * engine tomorrow degrades to readable text instead of disappearing.
 */
export const ASSET_CLASS_LABEL: Record<string, string> = {
  equity: 'Equity',
  debt: 'Debt',
  gold: 'Gold',
  real_estate: 'Real Estate',
  cash: 'Cash',
  crypto: 'Crypto',
  business: 'Business',
  other: 'Other',
  unclassified: 'Not yet classified',
};

/** An asset-class key as a family should read it. Presentation only — no bucket changes. */
export const assetClassLabel = (key: string): string =>
  ASSET_CLASS_LABEL[key] ?? key.replace(/_/g, ' ');

/**
 * What a family is still missing → what to call it, and where they answer it (M5.20).
 *
 * ## The defect this closes
 *
 * `meta.dataCompleteness.missing` carries the engine's own identifiers —
 * `income`, `expenses`, `assets`, `memberAges`, `insurancePolicies`, `retirementAssumptions`
 * (`financialIntelligence.ts:493-498`). The dashboard joined them with commas and printed them,
 * so the panel headed **"Make this more accurate"** read:
 *
 * > We have 67% of the picture. Still missing: memberAges, insurancePolicies,
 * > retirementAssumptions.
 *
 * Two failures at once, and this codebase has now fixed each of them separately. An engine key
 * reaching a family as copy is the M5.17 defect. An instruction with nowhere to go is the M5.18
 * defect — and this one is a panel whose entire heading is an instruction.
 *
 * It is not an edge case: `memberAges` is missing for **every newly onboarded family**, because
 * neither onboarding nor the Wealth Health Check records a date of birth (M5.17 §6).
 *
 * ## Why a destination, not just a label
 *
 * Naming the gap in words would be the M5.17 half of the fix. The reason this panel exists is to
 * be acted on, and a family who now understands that we lack their family's ages still has to
 * guess which of seven pages records one. Every key already has a real V2 surface that captures
 * exactly it, so the honest thing is to say where.
 *
 * ## This adds no key and changes no percentage
 *
 * Presentation only, exactly as `ASSET_CLASS_LABEL` is. The engine decides what is missing and
 * what `pct` is; this decides how to say it. An unrecognised key degrades to readable text with
 * no link rather than disappearing — a key added to the engine tomorrow must still reach the
 * family, even before this map learns about it.
 */
export const MISSING_LABEL: Record<string, { label: string; href?: string; cta?: string }> = {
  income: {
    label: 'what you earn each month',
    href: '/wealth-health',
    cta: 'Add it in your Wealth Health Check',
  },
  expenses: {
    label: 'what you spend each month',
    href: '/wealth-health',
    cta: 'Add it in your Wealth Health Check',
  },
  assets: {
    label: 'what you own',
    href: '/wealth-health',
    cta: 'Add it in your Wealth Health Check',
  },
  memberAges: {
    label: "your family's dates of birth",
    href: '/household/family',
    cta: 'Add them on your Family page',
  },
  insurancePolicies: {
    label: 'the insurance you already hold',
    href: '/household/protection',
    cta: 'Record it on your Protection page',
  },
  retirementAssumptions: {
    label: 'when you want to retire, and what you save',
    href: '/household/retirement',
    cta: 'Set it on your Retirement page',
  },
};

/**
 * A `dataCompleteness.missing` key as a family should read it, with where to answer it.
 *
 * An unknown key keeps the old behaviour — readable text, no link — so the panel never hides
 * something the engine reported just because this map has not caught up.
 */
export const missingItem = (key: string): { label: string; href?: string; cta?: string } =>
  MISSING_LABEL[key] ?? { label: key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase() };

/** Engine status light → design-system tone. Presentation only. */
export function toneFor(status: StatusLight): 'success' | 'warning' | 'danger' {
  if (status === 'green') return 'success';
  if (status === 'yellow') return 'warning';
  return 'danger';
}
