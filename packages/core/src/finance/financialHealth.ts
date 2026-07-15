import { FinancialSnapshotPayload } from './financialSnapshot.js';

/**
 * Financial Health Score (M3-1) — a **pure, explainable, deterministic** function of a
 * Financial Snapshot payload. See docs/architecture/M3_FINANCIAL_HEALTH_DESIGN.md. No
 * IO, no clocks, no randomness: `score(payload, model)` is fully reproducible. It reads
 * an immutable snapshot payload only and never mutates anything.
 */

/** Version of the scoring model (weights + anchors). Bumped when tuning changes. */
export const FINANCIAL_HEALTH_MODEL_VERSION = 'fhs-1.0.0';

export type HealthBand = 'at_risk' | 'needs_attention' | 'fair' | 'good' | 'excellent';

export type CategoryKey =
  | 'net_worth'
  | 'debt_burden'
  | 'savings'
  | 'liquidity'
  | 'diversification';

/** A monotonic piecewise-linear map from a metric value to a 0..100 sub-score. */
export interface Anchor {
  x: number;
  score: number;
}

export interface CategoryModel {
  key: CategoryKey;
  label: string;
  weight: number;
}

export interface FinancialHealthModel {
  version: string;
  categories: CategoryModel[];
  anchors: Record<string, Anchor[]>;
}

/** The default, documented model. Anchors are explainable and tunable per version. */
export const DEFAULT_FINANCIAL_HEALTH_MODEL: FinancialHealthModel = {
  version: FINANCIAL_HEALTH_MODEL_VERSION,
  categories: [
    { key: 'net_worth', label: 'Net Worth & Solvency', weight: 25 },
    { key: 'debt_burden', label: 'Debt Burden', weight: 25 },
    { key: 'savings', label: 'Savings', weight: 20 },
    { key: 'liquidity', label: 'Emergency Liquidity', weight: 20 },
    { key: 'diversification', label: 'Diversification', weight: 10 },
  ],
  anchors: {
    // Savings rate (ratio): higher is better.
    savingsRate: [
      { x: 0, score: 0 },
      { x: 0.1, score: 50 },
      { x: 0.2, score: 75 },
      { x: 0.3, score: 100 },
    ],
    // Debt-to-income (monthly debt / monthly income): lower is better.
    dti: [
      { x: 0, score: 100 },
      { x: 0.2, score: 75 },
      { x: 0.36, score: 50 },
      { x: 0.5, score: 0 },
    ],
    // Debt-to-assets: lower is better.
    debtToAssets: [
      { x: 0, score: 100 },
      { x: 0.3, score: 70 },
      { x: 0.5, score: 50 },
      { x: 0.8, score: 0 },
    ],
    // Emergency liquidity (months of expenses held in cash): higher is better.
    liquidityMonths: [
      { x: 0, score: 0 },
      { x: 3, score: 60 },
      { x: 6, score: 90 },
      { x: 9, score: 100 },
    ],
    // Solvency ratio (net worth / assets, i.e. equity share of the balance sheet, ≤ 1):
    // higher is better; 1.0 = debt-free, 0 = net-zero, negative = insolvent.
    solvency: [
      { x: 0, score: 0 },
      { x: 0.5, score: 70 },
      { x: 0.8, score: 90 },
      { x: 1, score: 100 },
    ],
    // Diversification (1 - HHI over asset-class fractions): higher is better.
    diversification: [
      { x: 0, score: 0 },
      { x: 0.5, score: 60 },
      { x: 0.75, score: 100 },
    ],
  },
};

/** Piecewise-linear interpolation over anchors sorted by x, clamped at both ends. */
export function interpolate(anchors: Anchor[], x: number): number {
  const first = anchors[0]!;
  const last = anchors[anchors.length - 1]!;
  if (x <= first.x) return first.score;
  if (x >= last.x) return last.score;
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i]!;
    const b = anchors[i + 1]!;
    if (x >= a.x && x <= b.x) {
      const t = (x - a.x) / (b.x - a.x);
      return a.score + t * (b.score - a.score);
    }
  }
  return last.score;
}

export function bandOf(score: number): HealthBand {
  if (score < 40) return 'at_risk';
  if (score < 60) return 'needs_attention';
  if (score < 75) return 'fair';
  if (score < 90) return 'good';
  return 'excellent';
}

export interface CategoryScore {
  key: CategoryKey;
  label: string;
  weight: number;
  score: number; // 0..100
  band: HealthBand;
  metric: { name: string; value: number; unit: string };
  reason: string;
  suggestion: string;
}

export interface FinancialHealthScore {
  modelVersion: string;
  overall: number; // 0..100
  band: HealthBand;
  categories: CategoryScore[];
  drivers: { top: CategoryKey[]; weakest: CategoryKey[] };
}

const round = (n: number) => Math.round(n);
const pct1 = (r: number) => Math.round(r * 1000) / 10;

/**
 * Compute the explainable Financial Health Score from a snapshot payload. Pure and
 * deterministic. Every sub-score records the metric it used, the score, a plain-language
 * reason, and a concrete suggestion, so the number is always traceable.
 */
