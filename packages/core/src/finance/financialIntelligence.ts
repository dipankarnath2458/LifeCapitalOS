import { CurrencyCode } from '../money/money.js';
import { FinancialSnapshotPayload } from './financialSnapshot.js';
import {
  computeFinancialHealthScore,
  FINANCIAL_HEALTH_MODEL_VERSION,
  type FinancialHealthModel,
  type HealthBand,
} from './financialHealth.js';
import { explainFinancialHealth } from './financialHealthExplanation.js';
import { emergencyFundTarget, analyzeLifeInsuranceGap } from './insurance.js';
import { computeRetirement } from './retirement.js';
import { analyzeAllocation, type AssetClass, type RiskTolerance } from './assetAllocation.js';
import { computeEarlyWarning, type EarlyWarningInput } from '../scoring/earlyWarning.js';

/**
 * Financial Intelligence Layer (M5) — the single reusable **derived read-model** over the
 * Financial Kernel. See docs/architecture/M5_FINANCIAL_INTELLIGENCE_LAYER.md.
 *
 * This module is **pure, browser-safe, and deterministic** (no IO, clock, randomness, or
 * FX). It **composes the existing calculators** — Financial Health Score (M3-1), its
 * Explanation/Recommendations (M3-2), Emergency Fund + Insurance Gap, Retirement, Asset
 * Allocation, and the Early Warning system — into ONE canonical
 * `HouseholdFinancialIntelligence` object. It invents **no new financial math**; every
 * number is produced by a calculator that already exists. Consumers (Dashboard, AI Family
 * CFO™, Reports, What-if, Advisor Workspace, Mobile) read this object and never calculate.
 *
 * All monetary values are **base-currency minor units** (the snapshot convention). The
 * object is **PII-light**: ids + coarse demographics only, never names/DOB/taxIds — the
 * `household.name` is resolved by the API layer through the decrypted boundary (null here).
 */

/** Canonical object contract version. Additive-only; a breaking change bumps this. */
export const FINANCIAL_INTELLIGENCE_SCHEMA_VERSION = 1;
/** Semver of the composing logic used to build the intelligence object. */
export const FINANCIAL_INTELLIGENCE_ENGINE_VERSION = 'm5-fil-1.0.0';

/** Documented default assumptions used when a module-owned input is not (yet) provided. */
export const DEFAULT_INTELLIGENCE_ASSUMPTIONS = {
  retirement: {
    retirementAge: 60,
    yearsInRetirement: 25,
    inflationRatePct: 6,
    preRetirementReturnPct: 10,
    postRetirementReturnPct: 7,
  },
  emergencyFundMonths: 6,
  risk: 'moderate' as RiskTolerance,
} as const;

export type Confidence = 'high' | 'medium' | 'low';
export type Trend = 'up' | 'down' | 'flat' | 'unknown';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type StatusLight = 'green' | 'yellow' | 'red';

/** Every section is either available (with data + confidence) or explains why not. */
export type Section<T> =
  | { available: true; confidence: Confidence; data: T }
  | { available: false; reason: string };

export interface IntelligenceMeta {
  householdId: string;
  snapshotId: string;
  snapshotSchemaVersion: number;
  engineVersion?: string;
  fxVersion?: string;
  currency: string;
  capturedAt?: string;
}

/** Module-owned inputs the snapshot does not carry; all optional (graceful degradation). */
export interface IntelligenceAssumptions {
  retirement?: {
    retirementAge: number;
    yearsInRetirement: number;
    inflationRatePct: number;
    preRetirementReturnPct: number;
    postRetirementReturnPct: number;
    /** Overrides the corpus proxy (defaults to net worth) when the module tracks it. */
    currentCorpusMinor?: number;
  };
  insurance?: {
    existingCoverMinor: number;
    hasTermCover: boolean;
    hasHealthInsurance: boolean;
  };
  risk?: RiskTolerance;
  emergencyFundMonths?: number;
}

export interface IntelligenceInput {
  payload: FinancialSnapshotPayload;
  meta: IntelligenceMeta;
  /** Net-worth series oldest→newest for trend (from FinancialSnapshotService.timeline). */
  trend?: { netWorthMinor: number }[];
  assumptions?: IntelligenceAssumptions;
  /** Injected for purity — the layer never reads a clock itself. */
  computedAt: string;
  /** Optional scoring model override (defaults to the documented M3-1 model). */
  healthModel?: FinancialHealthModel;
}

