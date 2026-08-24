import { FinancialSnapshotPayload } from './financialSnapshot.js';

/**
 * Financial Health Score (M3-1) — a **pure, explainable, deterministic** function of a
 * Financial Snapshot payload. See docs/architecture/M3_FINANCIAL_HEALTH_DESIGN.md. No
 * IO, no clocks, no randomness: `score(payload, model)` is fully reproducible. It reads
 * an immutable snapshot payload only and never mutates anything.
 */

/**
 * Version of the scoring model (weights + anchors). Bumped when tuning changes.
 *
 * `fhs-2.0.0` (M5.12) adds Protection and Retirement. See
 * `docs/M5_12_WEALTH_HEALTH_SCORE_V2_ARCHITECTURE.md`. Stored scores keep the version they were
 * computed under and are never recomputed, so a household's history spans both models — which is
 * why the score timeline marks where the model changed rather than drawing one continuous line.
 */
export const FINANCIAL_HEALTH_MODEL_VERSION = 'fhs-2.0.0';

export type HealthBand = 'at_risk' | 'needs_attention' | 'fair' | 'good' | 'excellent';

export type CategoryKey =
  | 'net_worth'
  | 'debt_burden'
  | 'savings'
  | 'liquidity'
  | 'diversification'
  | 'protection'
  | 'retirement';

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

/**
 * The default, documented model. Anchors are explainable and tunable per version.
 *
 * **M5.12 weights.** The five original categories are scaled by exactly 0.7 and the 30 points
 * released are split evenly between Protection and Retirement. Scaling all five by the *same*
 * factor is deliberate: a household that has recorded neither has both new categories omitted
 * (§ `computeFinancialHealthScore`), and renormalising the remaining 70 restores the original
 * proportions exactly — so their score is unchanged from `fhs-1.0.0` to the integer. Only
 * families who actually told us something see their number move.
 *
 * The 15/15 split is the product decision here, and it is data: changing it is an edit to this
 * object plus a version bump, not a change to any logic. For reference V1's separate engine
 * (`scoring/scores.ts`) weights protection at 20.
 */