export function computeFinancialHealthScore(
  payload: FinancialSnapshotPayload,
  model: FinancialHealthModel = DEFAULT_FINANCIAL_HEALTH_MODEL,
): FinancialHealthScore {
  const a = model.anchors;
  const { netWorth, debt, cashflowSummary, assets, assetAllocation } = payload;

  // --- metrics (all from base-currency snapshot fields; no FX here) ---
  const income = cashflowSummary.incomeMinor;
  const expense = cashflowSummary.expenseMinor;
  const savingsRate = cashflowSummary.savingsRate;
  const dti = income > 0 ? debt.totalMonthlyPaymentMinor / income : null;
  const debtToAssets =
    netWorth.assetsMinor > 0 ? debt.totalOutstandingMinor / netWorth.assetsMinor : 0;
  const cashMinor = assets
    .filter((x) => x.assetClass === 'cash')
    .reduce((s, x) => s + x.baseBalanceMinor, 0);
  const liquidityMonths = expense > 0 ? cashMinor / expense : cashMinor > 0 ? 99 : 0;
  const hhi = assetAllocation.reduce((s, c) => s + (c.pct / 100) * (c.pct / 100), 0);
  const diversification = assetAllocation.length > 0 ? 1 - hhi : 0;

  // --- category sub-scores ---
  const categories: CategoryScore[] = [];
  const weightOf = (k: CategoryKey) => model.categories.find((c) => c.key === k)!;

  // Net Worth & Solvency
  {
    const c = weightOf('net_worth');
    const solvencyScore =
      netWorth.netWorthMinor < 0 ? 0 : interpolate(a.solvency!, netWorth.solvencyRatio);
    const score = round(solvencyScore);
    categories.push({
      key: c.key,
      label: c.label,
      weight: c.weight,
      score,
      band: bandOf(score),
      metric: { name: 'solvencyRatio', value: Math.round(netWorth.solvencyRatio * 100) / 100, unit: 'ratio' },
      reason:
        netWorth.netWorthMinor < 0
          ? 'Net worth is negative — liabilities exceed assets.'
          : `Net worth is ${pct1(netWorth.solvencyRatio)}% of assets.`,
      suggestion:
        score >= 90
          ? 'Strong solvency — maintain it.'
          : 'Grow net worth: increase assets or reduce liabilities.',
    });
  }

  // Debt Burden (combine DTI + debt-to-assets; DTI dropped when income is 0)
  {
    const c = weightOf('debt_burden');
    const dtiScore = dti === null ? null : interpolate(a.dti!, dti);
    const dtaScore = interpolate(a.debtToAssets!, debtToAssets);
    const score = round(dtiScore === null ? dtaScore : (dtiScore + dtaScore) / 2);
    categories.push({
      key: c.key,
      label: c.label,
      weight: c.weight,
      score,
      band: bandOf(score),
      metric: {
        name: dti === null ? 'debtToAssets' : 'dti',
        value: dti === null ? Math.round(debtToAssets * 100) / 100 : Math.round(dti * 100) / 100,
        unit: 'ratio',
      },
      reason:
        debt.totalOutstandingMinor === 0
          ? 'No outstanding debt.'
          : dti === null
            ? `Debt is ${pct1(debtToAssets)}% of assets (no income recorded to assess DTI).`
            : `Debt payments are ${pct1(dti)}% of income; debt is ${pct1(debtToAssets)}% of assets.`,
      suggestion:
        score >= 90
          ? 'Debt is well within healthy limits.'
          : 'Reduce high-rate balances first (see the payoff projection).',
    });
  }

  // Savings
  {
    const c = weightOf('savings');
    const score = round(interpolate(a.savingsRate!, savingsRate));
    categories.push({
      key: c.key,
      label: c.label,
      weight: c.weight,
      score,
      band: bandOf(score),
      metric: { name: 'savingsRate', value: Math.round(savingsRate * 1000) / 1000, unit: 'ratio' },
      reason:
        income <= 0
          ? 'No income recorded for this period.'
          : `You save ${pct1(savingsRate)}% of income.`,
      suggestion:
        score >= 90
          ? 'Excellent savings rate — keep it up.'
          : 'Aim for 20–30% of income saved.',
    });
  }

  // Emergency Liquidity
  {
    const c = weightOf('liquidity');
    const score = round(interpolate(a.liquidityMonths!, liquidityMonths));
    const months = Math.round(liquidityMonths * 10) / 10;
    categories.push({
      key: c.key,
      label: c.label,
      weight: c.weight,
      score,
      band: bandOf(score),
      metric: { name: 'liquidityMonths', value: months, unit: 'months' },
      reason:
        expense <= 0
          ? 'No expenses recorded to size an emergency buffer.'
          : `Cash covers ${months.toFixed(1)} months of expenses.`,
      suggestion:
        score >= 90 ? 'Healthy emergency buffer.' : 'Build cash toward a 6-month buffer.',
    });
  }

  // Diversification
  {
    const c = weightOf('diversification');
    const score = round(interpolate(a.diversification!, diversification));
    const top = [...assetAllocation].sort((x, y) => y.pct - x.pct)[0];
    categories.push({
      key: c.key,
      label: c.label,
      weight: c.weight,
      score,
      band: bandOf(score),
      metric: { name: 'diversification', value: Math.round(diversification * 100) / 100, unit: 'index' },
      reason:
        assetAllocation.length === 0
          ? 'No asset classes to diversify yet.'
          : `${Math.round(top!.pct)}% concentrated in ${top!.assetClass}.`,
      suggestion:
        score >= 90
          ? 'Well diversified across asset classes.'
          : 'Spread holdings across more asset classes to reduce concentration.',
    });
  }

  // --- weighted overall (skip categories with zero effective weight) ---
  const totalWeight = categories.reduce((s, c) => s + c.weight, 0);
  const overall = round(
    categories.reduce((s, c) => s + c.score * c.weight, 0) / (totalWeight || 1),
  );

  const byScore = [...categories].sort((x, y) => y.score - x.score);
  return {
    modelVersion: model.version,
    overall,
    band: bandOf(overall),
    categories,
    drivers: {
      top: byScore.slice(0, 1).map((c) => c.key),
      weakest: byScore.slice(-1).map((c) => c.key),
    },
  };
}