export interface HouseholdFinancialIntelligence {
  household: {
    householdId: string;
    /** Null in the pure/AI representation; resolved by the API layer (decrypted boundary). */
    name: string | null;
    baseCurrency: string;
    members: { memberId: string; ageYears: number | null; isDependent: boolean; relation: string }[];
    memberCount: number;
    entityCount: number;
    lastUpdated: string | null;
  };
  netWorth: Section<{
    assetsMinor: number;
    liabilitiesMinor: number;
    netWorthMinor: number;
    solvencyRatio: number;
    trend: Trend;
    changeMinor: number | null;
    changePct: number | null;
  }>;
  emergencyFund: Section<{
    cashMinor: number;
    monthlyExpensesMinor: number;
    monthsCovered: number;
    targetMonths: number;
    targetMinor: number;
    shortfallMinor: number;
    status: StatusLight;
  }>;
  assetAllocation: Section<{
    current: { assetClass: string; pct: number; baseValueMinor: number }[];
    diversificationIndex: number;
    topConcentration: { assetClass: string; pct: number } | null;
    concentrationRisk: StatusLight;
    drift: { assetClass: string; driftPct: number }[] | null;
    suggestions: string[];
  }>;
  retirement: Section<{
    currentCorpusMinor: number;
    requiredCorpusMinor: number;
    fundingGapMinor: number;
    readinessPct: number;
    onTrack: boolean;
    monthlySipRequiredMinor: number;
    usingDefaultAssumptions: boolean;
  }>;
  insurance: Section<{
    recommendedCoverMinor: number;
    existingCoverMinor: number;
    protectionGapMinor: number;
    adequate: boolean;
    status: StatusLight;
    dependents: number;
    coverTracked: boolean;
  }>;
  cashflow: Section<{
    period: string;
    incomeMinor: number;
    expenseMinor: number;
    netMinor: number;
    savingsRate: number;
    status: StatusLight;
    topCategories: { category: string; amountMinor: number }[];
  }>;
  risk: Section<{
    topRisks: { key: string; label: string; severity: Severity; detail: string }[];
    overall: StatusLight;
    redCount: number;
    yellowCount: number;
  }>;
  opportunity: Section<{
    quickWins: { key: string; title: string; rationale: string; estimatedImpact: Severity }[];
    longTerm: { key: string; title: string; rationale: string; estimatedImpact: Severity }[];
  }>;
  wealthHealth: Section<{
    overall: number;
    band: HealthBand;
    category: string;
    categories: { key: string; label: string; score: number; band: HealthBand; weight: number }[];
    trend: Trend;
  }>;
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
    schemaVersion: number;
    engineVersion: string;
    scoreModelVersion: string;
    snapshotId: string;
    snapshotSchemaVersion: number;
    fxVersion: string | null;
    currency: string;
    computedAt: string;
    confidence: Confidence;
    dataCompleteness: { pct: number; missing: string[] };
  };
}

// ---------------------------------------------------------------------------
// helpers (pure)
// ---------------------------------------------------------------------------

const KNOWN_CLASSES: AssetClass[] = [
  'equity', 'debt', 'gold', 'real_estate', 'cash', 'crypto', 'business', 'other',
];
const asAssetClass = (s: string): AssetClass =>
  (KNOWN_CLASSES as string[]).includes(s) ? (s as AssetClass) : 'other';

const CATEGORY_LABEL: Record<HealthBand, string> = {
  at_risk: 'At risk',
  needs_attention: 'Needs attention',
  fair: 'Fair',
  good: 'Good',
  excellent: 'Excellent',
};

const confidenceFrom = (score: number): Confidence =>
  score >= 0.85 ? 'high' : score >= 0.6 ? 'medium' : 'low';

const severityFromPriority = (p: 'high' | 'medium' | 'low'): Severity =>
  p === 'high' ? 'high' : p === 'medium' ? 'medium' : 'low';

