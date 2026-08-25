import { apiPost } from './api';

/**
 * What-if for the consumer (M5.13).
 *
 * Design: `docs/M5_13_WHATIF_AND_BUDGET_ARCHITECTURE.md`.
 *
 * **No arithmetic in this file, and none in the page that uses it.** Every score, delta and band
 * below is one the M3-3 engine returned. The only computation here is a unit conversion (rupees
 * the family typed → minor units the API expects), which is the same conversion the retirement
 * page performs and is not a financial calculation.
 *
 * ## Two "what if"s, deliberately kept apart
 *
 * `householdRetirement.runWhatIf` answers *"when can I retire?"* by re-projecting a corpus. This
 * one answers *"what happens to my Wealth Health Score?"* by re-scoring an immutable snapshot.
 * They are different engines over different questions, and neither is a fallback for the other —
 * so the surfaces name their subject rather than both calling themselves "what if".
 *
 * ## Why the "before" here is trustworthy
 *
 * Until M5.13 the API scored the simulation baseline without the family's protection and
 * retirement facts, so this number could differ from the dashboard's Wealth Health Score by up to
 * 16 points. `apps/api/test/simulation-score-agreement.e2e-spec.ts` now asserts the two endpoints
 * agree; if that suite ever fails, this page is lying to somebody.
 */

/** The scenario types this consumer surface offers. A deliberate subset — see below. */
export type ConsumerScenarioType =
  | 'reduce_expenses'
  | 'increase_savings'
  | 'repay_debt'
  | 'increase_emergency_fund'
  | 'increase_sip';

export interface ConsumerScenario {
  type: ConsumerScenarioType;
  params: Record<string, number | string>;
  label: string;
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

export interface SimulationSummary {
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
  scenario: { type: string; label?: string };
  overallDelta: number;
  narrative: string;
}

export interface SimulationResult {
  metadata: {
    snapshotId: string;
    scoreModelVersion: string;
    simulationEngineVersion: string;
    deterministic: true;
  };
  summary: SimulationSummary;
  categoryImpacts: CategoryImpact[];
  bestSingleAction: BestSingleAction | null;
}

export type SimulationResponse =
  | { available: true; snapshotId: string; currency: string; result: SimulationResult }
  | { available: false; reason: string };

/**
 * The changes a family is invited to try.
 *
 * `improve_insurance` is **deliberately absent**. Its transform models the premium only — it
 * raises monthly expense — while the benefit of being covered lives in `HealthFacts`, which no
 * scenario transform can reach. Offering it would answer "should I get insured?" with a lower
 * score, which is the opposite of what M5.9 and M5.12 were built to say. The Protection page
 * remains the honest route to that question. Likewise `buy_asset`, `sell_asset` and `reallocate`
 * need an asset class chosen per family and belong to an advisor's screen, not this one.
 */
export const CONSUMER_SCENARIOS: {
  type: ConsumerScenarioType;
  /** What the family sees. Phrased as an action they could take, not as a parameter name. */
  label: string;
  /** The prompt beside the amount box. */
  amountLabel: string;
  /** The param key the engine expects for this type — see `SCENARIO_TYPE_PARAMS` in core. */
  paramKey: 'monthlyAmountMinor' | 'amountMinor';
  /** A starting figure, so the family sees a result before deciding what to type. */
  defaultRupees: number;
  help: string;
}[] = [
  {
    type: 'reduce_expenses',
    label: 'Spend less each month',
    amountLabel: 'Spend less by (₹ a month)',
    paramKey: 'monthlyAmountMinor',
    defaultRupees: 5000,
    help: 'Lowers your monthly spending. Nothing is moved into savings.',
  },
  {
    type: 'increase_savings',
    label: 'Save more each month',
    amountLabel: 'Save more by (₹ a month)',
    paramKey: 'monthlyAmountMinor',
    defaultRupees: 5000,
    help: 'Spends less and puts the difference into cash savings.',
  },
  {
    type: 'increase_sip',
    label: 'Start or increase a monthly investment',
    amountLabel: 'Invest each month (₹)',
    paramKey: 'monthlyAmountMinor',
    defaultRupees: 5000,
    help: 'Spends less and invests the difference.',
  },
  {
    type: 'repay_debt',
    label: 'Pay off some borrowing',
    amountLabel: 'Repay (₹, one off)',
    paramKey: 'amountMinor',
    defaultRupees: 100000,
    help: 'Uses cash you hold to reduce what you owe.',
  },
  {
    type: 'increase_emergency_fund',
    label: 'Build up your emergency fund',
    amountLabel: 'Move into cash (₹)',
    paramKey: 'amountMinor',
    defaultRupees: 100000,
    help: 'Moves money from investments into cash you can reach quickly.',
  },
];

/** Rupees the family typed → minor units. A unit conversion, not a financial calculation. */
export const rupeesToMinor = (v: string) => Math.round((parseFloat(v) || 0) * 100);

export async function runSimulation(
  token: string,
  householdId: string,
  scenarios: ConsumerScenario[],
): Promise<SimulationResponse> {
  return apiPost<SimulationResponse>(
    `/households/${householdId}/simulation`,
    { scenarios },
    token,
  );
}

/** Plain-language names for the score's categories, so a family is not shown `debt_burden`. */
export const CATEGORY_LABEL: Record<string, string> = {
  net_worth: 'Net worth',
  debt_burden: 'Debt',
  savings: 'Savings',
  liquidity: 'Emergency fund',
  diversification: 'Spread of investments',
  protection: 'Protection',
  retirement: 'Retirement readiness',
};

/** Bands as the family should read them. Mirrors the dashboard's wording. */
export const BAND_LABEL: Record<string, string> = {
  at_risk: 'At risk',
  needs_attention: 'Needs attention',
  fair: 'Fair',
  good: 'Good',
  excellent: 'Excellent',
};
