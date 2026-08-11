import { apiGet } from './api';
import { getOnboardingStatus } from './household';

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

export interface RetirementData {
  currentCorpusMinor: number;
  requiredCorpusMinor: number;
  fundingGapMinor: number;
  readinessPct: number;
  onTrack: boolean;
  monthlySipRequiredMinor: number;
  usingDefaultAssumptions: boolean;
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

/** What the dashboard needs to render, or why it cannot. */
export type DashboardState =
  | { kind: 'ready'; intelligence: HouseholdIntelligence }
  /**
   * No household at all — the user has never onboarded. Distinct from `needs-check`
   * because the answer is different: they need the *guided* flow, not a health check.
   * This is now the only entry point into onboarding in the product; it used to live on
   * the V1 dashboard, which consumers no longer reach.
   */
  | { kind: 'needs-onboarding' }
  /** A household exists but has no snapshot yet — run the Wealth Health Check. */
  | { kind: 'needs-check'; reason: string }
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
    const status = await getOnboardingStatus(token);
    if (!status) return { kind: 'error' };
    // No household means never onboarded — send them through the guided flow rather than
    // straight at a health check they have no container for.
    if (!status.householdId) return { kind: 'needs-onboarding' };

    const res = await apiGet<IntelligenceResponse>(
      `/households/${status.householdId}/intelligence/current`,
      token,
    );
    if (!res.available) return { kind: 'needs-check', reason: res.reason };
    return { kind: 'ready', intelligence: res };
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

/** Engine status light → design-system tone. Presentation only. */
export function toneFor(status: StatusLight): 'success' | 'warning' | 'danger' {
  if (status === 'green') return 'success';
  if (status === 'yellow') return 'warning';
  return 'danger';
}
