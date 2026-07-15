import { FinancialSnapshotPayload } from './financialSnapshot.js';
import {
  computeFinancialHealthScore,
  type FinancialHealthModel,
  type FinancialHealthScore,
} from './financialHealth.js';
import {
  explainFinancialHealth,
  type Recommendation,
} from './financialHealthExplanation.js';

/**
 * Financial What-if Simulation Engine (M3-3) — pure, deterministic, snapshot-driven.
 * See docs/architecture/M3_SIMULATION_ENGINE.md. It builds a **transient virtual
 * snapshot** (an in-memory copy of an immutable snapshot payload with scenario
 * transforms applied), then **reuses** M3-1 scoring and M3-2 explanation to score and
 * explain it, and diffs against the baseline. It never mutates its input, never
 * persists, and never touches the kernel (ADR-013). No IO, clock, randomness, or LLM.
 */

export const SIMULATION_ENGINE_VERSION = 'sim-1.0.0';

export type ScenarioType =
  | 'repay_debt'
  | 'increase_emergency_fund'
  | 'buy_asset'
  | 'sell_asset'
  | 'reallocate'
  | 'reduce_expenses'
  | 'increase_savings'
  | 'increase_sip'
  | 'retirement_contribution'
  | 'improve_insurance';

export interface SimulationScenario {
  type: ScenarioType | string;
  params: Record<string, number | string>;
  label?: string;
}

export interface SimulationRequest {
  scenarios: SimulationScenario[];
}

export interface CategoryImpact {
  key: string;
  label: string;
  before: number;
  after: number;
  delta: number;
  bandBefore: string;
  bandAfter: string;
  direction: 'improved' | 'weakened' | 'unchanged';
}

export interface RecommendationImpact {
  id: string;
  title: string;
  affectedCategory: string;
  priority: string;
  estimatedScoreImprovement: number;
  financialImpact: Recommendation['financialImpact'];
  recommendedAction: string;
  reasonCode: string;
}

export interface ScenarioSummary {
  overallBefore: number;
  overallAfter: number;
  overallDelta: number;
  bandBefore: string;
  bandAfter: string;
  improved: string[];
  weakened: string[];
  narrative: string;
}

export interface BestSingleAction {
  scenario: SimulationScenario;
  overallDelta: number;
  narrative: string;
}

export interface SimulationMetadata {
  snapshotId: string;
  scoreModelVersion: string;
  simulationEngineVersion: string;
  scenarioTypes: string[];
  deterministic: true;
}

export interface SimulationResult {
  metadata: SimulationMetadata;
  summary: ScenarioSummary;
  categoryImpacts: CategoryImpact[];
  topRecommendation: RecommendationImpact | null;
  recommendations: RecommendationImpact[];
  bestSingleAction: BestSingleAction | null;
}

/** A pure scenario transform: returns a NEW payload with the scenario applied. */
export type ScenarioTransform = (
  payload: FinancialSnapshotPayload,
  params: Record<string, number | string>,
) => FinancialSnapshotPayload;

// --- payload helpers (pure) ---------------------------------------------------

function clone(payload: FinancialSnapshotPayload): FinancialSnapshotPayload {
  return JSON.parse(JSON.stringify(payload)) as FinancialSnapshotPayload;
}

