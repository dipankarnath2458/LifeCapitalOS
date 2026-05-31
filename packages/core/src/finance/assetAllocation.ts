import { z } from 'zod';
import { assetClassSchema, riskToleranceSchema } from '../domain/schemas.js';

export type AssetClass = z.infer<typeof assetClassSchema>;
export type RiskTolerance = z.infer<typeof riskToleranceSchema>;

export type Allocation = Partial<Record<AssetClass, number>>;

export interface AllocationAnalysis {
  current: Record<AssetClass, number>;
  recommended: Record<AssetClass, number>;
  /** Per-class drift = current - recommended (percentage points). */
  drift: Record<AssetClass, number>;
  /** Human-readable rebalancing suggestions, most significant first. */
  suggestions: string[];
}

const ALL_CLASSES: AssetClass[] = [
  'equity',
  'debt',
  'gold',
  'real_estate',
  'cash',
  'crypto',
  'business',
  'other',
];

/**
 * Recommended model portfolios by risk tolerance, optionally age-adjusted using a
 * simplified "100 - age" equity glide path bounded by the risk band.
 */
export function recommendedAllocation(
  risk: RiskTolerance,
  age?: number,
): Record<AssetClass, number> {
  const base: Record<RiskTolerance, Allocation> = {
    conservative: { equity: 30, debt: 45, gold: 10, real_estate: 10, cash: 5 },
    moderate: { equity: 55, debt: 25, gold: 10, real_estate: 7, cash: 3 },
    aggressive: { equity: 75, debt: 12, gold: 8, real_estate: 3, cash: 2 },
  };
  const alloc = { ...base[risk] };
  if (age && Number.isFinite(age)) {
    const glide = Math.max(20, Math.min(80, 100 - age));
    const equity = Math.round((((alloc.equity ?? 0) + glide) / 2));
    const diff = (alloc.equity ?? 0) - equity;
    alloc.equity = equity;
    alloc.debt = (alloc.debt ?? 0) + diff; // shift the difference into debt
  }
  return normalize(alloc);
}

function normalize(alloc: Allocation): Record<AssetClass, number> {
  const total = ALL_CLASSES.reduce((s, c) => s + (alloc[c] ?? 0), 0);
  const out = {} as Record<AssetClass, number>;
  for (const c of ALL_CLASSES) {
    out[c] = total > 0 ? Math.round(((alloc[c] ?? 0) / total) * 1000) / 10 : 0;
  }
  return out;
}

const CLASS_LABEL: Record<AssetClass, string> = {
  equity: 'Equity',
  debt: 'Debt',
  gold: 'Gold',
  real_estate: 'Real Estate',
  cash: 'Cash',
  crypto: 'Crypto',
  business: 'Business',
  other: 'Other',
};

/** Build current allocation (%) from per-class values in the base currency. */
export function allocationFromValues(values: Allocation): Record<AssetClass, number> {
  return normalize(values);
}

export function analyzeAllocation(
  currentValues: Allocation,
  risk: RiskTolerance,
  age?: number,
): AllocationAnalysis {
  const current = normalize(currentValues);
  const recommended = recommendedAllocation(risk, age);
  const drift = {} as Record<AssetClass, number>;
  for (const c of ALL_CLASSES) {
    drift[c] = Math.round((current[c] - recommended[c]) * 10) / 10;
  }
  const suggestions = ALL_CLASSES.filter((c) => Math.abs(drift[c]) >= 5)
    .sort((a, b) => Math.abs(drift[b]) - Math.abs(drift[a]))
    .map((c) =>
      drift[c] > 0
        ? `You are overweight in ${CLASS_LABEL[c]} by ${drift[c]}%. Consider trimming.`
        : `You are underweight in ${CLASS_LABEL[c]} by ${Math.abs(drift[c])}%. Consider adding.`,
    );
  return { current, recommended, drift, suggestions };
}