const trendFromSeries = (series: number[]): { trend: Trend; changeMinor: number | null; changePct: number | null } => {
  if (series.length < 2) return { trend: 'unknown', changeMinor: null, changePct: null };
  const prev = series[series.length - 2]!;
  const curr = series[series.length - 1]!;
  const changeMinor = curr - prev;
  const changePct = prev !== 0 ? Math.round((changeMinor / Math.abs(prev)) * 1000) / 10 : null;
  const trend: Trend = changeMinor > 0 ? 'up' : changeMinor < 0 ? 'down' : 'flat';
  return { trend, changeMinor, changePct };
};

/** Cash held (assets classified as cash), in base-currency minor units. */
const cashMinorOf = (p: FinancialSnapshotPayload): number =>
  p.assets.filter((a) => a.assetClass === 'cash').reduce((s, a) => s + a.baseBalanceMinor, 0);

const dependentsOf = (p: FinancialSnapshotPayload): number =>
  (p.members ?? []).filter((m) => m.isDependent).length;

/** Oldest non-dependent member age, else any member age — the retirement subject. */
const primaryAgeOf = (p: FinancialSnapshotPayload): number | null => {
  const withAge = (p.members ?? []).filter((m) => m.ageYears != null);
  if (withAge.length === 0) return null;
  const adults = withAge.filter((m) => !m.isDependent);
  const pool = adults.length > 0 ? adults : withAge;
  return pool.reduce((max, m) => Math.max(max, m.ageYears!), 0);
};

// ---------------------------------------------------------------------------
// the composer
// ---------------------------------------------------------------------------

/**
 * Compose the canonical `HouseholdFinancialIntelligence` from an immutable snapshot
 * payload (+ optional trend series and module-owned assumptions). Pure and deterministic:
 * identical inputs always yield an identical object. Sections whose inputs are missing
 * report `available: false` with a reason — never a fabricated number.
 */
