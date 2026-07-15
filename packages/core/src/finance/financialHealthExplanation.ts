import { FinancialSnapshotPayload } from './financialSnapshot.js';
import type {
  CategoryKey,
  CategoryScore,
  FinancialHealthScore,
  HealthBand,
} from './financialHealth.js';

/**
 * Explainable Financial Health Engine (M3-2) — a **pure, deterministic** explanation
 * layer over an existing `FinancialHealthScore`. See
 * docs/architecture/M3-2_HEALTH_EXPLANATION_DESIGN.md. It **consumes** a score (it never
 * calculates or re-derives one), optionally reads the immutable snapshot payload for
 * financial-impact context, and produces a structured, AI-consumable explanation. No IO,
 * no clock, no randomness, no LLM.
 */

/** A category is a "strength" at/above this sub-score, a "weakness" below it. */
export const STRENGTH_THRESHOLD = 75;
/** Target sub-score a recommendation aims a weak category at (top of "good"). */
export const RECOMMENDATION_TARGET = 90;

export type ReasonCode =
  | 'STRONG_NET_WORTH'
  | 'STRONG_DEBT_BURDEN'
  | 'STRONG_SAVINGS'
  | 'STRONG_LIQUIDITY'
  | 'STRONG_DIVERSIFICATION'
  | 'NEGATIVE_NET_WORTH'
  | 'WEAK_SOLVENCY'
  | 'HIGH_DEBT_BURDEN'
  | 'LOW_SAVINGS_RATE'
  | 'INSUFFICIENT_EMERGENCY_FUND'
  | 'HIGH_CONCENTRATION'
  | 'NO_INCOME_DATA'
  | 'NO_EXPENSE_DATA'
  | 'NO_ASSET_DATA';

export type Priority = 'high' | 'medium' | 'low';

export interface CategoryBreakdown {
  key: CategoryKey;
  label: string;
  weight: number;
  score: number;
  band: HealthBand;
  /** Overall points this category contributes: score·weight / Σweight. */
  pointsContributed: number;
  /** Overall points this category costs: (100−score)·weight / Σweight. */
  pointsLost: number;
}

export interface Strength {
  key: CategoryKey;
  label: string;
  score: number;
  reasonCode: ReasonCode;
}

export interface Weakness {
  key: CategoryKey;
  label: string;
  score: number;
  /** Overall points lost to this weakness (= pointsLost). */
  impact: number;
  reasonCode: ReasonCode;
}

export interface FinancialImpact {
  summary: string;
  /** Numeric gap in base-currency minor units when computable, else null. */
  gapMinor: number | null;
}

export interface Recommendation {
  id: string;
  title: string;
  description: string;
  affectedCategory: CategoryKey;
  priority: Priority;
  priorityRank: number;
  estimatedScoreImprovement: number;
  financialImpact: FinancialImpact;
  recommendedAction: string;
  reasonCode: ReasonCode;
}

export interface PriorityRankEntry {
  rank: number;
  affectedCategory: CategoryKey;
  reasonCode: ReasonCode;
  estimatedScoreImprovement: number;
}