export const DEFAULT_FINANCIAL_HEALTH_MODEL: FinancialHealthModel = {
  version: FINANCIAL_HEALTH_MODEL_VERSION,
  categories: [
    { key: 'net_worth', label: 'Net Worth & Solvency', weight: 17.5 },
    { key: 'debt_burden', label: 'Debt Burden', weight: 17.5 },
    { key: 'savings', label: 'Savings', weight: 14 },
    { key: 'liquidity', label: 'Emergency Liquidity', weight: 14 },
    { key: 'diversification', label: 'Diversification', weight: 7 },
    { key: 'protection', label: 'Protection', weight: 15 },
    { key: 'retirement', label: 'Retirement Readiness', weight: 15 },
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
    // Life cover held as a fraction of the cover `analyzeLifeInsuranceGap` recommends: higher is
    // better, and being over-covered is not better than being covered.
    coverRatio: [
      { x: 0, score: 0 },
      { x: 0.5, score: 55 },
      { x: 1, score: 100 },
    ],
    // Retirement readiness: projected corpus at retirement over the corpus required. Reaching
    // the target scores full marks; there is no extra credit for a surplus.
    retirementReadiness: [
      { x: 0, score: 0 },
      { x: 0.5, score: 50 },
      { x: 0.8, score: 80 },
      { x: 1, score: 100 },
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

/**
 * Facts the snapshot does not carry, for the categories that need them (M5.12).
 *
 * The snapshot payload is frozen and neither of these is a kernel fact — they are module-owned
 * assumptions, stated by the family. Built by `deriveHealthFacts`, which composes the existing
 * calculators; nothing here is computed by the scorer.
 *
 * **`null` and `undefined` both mean "not known", and a category with unknown facts is OMITTED
 * from the score rather than scored zero.** Scoring an unrecorded family as uninsured would
 * assert an absence nobody told us — the #67 defect, this time lowering the number a family is
 * judged by. Omission renormalises the remaining weights, so the result is the honest one: we
 * scored what we know.
 */
export interface HealthFacts {
  protection?: {
    /** Term life cover held, over the cover recommended for this family. `null` = not stated. */
    coverRatio: number | null;
    /** `null` = not stated. */
    hasHealthInsurance: boolean | null;
  } | null;
  retirement?: {
    /**
     * Projected corpus at retirement over the corpus required, ≥ 0.
     *
     * Present ONLY when the family has stated a retirement plan. The intelligence layer falls
     * back to documented default assumptions so it can always show something; judging a family's
     * headline number against assumptions they never gave us is a different matter. Defaults
     * inform, they do not judge.
     */
    readiness: number;
  } | null;
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
  facts: HealthFacts = {},
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
  // `undefined` when this model does not carry the category at all — a caller may deliberately
  // score against an older model, and that must not throw.
  const weightOf = (k: CategoryKey) => model.categories.find((c) => c.key === k);

  // Net Worth & Solvency
  {
    const c = weightOf('net_worth')!;
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
    const c = weightOf('debt_burden')!;
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
    const c = weightOf('savings')!;
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
    const c = weightOf('liquidity')!;
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
    const c = weightOf('diversification')!;
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

  // Protection (M5.12) — scored ONLY when the family has told us something. See `HealthFacts`.
  {
    const c = weightOf('protection');
    const f = facts.protection;
    const coverScore = f?.coverRatio == null ? null : interpolate(a.coverRatio!, f.coverRatio);
    const healthScore = f?.hasHealthInsurance == null ? null : f.hasHealthInsurance ? 100 : 0;
    // Two sub-scores, each dropped when unstated — the same shape Debt Burden uses when income
    // is missing. Both unstated means the category itself is unknown, and it is omitted.
    const parts = [coverScore, healthScore].filter((x): x is number => x !== null);
    if (c && parts.length > 0) {
      const score = round(parts.reduce((s2, x) => s2 + x, 0) / parts.length);
      const ratioPct = f?.coverRatio == null ? null : pct1(Math.min(1, f.coverRatio));
      categories.push({
        key: c.key,
        label: c.label,
        weight: c.weight,
        score,
        band: bandOf(score),
        metric: {
          name: 'coverRatio',
          value: f?.coverRatio == null ? 0 : Math.round(f.coverRatio * 100) / 100,
          unit: 'ratio',
        },
        reason:
          ratioPct === null
            ? f?.hasHealthInsurance
              ? 'Health cover is in place; life cover has not been recorded.'
              : 'No health cover recorded, and life cover has not been recorded.'
            : `Life cover is ${ratioPct}% of what this family would need` +
              (f?.hasHealthInsurance === null
                ? '.'
                : f?.hasHealthInsurance
                  ? ', and health cover is in place.'
                  : ', and there is no health cover.'),
        suggestion:
          score >= 90
            ? 'Protection looks adequate — review it when income or dependants change.'
            : 'Close the protection gap before it is needed: term cover first, then health.',
      });
    }
  }

  // Retirement Readiness (M5.12) — scored ONLY when the family has stated a plan.
  {
    const c = weightOf('retirement');
    const f = facts.retirement;
    if (c && f) {
      const score = round(interpolate(a.retirementReadiness!, f.readiness));
      const readinessPct = Math.round(Math.min(1, Math.max(0, f.readiness)) * 100);
      categories.push({
        key: c.key,
        label: c.label,
        weight: c.weight,
        score,
        band: bandOf(score),
        metric: { name: 'retirementReadiness', value: Math.round(f.readiness * 100) / 100, unit: 'ratio' },
        reason: `On the current plan you reach ${readinessPct}% of the corpus this retirement needs.`,
        suggestion:
          score >= 90
            ? 'Retirement is on track — revisit if income or expenses change materially.'
            : 'Increase monthly contributions, or revisit the retirement age or target income.',
      });
    }
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