export function computeHouseholdFinancialIntelligence(
  input: IntelligenceInput,
): HouseholdFinancialIntelligence {
  const { payload, meta, computedAt } = input;
  const p = payload;
  const currency = (meta.currency || 'INR') as CurrencyCode;
  const missing: string[] = [];

  const income = p.cashflowSummary.incomeMinor;
  const expense = p.cashflowSummary.expenseMinor;
  const cash = cashMinorOf(p);
  const dependents = dependentsOf(p);
  const primaryAge = primaryAgeOf(p);
  const annualIncome = income * 12;

  if (income <= 0) missing.push('income');
  if (expense <= 0) missing.push('expenses');
  if (p.assets.length === 0) missing.push('assets');
  if (primaryAge === null) missing.push('memberAges');
  if (!input.assumptions?.insurance) missing.push('insurancePolicies');
  if (!input.assumptions?.retirement) missing.push('retirementAssumptions');

  // --- Wealth Health™ (M3-1, verbatim) + explanation/recommendations (M3-2) ---
  const health = computeFinancialHealthScore(p, input.healthModel);
  const explanation = explainFinancialHealth(health, p);
  const healthConfidence = confidenceFrom(explanation.confidence);

  const wealthHealth: HouseholdFinancialIntelligence['wealthHealth'] = {
    available: true,
    confidence: healthConfidence,
    data: {
      overall: health.overall,
      band: health.band,
      category: CATEGORY_LABEL[health.band],
      categories: health.categories.map((c) => ({
        key: c.key,
        label: c.label,
        score: c.score,
        band: c.band,
        weight: c.weight,
      })),
      trend: 'unknown', // score history is not carried in the net-worth trend series
    },
  };

  // --- Net Worth ---
  // Trend from the provided net-worth series (oldest→newest). The caller passes the
  // household's snapshot timeline, which already includes the current position.
  const nwSeries = (input.trend ?? []).map((t) => t.netWorthMinor);
  const nwTrend = trendFromSeries(nwSeries);
  const netWorth: HouseholdFinancialIntelligence['netWorth'] = {
    available: true,
    confidence: 'high',
    data: {
      assetsMinor: p.netWorth.assetsMinor,
      liabilitiesMinor: p.netWorth.liabilitiesMinor,
      netWorthMinor: p.netWorth.netWorthMinor,
      solvencyRatio: p.netWorth.solvencyRatio,
      trend: nwTrend.trend,
      changeMinor: nwTrend.changeMinor,
      changePct: nwTrend.changePct,
    },
  };

  // --- Emergency Fund (Liquidity) — reuse emergencyFundTarget ---
  const efMonths = input.assumptions?.emergencyFundMonths ?? DEFAULT_INTELLIGENCE_ASSUMPTIONS.emergencyFundMonths;
  let emergencyFund: HouseholdFinancialIntelligence['emergencyFund'];
  if (expense <= 0) {
    emergencyFund = { available: false, reason: 'No expenses recorded to size an emergency buffer.' };
  } else {
    const ef = emergencyFundTarget(expense, efMonths, cash, currency);
    const monthsCovered = Math.round(ef.monthsCovered * 10) / 10;
    const status: StatusLight = monthsCovered >= efMonths ? 'green' : monthsCovered >= efMonths / 2 ? 'yellow' : 'red';
    emergencyFund = {
      available: true,
      confidence: 'high',
      data: {
        cashMinor: cash,
        monthlyExpensesMinor: expense,
        monthsCovered,
        targetMonths: efMonths,
        targetMinor: ef.targetMinor.minor,
        shortfallMinor: ef.shortfallMinor.minor,
        status,
      },
    };
  }

  // --- Asset Allocation — reuse analyzeAllocation for drift/suggestions ---
  let assetAllocation: HouseholdFinancialIntelligence['assetAllocation'];
  if (p.assetAllocation.length === 0) {
    assetAllocation = { available: false, reason: 'No asset allocation to analyse yet.' };
  } else {
    const hhi = p.assetAllocation.reduce((s, c) => s + (c.pct / 100) * (c.pct / 100), 0);
    const diversificationIndex = Math.round((1 - hhi) * 100) / 100;
    const top = [...p.assetAllocation].sort((a, b) => b.pct - a.pct)[0]!;
    const topPct = Math.round(top.pct);
    const concentrationRisk: StatusLight = topPct >= 70 ? 'red' : topPct >= 50 ? 'yellow' : 'green';

    const currentValues: Partial<Record<AssetClass, number>> = {};
    for (const c of p.assetAllocation) {
      const k = asAssetClass(c.assetClass);
      currentValues[k] = (currentValues[k] ?? 0) + c.baseValueMinor;
    }
    const risk = input.assumptions?.risk ?? DEFAULT_INTELLIGENCE_ASSUMPTIONS.risk;
    const analysis = analyzeAllocation(currentValues, risk, primaryAge ?? undefined);
    const drift = KNOWN_CLASSES.filter((c) => Math.abs(analysis.drift[c]) >= 5).map((c) => ({
      assetClass: c,
      driftPct: analysis.drift[c],
    }));

    assetAllocation = {
      available: true,
      confidence: input.assumptions?.risk ? 'high' : 'medium',
      data: {
        current: p.assetAllocation.map((c) => ({
          assetClass: c.assetClass,
          pct: c.pct,
          baseValueMinor: c.baseValueMinor,
        })),
        diversificationIndex,
        topConcentration: { assetClass: top.assetClass, pct: topPct },
        concentrationRisk,
        drift,
        suggestions: analysis.suggestions,
      },
    };
  }

  // --- Retirement — reuse computeRetirement (defaults when assumptions absent) ---
  let retirement: HouseholdFinancialIntelligence['retirement'];
  if (primaryAge === null) {
    retirement = { available: false, reason: 'No member age available to project retirement.' };
  } else if (expense <= 0) {
    retirement = { available: false, reason: 'No expenses recorded to size retirement needs.' };
  } else {
    const usingDefaults = !input.assumptions?.retirement;
    const ra = input.assumptions?.retirement ?? DEFAULT_INTELLIGENCE_ASSUMPTIONS.retirement;
    const currentCorpus = input.assumptions?.retirement?.currentCorpusMinor ?? Math.max(0, p.netWorth.netWorthMinor);
    const result = computeRetirement({
      currentAge: primaryAge,
      retirementAge: ra.retirementAge,
      yearsInRetirement: ra.yearsInRetirement,
      currentAnnualExpensesMinor: expense * 12,
      currentCorpusMinor: currentCorpus,
      inflationRatePct: ra.inflationRatePct,
      preRetirementReturnPct: ra.preRetirementReturnPct,
      postRetirementReturnPct: ra.postRetirementReturnPct,
      currency,
    });
    const required = result.requiredCorpus.minor;
    const projected = result.projectedCorpusFromCurrent.minor;
    const readinessPct = required > 0 ? Math.max(0, Math.min(100, Math.round((projected / required) * 100))) : 100;
    retirement = {
      available: true,
      confidence: usingDefaults ? 'medium' : 'high',
      data: {
        currentCorpusMinor: currentCorpus,
        requiredCorpusMinor: required,
        fundingGapMinor: result.corpusGap.minor,
        readinessPct,
        onTrack: result.onTrack,
        monthlySipRequiredMinor: result.monthlySipRequired.minor,
        usingDefaultAssumptions: usingDefaults,
      },
    };
  }

  // --- Insurance — reuse analyzeLifeInsuranceGap ---
  let insurance: HouseholdFinancialIntelligence['insurance'];
  if (annualIncome <= 0 && dependents === 0) {
    insurance = { available: false, reason: 'No income or dependents recorded to assess protection needs.' };
  } else {
    const coverTracked = !!input.assumptions?.insurance;
    const existingCover = input.assumptions?.insurance?.existingCoverMinor ?? 0;
    const gap = analyzeLifeInsuranceGap({
      annualIncomeMinor: annualIncome,
      outstandingLiabilitiesMinor: p.debt.totalOutstandingMinor,
      existingCoverMinor: existingCover,
      dependents,
      currency,
    });
    const status: StatusLight = gap.adequate
      ? 'green'
      : coverTracked && existingCover > 0
        ? 'yellow'
        : 'red';
    insurance = {
      available: true,
      confidence: coverTracked ? 'high' : 'low',
      data: {
        recommendedCoverMinor: gap.recommendedCoverMinor.minor,
        existingCoverMinor: existingCover,
        protectionGapMinor: gap.shortfallMinor.minor,
        adequate: gap.adequate,
        status,
        dependents,
        coverTracked,
      },
    };
  }

  // --- Cash Flow ---
  let cashflow: HouseholdFinancialIntelligence['cashflow'];
  if (income <= 0 && expense <= 0) {
    cashflow = { available: false, reason: 'No income or expenses recorded for this period.' };
  } else {
    const sr = p.cashflowSummary.savingsRate;
    const status: StatusLight = sr >= 0.2 ? 'green' : sr >= 0 ? 'yellow' : 'red';
    const topCategories = [...p.cashflowSummary.byCategory]
      .sort((a, b) => b.amountMinor - a.amountMinor)
      .slice(0, 3);
    cashflow = {
      available: true,
      confidence: income > 0 ? 'high' : 'medium',
      data: {
        period: p.cashflowSummary.period,
        incomeMinor: income,
        expenseMinor: expense,
        netMinor: p.cashflowSummary.netMinor,
        savingsRate: sr,
        status,
        topCategories,
      },
    };
  }

  // --- Risk — reuse computeEarlyWarning ---
  const allocationPct: Record<string, number> = {};
  for (const c of p.assetAllocation) allocationPct[c.assetClass] = (allocationPct[c.assetClass] ?? 0) + c.pct;
  const ewInput: EarlyWarningInput = {
    allocationPct,
    monthlyExpensesMinor: expense,
    emergencyFundMinor: cash,
    liquidAssetsMinor: cash,
    totalAssetsMinor: p.netWorth.assetsMinor,
    totalLiabilitiesMinor: p.netWorth.liabilitiesMinor,
    annualIncomeMinor: annualIncome,
    monthlyDebtPaymentMinor: p.debt.totalMonthlyPaymentMinor,
    hasTermCover: input.assumptions?.insurance?.hasTermCover ?? false,
    hasHealthInsurance: input.assumptions?.insurance?.hasHealthInsurance ?? false,
    dependents,
  };
  const warning = computeEarlyWarning(ewInput);
  const severityFromLight = (s: StatusLight): Severity => (s === 'red' ? 'high' : s === 'yellow' ? 'medium' : 'low');
  const topRisks = warning.signals
    .filter((s) => s.status !== 'green')
    .sort((a, b) => (a.status === 'red' ? -1 : 1) - (b.status === 'red' ? -1 : 1))
    .map((s) => ({ key: s.key, label: s.label, severity: severityFromLight(s.status), detail: s.detail }));
  const risk: HouseholdFinancialIntelligence['risk'] = {
    available: true,
    confidence: 'medium',
    data: { topRisks, overall: warning.overall, redCount: warning.redCount, yellowCount: warning.yellowCount },
  };

  // --- Opportunity + Recommended Actions — reuse M3-2 recommendations ---
  const recs = explanation.recommendations;
  const quickWins = recs
    .filter((r) => r.priority !== 'low')
    .map((r) => ({ key: r.id, title: r.title, rationale: r.recommendedAction, estimatedImpact: severityFromPriority(r.priority) }));
  const longTerm = recs
    .filter((r) => r.priority === 'low')
    .map((r) => ({ key: r.id, title: r.title, rationale: r.recommendedAction, estimatedImpact: severityFromPriority(r.priority) }));
  const opportunity: HouseholdFinancialIntelligence['opportunity'] = {
    available: true,
    confidence: healthConfidence,
    data: { quickWins, longTerm },
  };

  const recommendedActions = recs.map((r) => ({
    priority: r.priorityRank,
    title: r.title,
    rationale: r.description,
    sourceSection: r.affectedCategory,
    estimatedImpact: severityFromPriority(r.priority),
  }));

  // --- Executive Summary (deterministic, template-composed; NOT an LLM call) ---
  const highlights = explanation.strengths.slice(0, 4).map((s) => s.label);
  const watchouts = [
    ...explanation.weaknesses.slice(0, 3).map((w) => `${w.label} (−${w.impact} pts)`),
    ...topRisks.filter((r) => r.severity === 'high').slice(0, 1).map((r) => r.label),
  ].slice(0, 4);
  const headline =
    `Financial health is ${CATEGORY_LABEL[health.band].toLowerCase()} at ${health.overall}/100` +
    (watchouts.length > 0 ? `, with ${watchouts.length} area${watchouts.length > 1 ? 's' : ''} to watch.` : '.');
  const paragraphs = [
    explanation.summary,
    `Net worth is ${p.netWorth.netWorthMinor} (base ${currency}, minor units); ` +
      `${warning.redCount} red and ${warning.yellowCount} amber risk signal${warning.yellowCount === 1 ? '' : 's'} detected.`,
  ];

  // --- Metadata ---
  const totalSignals = 6; // income, expenses, assets, memberAges, insurancePolicies, retirementAssumptions
  const completenessPct = Math.round(((totalSignals - missing.length) / totalSignals) * 100);
  const overallConfidence: Confidence =
    completenessPct >= 85 ? 'high' : completenessPct >= 50 ? 'medium' : 'low';

  return {
    household: {
      householdId: meta.householdId,
      name: null,
      baseCurrency: currency,
      members: (p.members ?? []).map((m) => ({
        memberId: m.memberId,
        ageYears: m.ageYears,
        isDependent: m.isDependent,
        relation: m.relation,
      })),
      memberCount: p.relationships.memberCount,
      entityCount: p.relationships.entityCount,
      lastUpdated: meta.capturedAt ?? null,
    },
    netWorth,
    emergencyFund,
    assetAllocation,
    retirement,
    insurance,
    cashflow,
    risk,
    opportunity,
    wealthHealth,
    executiveSummary: { headline, paragraphs, highlights, watchouts },
    recommendedActions,
    meta: {
      schemaVersion: FINANCIAL_INTELLIGENCE_SCHEMA_VERSION,
      engineVersion: FINANCIAL_INTELLIGENCE_ENGINE_VERSION,
      scoreModelVersion: FINANCIAL_HEALTH_MODEL_VERSION,
      snapshotId: meta.snapshotId,
      snapshotSchemaVersion: meta.snapshotSchemaVersion,
      fxVersion: meta.fxVersion ?? null,
      currency,
      computedAt,
      confidence: overallConfidence,
      dataCompleteness: { pct: completenessPct, missing },
    },
  };
}