export interface HealthExplanation {
  overall: number;
  band: HealthBand;
  modelVersion: string;
  summary: string;
  categoryBreakdown: CategoryBreakdown[];
  strengths: Strength[];
  weaknesses: Weakness[];
  recommendations: Recommendation[];
  priorityRanking: PriorityRankEntry[];
  potentialScoreImprovement: number;
  potentialOverall: number;
  confidence: number;
  reasonCodes: ReasonCode[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

const STRENGTH_CODE: Record<CategoryKey, ReasonCode> = {
  net_worth: 'STRONG_NET_WORTH',
  debt_burden: 'STRONG_DEBT_BURDEN',
  savings: 'STRONG_SAVINGS',
  liquidity: 'STRONG_LIQUIDITY',
  diversification: 'STRONG_DIVERSIFICATION',
};

/** Weakness reason code (net worth splits on negative vs merely weak). */
function weaknessCode(c: CategoryScore, payload?: FinancialSnapshotPayload): ReasonCode {
  switch (c.key) {
    case 'net_worth':
      return payload && payload.netWorth.netWorthMinor < 0 ? 'NEGATIVE_NET_WORTH' : 'WEAK_SOLVENCY';
    case 'debt_burden':
      return 'HIGH_DEBT_BURDEN';
    case 'savings':
      return 'LOW_SAVINGS_RATE';
    case 'liquidity':
      return 'INSUFFICIENT_EMERGENCY_FUND';
    case 'diversification':
      return 'HIGH_CONCENTRATION';
  }
}

interface RecTemplate {
  title: string;
  description: (c: CategoryScore) => string;
  action: string;
}

const REC_TEMPLATE: Record<CategoryKey, RecTemplate> = {
  net_worth: {
    title: 'Strengthen net worth',
    description: (c) => c.reason,
    action: 'Grow assets and pay down liabilities to lift the equity share of the balance sheet.',
  },
  debt_burden: {
    title: 'Reduce debt burden',
    description: (c) => c.reason,
    action: 'Prioritise the highest-rate balances (see the payoff projection) to cut monthly obligations.',
  },
  savings: {
    title: 'Increase your savings rate',
    description: (c) => c.reason,
    action: 'Aim to save 20–30% of income by trimming discretionary spend or raising income.',
  },
  liquidity: {
    title: 'Build an emergency buffer',
    description: (c) => c.reason,
    action: 'Hold cash covering ~6 months of expenses before investing further.',
  },
  diversification: {
    title: 'Diversify across asset classes',
    description: (c) => c.reason,
    action: 'Spread holdings across equity, debt, gold and cash toward target weights.',
  },
};

/** Financial-impact context derived from the immutable snapshot (never re-scores). */
function financialImpactFor(
  c: CategoryScore,
  payload?: FinancialSnapshotPayload,
): FinancialImpact {
  if (!payload) return { summary: 'Improve this category toward its target.', gapMinor: null };
  const { cashflowSummary, assets, debt } = payload;
  switch (c.key) {
    case 'liquidity': {
      const cash = assets.filter((a) => a.assetClass === 'cash').reduce((s, a) => s + a.baseBalanceMinor, 0);
      const target = 6 * cashflowSummary.expenseMinor;
      const gap = Math.max(0, target - cash);
      return { summary: 'Additional cash to reach a 6-month buffer.', gapMinor: gap };
    }
    case 'savings': {
      const targetMonthly = 0.2 * cashflowSummary.incomeMinor;
      const currentMonthly = cashflowSummary.savingsRate * cashflowSummary.incomeMinor;
      const gap = Math.max(0, Math.round(targetMonthly - currentMonthly));
      return { summary: 'Extra monthly surplus to reach a 20% savings rate.', gapMinor: gap };
    }
    case 'debt_burden': {
      const target = 0.2 * cashflowSummary.incomeMinor;
      const gap = Math.max(0, Math.round(debt.totalMonthlyPaymentMinor - target));
      return { summary: 'Monthly debt payment above a healthy 20% of income.', gapMinor: gap };
    }
    default:
      return { summary: 'Improve this category toward its target.', gapMinor: null };
  }
}

function priorityOf(improvement: number): Priority {
  if (improvement >= 5) return 'high';
  if (improvement >= 2) return 'medium';
  return 'low';
}

/**
 * Explain a Financial Health Score. Pure and deterministic: same `(score, payload)` ⇒
 * identical `HealthExplanation`. Consumes the score's categories/weights directly and
 * never recomputes a score.
 */
export function explainFinancialHealth(
  score: FinancialHealthScore,
  payload?: FinancialSnapshotPayload,
): HealthExplanation {
  const totalWeight = score.categories.reduce((s, c) => s + c.weight, 0) || 1;

  const categoryBreakdown: CategoryBreakdown[] = score.categories.map((c) => ({
    key: c.key,
    label: c.label,
    weight: c.weight,
    score: c.score,
    band: c.band,
    pointsContributed: round1((c.score * c.weight) / totalWeight),
    pointsLost: round1(((100 - c.score) * c.weight) / totalWeight),
  }));

  const strengths: Strength[] = score.categories
    .filter((c) => c.score >= STRENGTH_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .map((c) => ({ key: c.key, label: c.label, score: c.score, reasonCode: STRENGTH_CODE[c.key] }));

  const weakCats = score.categories
    .filter((c) => c.score < STRENGTH_THRESHOLD)
    .sort((a, b) => a.score - b.score);

  const weaknesses: Weakness[] = weakCats.map((c) => ({
    key: c.key,
    label: c.label,
    score: c.score,
    impact: round1(((100 - c.score) * c.weight) / totalWeight),
    reasonCode: weaknessCode(c, payload),
  }));

  // Recommendations (one per weak category), ranked by estimated overall improvement.
  const recsUnranked = weakCats.map((c) => {
    const improvement = round1((Math.max(0, RECOMMENDATION_TARGET - c.score) * c.weight) / totalWeight);
    const tpl = REC_TEMPLATE[c.key];
    return {
      category: c,
      improvement,
      reasonCode: weaknessCode(c, payload),
      tpl,
      financialImpact: financialImpactFor(c, payload),
    };
  });
  recsUnranked.sort(
    (a, b) => b.improvement - a.improvement || a.category.key.localeCompare(b.category.key),
  );

  const recommendations: Recommendation[] = recsUnranked.map((r, i) => ({
    id: `rec_${r.category.key}`,
    title: r.tpl.title,
    description: r.tpl.description(r.category),
    affectedCategory: r.category.key,
    priority: priorityOf(r.improvement),
    priorityRank: i + 1,
    estimatedScoreImprovement: r.improvement,
    financialImpact: r.financialImpact,
    recommendedAction: r.tpl.action,
    reasonCode: r.reasonCode,
  }));

  const priorityRanking: PriorityRankEntry[] = recommendations.map((r) => ({
    rank: r.priorityRank,
    affectedCategory: r.affectedCategory,
    reasonCode: r.reasonCode,
    estimatedScoreImprovement: r.estimatedScoreImprovement,
  }));

  const rawPotential = recommendations.reduce((s, r) => s + r.estimatedScoreImprovement, 0);
  const potentialScoreImprovement = round1(Math.min(100 - score.overall, rawPotential));
  const potentialOverall = Math.min(100, Math.round(score.overall + potentialScoreImprovement));

  // Confidence = data completeness of the underlying snapshot (deterministic).
  let confidence = 1;
  const confCodes: ReasonCode[] = [];
  if (payload) {
    if (payload.cashflowSummary.incomeMinor === 0) {
      confidence -= 0.2;
      confCodes.push('NO_INCOME_DATA');
    }
    if (payload.cashflowSummary.expenseMinor === 0) {
      confidence -= 0.15;
      confCodes.push('NO_EXPENSE_DATA');
    }
    if (payload.assets.length === 0) {
      confidence -= 0.2;
      confCodes.push('NO_ASSET_DATA');
    }
  }
  confidence = Math.max(0, Math.round(confidence * 100) / 100);

  const strongest = strengths[0];
  const topWeak = weaknesses[0];
  const summary =
    `Financial health is ${score.band.replace(/_/g, ' ')} at ${score.overall}/100.` +
    (strongest ? ` Strongest: ${strongest.label}.` : '') +
    (topWeak ? ` Most impactful weakness: ${topWeak.label} (−${topWeak.impact} pts).` : '');

  const reasonCodes = Array.from(
    new Set<ReasonCode>([
      ...strengths.map((s) => s.reasonCode),
      ...weaknesses.map((w) => w.reasonCode),
      ...confCodes,
    ]),
  );

  return {
    overall: score.overall,
    band: score.band,
    modelVersion: score.modelVersion,
    summary,
    categoryBreakdown,
    strengths,
    weaknesses,
    recommendations,
    priorityRanking,
    potentialScoreImprovement,
    potentialOverall,
    confidence,
    reasonCodes,
  };
}