const num = (v: number | string | undefined, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const str = (v: number | string | undefined, fallback: string): string =>
  typeof v === 'string' && v.length > 0 ? v : fallback;

/** Total base-currency value currently held in an asset class. */
function classSum(p: FinancialSnapshotPayload, assetClass: string): number {
  return p.assets.filter((a) => a.assetClass === assetClass).reduce((s, a) => s + a.baseBalanceMinor, 0);
}

/** Add `amount` (base minor units) to an asset class via a synthetic entry. */
function addToClass(p: FinancialSnapshotPayload, assetClass: string, amount: number): void {
  if (amount === 0) return;
  const ccy = p.assets.find((a) => a.assetClass === assetClass)?.nativeCurrency ?? p.assets[0]?.nativeCurrency ?? 'INR';
  p.assets.push({
    accountId: 'sim',
    name: `Simulated ${assetClass}`,
    assetClass,
    entityId: null,
    nativeCurrency: ccy,
    nativeBalanceMinor: amount,
    baseBalanceMinor: amount,
  });
}

/** Withdraw up to `amount` from an asset class (clamped to what's held). Returns actual. */
function withdrawFromClass(p: FinancialSnapshotPayload, assetClass: string, amount: number): number {
  const actual = Math.min(classSum(p, assetClass), Math.max(0, amount));
  if (actual > 0) addToClass(p, assetClass, -actual);
  return actual;
}

/** Re-derive the aggregates the health score consumes so the virtual payload is consistent. */
function normalize(p: FinancialSnapshotPayload): FinancialSnapshotPayload {
  const totalAssets = p.assets.reduce((s, a) => s + a.baseBalanceMinor, 0);
  const totalLiab = p.liabilities.reduce((s, a) => s + a.baseBalanceMinor, 0);
  const net = totalAssets - totalLiab;
  p.netWorth = {
    assetsMinor: totalAssets,
    liabilitiesMinor: totalLiab,
    netWorthMinor: net,
    solvencyRatio: totalAssets > 0 ? net / totalAssets : 0,
  };

  const byClass = new Map<string, number>();
  for (const a of p.assets) {
    const key = a.assetClass ?? 'unclassified';
    byClass.set(key, (byClass.get(key) ?? 0) + a.baseBalanceMinor);
  }
  p.assetAllocation = [...byClass.entries()]
    .filter(([, v]) => v > 0)
    .map(([assetClass, baseValueMinor]) => ({
      assetClass,
      baseValueMinor,
      pct: totalAssets > 0 ? Math.round((baseValueMinor / totalAssets) * 1000) / 10 : 0,
    }))
    .sort((x, y) => y.baseValueMinor - x.baseValueMinor);

  const byCcy = new Map<string, number>();
  for (const a of [...p.assets, ...p.liabilities]) {
    byCcy.set(a.nativeCurrency, (byCcy.get(a.nativeCurrency) ?? 0) + a.baseBalanceMinor);
  }
  const gross = [...byCcy.values()].reduce((s, v) => s + v, 0);
  p.currencyExposure = [...byCcy.entries()]
    .map(([currency, baseValueMinor]) => ({
      currency,
      baseValueMinor,
      pct: gross > 0 ? Math.round((baseValueMinor / gross) * 1000) / 10 : 0,
    }))
    .sort((x, y) => y.baseValueMinor - x.baseValueMinor);

  p.householdEquity = {
    netWorthMinor: net,
    totalDebtMinor: p.debt.totalOutstandingMinor,
    reconciledEquityMinor: net - p.debt.totalOutstandingMinor,
  };

  const income = p.cashflowSummary.incomeMinor;
  const expense = p.cashflowSummary.expenseMinor;
  p.cashflowSummary.netMinor = income - expense;
  p.cashflowSummary.savingsRate = income > 0 ? (income - expense) / income : 0;
  return p;
}

// --- scenario registry (open for extension) -----------------------------------

export const DEFAULT_SCENARIO_REGISTRY: Record<ScenarioType, ScenarioTransform> = {
  repay_debt: (p, params) => {
    const want = num(params.amountMinor);
    const pay = Math.min(want, p.debt.totalOutstandingMinor, classSum(p, 'cash'));
    if (pay > 0) {
      const oldOut = p.debt.totalOutstandingMinor;
      const oldMonthly = p.debt.totalMonthlyPaymentMinor;
      withdrawFromClass(p, 'cash', pay);
      p.debt.totalOutstandingMinor = oldOut - pay;
      p.debt.totalMonthlyPaymentMinor = oldOut > 0 ? Math.round((oldMonthly * (oldOut - pay)) / oldOut) : 0;
    }
    return p;
  },
  increase_emergency_fund: (p, params) => {
    const from = str(params.fromClass, 'equity');
    const moved = withdrawFromClass(p, from, num(params.amountMinor));
    addToClass(p, 'cash', moved);
    return p;
  },
  buy_asset: (p, params) => {
    const from = str(params.fromClass, 'cash');
    const cls = str(params.assetClass, 'equity');
    const moved = withdrawFromClass(p, from, num(params.amountMinor));
    addToClass(p, cls, moved);
    return p;
  },
  sell_asset: (p, params) => {
    const to = str(params.toClass, 'cash');
    const cls = str(params.assetClass, 'equity');
    const moved = withdrawFromClass(p, cls, num(params.amountMinor));
    addToClass(p, to, moved);
    return p;
  },
  reallocate: (p, params) => {
    const from = str(params.fromClass, 'cash');
    const to = str(params.toClass, 'equity');
    if (from !== to) {
      const moved = withdrawFromClass(p, from, num(params.amountMinor));
      addToClass(p, to, moved);
    }
    return p;
  },
  reduce_expenses: (p, params) => {
    const m = Math.min(num(params.monthlyAmountMinor), p.cashflowSummary.expenseMinor);
    p.cashflowSummary.expenseMinor -= m;
    return p;
  },
  increase_savings: (p, params) => {
    const m = Math.min(num(params.monthlyAmountMinor), p.cashflowSummary.expenseMinor);
    p.cashflowSummary.expenseMinor -= m;
    addToClass(p, 'cash', m);
    return p;
  },
  increase_sip: (p, params) => {
    const cls = str(params.assetClass, 'equity');
    const m = Math.min(num(params.monthlyAmountMinor), p.cashflowSummary.expenseMinor);
    p.cashflowSummary.expenseMinor -= m;
    addToClass(p, cls, m);
    return p;
  },
  retirement_contribution: (p, params) => {
    const cls = str(params.assetClass, 'equity');
    const m = Math.min(num(params.monthlyAmountMinor), p.cashflowSummary.expenseMinor);
    p.cashflowSummary.expenseMinor -= m;
    addToClass(p, cls, m);
    return p;
  },
  improve_insurance: (p, params) => {
    // Insurance is not yet a scored category (fhs-1.0.0): the premium raises expense.
    p.cashflowSummary.expenseMinor += Math.max(0, num(params.monthlyPremiumMinor));
    return p;
  },
};

/** The supported scenario types + their expected param keys (for discoverability). */
export const SCENARIO_TYPE_PARAMS: Record<ScenarioType, string[]> = {
  repay_debt: ['amountMinor'],
  increase_emergency_fund: ['amountMinor', 'fromClass?'],
  buy_asset: ['assetClass', 'amountMinor', 'fromClass?'],
  sell_asset: ['assetClass', 'amountMinor', 'toClass?'],
  reallocate: ['fromClass', 'toClass', 'amountMinor'],
  reduce_expenses: ['monthlyAmountMinor'],
  increase_savings: ['monthlyAmountMinor'],
  increase_sip: ['monthlyAmountMinor', 'assetClass?'],
  retirement_contribution: ['monthlyAmountMinor', 'assetClass?'],
  improve_insurance: ['monthlyPremiumMinor'],
};

// --- engine -------------------------------------------------------------------

export interface SimulationOptions {
  snapshotId?: string;
  model?: FinancialHealthModel;
  /** Extend/override the default registry to add scenario types without changing the engine. */
  registry?: Record<string, ScenarioTransform>;
}

/** Apply scenarios to a fresh copy of the payload (input never mutated). */
export function applyScenarios(
  baseline: FinancialSnapshotPayload,
  scenarios: SimulationScenario[],
  registry: Record<string, ScenarioTransform> = DEFAULT_SCENARIO_REGISTRY,
): FinancialSnapshotPayload {
  let p = clone(baseline);
  for (const s of scenarios) {
    const transform = registry[s.type];
    if (!transform) throw new Error(`Unknown scenario type: ${s.type}`);
    p = normalize(transform(p, s.params ?? {}));
  }
  return p;
}

function toRecImpact(r: Recommendation): RecommendationImpact {
  return {
    id: r.id,
    title: r.title,
    affectedCategory: r.affectedCategory,
    priority: r.priority,
    estimatedScoreImprovement: r.estimatedScoreImprovement,
    financialImpact: r.financialImpact,
    recommendedAction: r.recommendedAction,
    reasonCode: r.reasonCode,
  };
}

/** Overall score delta for a single scenario applied alone (pure helper). */
function overallDeltaFor(
  baseline: FinancialSnapshotPayload,
  baseOverall: number,
  scenario: SimulationScenario,
  registry: Record<string, ScenarioTransform>,
  model?: FinancialHealthModel,
): number {
  const virtual = applyScenarios(baseline, [scenario], registry);
  return computeFinancialHealthScore(virtual, model).overall - baseOverall;
}

/**
 * Run a what-if simulation on an immutable snapshot payload. Pure and deterministic:
 * same `(baseline, request)` ⇒ identical `SimulationResult`. Reuses M3-1 scoring and
 * M3-2 explanation; the baseline payload is never mutated.
 */
export function simulateFinancialWhatIf(
  baseline: FinancialSnapshotPayload,
  request: SimulationRequest,
  opts: SimulationOptions = {},
): SimulationResult {
  const registry = { ...DEFAULT_SCENARIO_REGISTRY, ...(opts.registry ?? {}) };
  const model = opts.model;

  const baselineScore: FinancialHealthScore = computeFinancialHealthScore(baseline, model);
  const virtual = applyScenarios(baseline, request.scenarios, registry);
  const virtualScore = computeFinancialHealthScore(virtual, model);
  const virtualExplanation = explainFinancialHealth(virtualScore, virtual);

  const beforeByKey = new Map(baselineScore.categories.map((c) => [c.key, c]));
  const categoryImpacts: CategoryImpact[] = virtualScore.categories.map((after) => {
    const before = beforeByKey.get(after.key)!;
    const delta = after.score - before.score;
    return {
      key: after.key,
      label: after.label,
      before: before.score,
      after: after.score,
      delta,
      bandBefore: before.band,
      bandAfter: after.band,
      direction: delta > 0 ? 'improved' : delta < 0 ? 'weakened' : 'unchanged',
    };
  });

  const improved = categoryImpacts.filter((c) => c.direction === 'improved').map((c) => c.key);
  const weakened = categoryImpacts.filter((c) => c.direction === 'weakened').map((c) => c.key);
  const overallDelta = virtualScore.overall - baselineScore.overall;
  const sign = overallDelta >= 0 ? '+' : '';
  const summary: ScenarioSummary = {
    overallBefore: baselineScore.overall,
    overallAfter: virtualScore.overall,
    overallDelta,
    bandBefore: baselineScore.band,
    bandAfter: virtualScore.band,
    improved,
    weakened,
    narrative:
      `Applying ${request.scenarios.length} change(s) moves the score from ${baselineScore.overall} to ` +
      `${virtualScore.overall} (${sign}${overallDelta}).` +
      (improved.length ? ` Improved: ${improved.join(', ')}.` : '') +
      (weakened.length ? ` Weakened: ${weakened.join(', ')}.` : ''),
  };

  const recommendations = virtualExplanation.recommendations.map(toRecImpact);

  // Which single requested action helps the most (each simulated alone).
  let bestSingleAction: BestSingleAction | null = null;
  for (const scenario of request.scenarios) {
    const d = overallDeltaFor(baseline, baselineScore.overall, scenario, registry, model);
    if (!bestSingleAction || d > bestSingleAction.overallDelta) {
      bestSingleAction = {
        scenario,
        overallDelta: d,
        narrative: `${scenario.label ?? scenario.type} alone changes the score by ${d >= 0 ? '+' : ''}${d}.`,
      };
    }
  }

  return {
    metadata: {
      snapshotId: opts.snapshotId ?? '',
      scoreModelVersion: baselineScore.modelVersion,
      simulationEngineVersion: SIMULATION_ENGINE_VERSION,
      scenarioTypes: request.scenarios.map((s) => String(s.type)),
      deterministic: true,
    },
    summary,
    categoryImpacts,
    topRecommendation: recommendations[0] ?? null,
    recommendations,
    bestSingleAction,
  };
}
