import { CurrencyCode, fromMinor, Money } from '../money/money.js';
import { netOfTaxReturnPct } from './tax.js';

export interface RetirementInput {
  currentAge: number;
  retirementAge: number;
  /** Years you expect to live in retirement. */
  yearsInRetirement: number;
  currentAnnualExpensesMinor: number;
  currentCorpusMinor: number;
  inflationRatePct: number;
  preRetirementReturnPct: number;
  postRetirementReturnPct: number;
  currency: CurrencyCode;
  /**
   * Effective tax on accumulation-phase gains (%). When set, the pre-retirement return
   * is applied net of tax so corpus growth and the required SIP are realistic. Optional —
   * omit for gross planning (preserves prior behaviour).
   */
  effectiveGainsTaxPct?: number;
  /**
   * What the family actually puts aside each month, in minor units (M5.10).
   *
   * Optional, and omitting it is **not** the same as zero. A caller that omits it gets
   * exactly the pre-M5.10 result: `projectedCorpusFromContributions` is nil and
   * `projectedCorpusAtRetirement` equals `projectedCorpusFromCurrent`. A caller that passes
   * `0` is stating a fact — "we are saving nothing for retirement" — and gets the same
   * arithmetic but means something different by it. The distinction is preserved by the
   * caller, not here; see `docs/M5_10_RETIREMENT_PLANNING_ARCHITECTURE.md` §9.
   */
  monthlyContributionMinor?: number;
}

export interface RetirementResult {
  /** Annual expenses at retirement, inflation-adjusted. */
  inflatedAnnualExpenses: Money;
  /** Corpus needed at retirement to fund post-retirement years. */
  requiredCorpus: Money;
  /** Future value of the current corpus at retirement. */
  projectedCorpusFromCurrent: Money;
  /** Shortfall = required - projected (floored at 0). */
  corpusGap: Money;
  /** Monthly SIP required to close the gap by retirement. */
  monthlySipRequired: Money;
  onTrack: boolean;
  currency: CurrencyCode;

  // --- M5.10, additive. Every field above keeps its pre-M5.10 definition exactly. ---

  /** Future value at retirement of the stated monthly contribution. Nil when none was stated. */
  projectedCorpusFromContributions: Money;
  /**
   * What the family actually lands on: `projectedCorpusFromCurrent + fromContributions`.
   *
   * This is the figure the pre-M5.10 engine could not produce. `corpusGap` and
   * `monthlySipRequired` answer *"what would I need to save?"*; this answers *"given what I
   * am saving, where do I end up?"* — which is what "am I on track" actually asks.
   */
  projectedCorpusAtRetirement: Money;
  /** Signed: positive is a surplus, negative a shortfall. Not floored — the sign is the answer. */
  surplusOrShortfall: Money;
}

/** Where a family stands against their own plan. Ordered worst-last for display. */
export type RetirementStatus = 'on_track' | 'watch' | 'at_risk';

/** A shortfall inside this share of the required corpus is "watch" rather than "at risk". */
const WATCH_BAND = 0.1;

/**
 * Rounding tolerance, as a share of the required corpus (0.00001%).
 *
 * The projection rounds to minor units at several steps, so contributing *exactly* the SIP this
 * engine recommends lands a rupee or two short of the target that SIP was calculated to hit.
 * Without this, a family doing precisely what the product told them would be reported as
 * "watch" — an artefact of arithmetic, not a finding about their plan. Relative rather than a
 * fixed number of paise so it stays negligible at every plan size.
 */
const ON_TRACK_TOLERANCE = 1e-7;

/**
 * Status from a projection. Deterministic and threshold-based — no tuning per household.
 *
 * Exported so the intelligence layer and the planning service share ONE definition; a status
 * computed in two places is a figure with two meanings waiting to happen.
 */
export function retirementStatus(
  surplusOrShortfallMinor: number,
  requiredCorpusMinor: number,
): RetirementStatus {
  if (surplusOrShortfallMinor >= 0) return 'on_track';
  if (requiredCorpusMinor <= 0) return 'at_risk';
  const shortfall = Math.abs(surplusOrShortfallMinor);
  if (shortfall <= requiredCorpusMinor * ON_TRACK_TOLERANCE) return 'on_track';
  return shortfall <= requiredCorpusMinor * WATCH_BAND ? 'watch' : 'at_risk';
}

/** Future value of a present sum: pv * (1+r)^n. */
function futureValue(pv: number, ratePct: number, years: number): number {
  return pv * Math.pow(1 + ratePct / 100, years);
}

/**
 * Real-rate annuity present value: corpus needed to draw `annual` (growing with
 * inflation) for `years`, earning post-retirement returns. Uses the real return.
 */
function corpusForDrawdown(
  annual: number,
  years: number,
  returnPct: number,
  inflationPct: number,
): number {
  const real = (1 + returnPct / 100) / (1 + inflationPct / 100) - 1;
  if (Math.abs(real) < 1e-9) return annual * years;
  return annual * ((1 - Math.pow(1 + real, -years)) / real) * (1 + real);
}

/** Monthly contribution needed to reach FV given a monthly compounding return. */
function sipForTarget(target: number, annualReturnPct: number, years: number): number {
  const months = Math.max(1, Math.round(years * 12));
  const r = annualReturnPct / 100 / 12;
  if (Math.abs(r) < 1e-9) return target / months;
  return (target * r) / (Math.pow(1 + r, months) - 1);
}

/**
 * Future value of a monthly contribution — the exact inverse of `sipForTarget`.
 *
 * Written as the inverse on purpose: contributing the required SIP must project to the gap it
 * was calculated to close. A test asserts that round trip, so the two cannot drift apart.
 */
function futureValueOfSip(monthly: number, annualReturnPct: number, years: number): number {
  if (monthly <= 0 || years <= 0) return 0;
  const months = Math.max(1, Math.round(years * 12));
  const r = annualReturnPct / 100 / 12;
  if (Math.abs(r) < 1e-9) return monthly * months;
  return (monthly * (Math.pow(1 + r, months) - 1)) / r;
}

export function computeRetirement(input: RetirementInput): RetirementResult {
  const yearsToRetire = Math.max(0, input.retirementAge - input.currentAge);

  // Accumulation-phase return, optionally net of tax on gains.
  const preReturnPct =
    input.effectiveGainsTaxPct !== undefined
      ? netOfTaxReturnPct(input.preRetirementReturnPct, input.effectiveGainsTaxPct)
      : input.preRetirementReturnPct;

  const inflatedAnnual = futureValue(
    input.currentAnnualExpensesMinor,
    input.inflationRatePct,
    yearsToRetire,
  );

  const requiredCorpus = corpusForDrawdown(
    inflatedAnnual,
    input.yearsInRetirement,
    input.postRetirementReturnPct,
    input.inflationRatePct,
  );

  const projectedFromCurrent = futureValue(input.currentCorpusMinor, preReturnPct, yearsToRetire);

  const gap = Math.max(0, requiredCorpus - projectedFromCurrent);
  const sip = yearsToRetire > 0 ? sipForTarget(gap, preReturnPct, yearsToRetire) : gap;

  // M5.10. Contributions compound at the same net-of-tax accumulation rate as the corpus.
  const fromContributions = futureValueOfSip(
    Math.max(0, input.monthlyContributionMinor ?? 0),
    preReturnPct,
    yearsToRetire,
  );
  const projectedTotal = projectedFromCurrent + fromContributions;

  return {
    inflatedAnnualExpenses: fromMinor(inflatedAnnual, input.currency),
    requiredCorpus: fromMinor(requiredCorpus, input.currency),
    projectedCorpusFromCurrent: fromMinor(projectedFromCurrent, input.currency),
    corpusGap: fromMinor(gap, input.currency),
    monthlySipRequired: fromMinor(sip, input.currency),
    onTrack: gap <= 0,
    currency: input.currency,
    projectedCorpusFromContributions: fromMinor(fromContributions, input.currency),
    projectedCorpusAtRetirement: fromMinor(projectedTotal, input.currency),
    surplusOrShortfall: fromMinor(projectedTotal - requiredCorpus, input.currency),
  };
}

// ---------------------------------------------------------------------------
// What-if (M5.10)
// ---------------------------------------------------------------------------

/**
 * Retirement what-if scenarios.
 *
 * **This is not a second simulation engine, and must not become one.** Each scenario is a
 * change to a *planning assumption*, so answering it is one more call to `computeRetirement`
 * with a different argument — the defining use of a pure function.
 *
 * `simulateFinancialWhatIf` remains the engine for *position*-shaped scenarios: it mutates a
 * snapshot and re-scores Wealth Health, which is a different question over a different horizon.
 * The boundary is in §13 of the M5.10 architecture note.
 *
 * Return and inflation are deliberately absent. They are the assumptions the projection can
 * least justify, and offering "what if I earn 15%?" invites a family to plan on it.
 */
export type RetirementScenarioType =
  | 'retire_earlier'
  | 'retire_later'
  | 'increase_contribution'
  | 'increase_corpus'
  | 'change_income_target';

export interface RetirementScenario {
  type: RetirementScenarioType;
  /** `years` for age shifts; `amountMinor` for the rest. */
  params: { years?: number; amountMinor?: number };
  label?: string;
}

export interface RetirementScenarioOutcome {
  scenario: RetirementScenario;
  result: RetirementResult;
  status: RetirementStatus;
  /** Change in surplus versus the base projection. Positive means better off. */
  deltaSurplusMinor: number;
}

/** The scenario vocabulary and the parameter each one expects (for discoverability). */
export const RETIREMENT_SCENARIO_PARAMS: Record<RetirementScenarioType, string[]> = {
  retire_earlier: ['years'],
  retire_later: ['years'],
  increase_contribution: ['amountMinor'],
  increase_corpus: ['amountMinor'],
  change_income_target: ['amountMinor'],
};

/** Applies one scenario to the base input. Pure; never mutates the argument. */
function withScenario(base: RetirementInput, s: RetirementScenario): RetirementInput {
  const years = Math.max(0, Math.round(s.params.years ?? 0));
  const amount = Math.max(0, Math.round(s.params.amountMinor ?? 0));
  switch (s.type) {
    // Shifting the retirement age holds LIFE EXPECTANCY constant, not the drawdown length:
    // `retirementAge + yearsInRetirement` is the age you are planning to live to, and choosing
    // to work longer does not extend it. Moving the age alone would inflate the target without
    // shortening the years it has to fund — which reports retiring later as more expensive
    // than it is, and retiring early as cheaper.
    case 'retire_earlier': {
      // Never below the current age: retiring before today is not a plan.
      const age = Math.max(base.currentAge, base.retirementAge - years);
      const moved = base.retirementAge - age;
      return { ...base, retirementAge: age, yearsInRetirement: base.yearsInRetirement + moved };
    }
    case 'retire_later':
      return {
        ...base,
        retirementAge: base.retirementAge + years,
        // At least one year: a plan that funds no retirement at all is not an outcome.
        yearsInRetirement: Math.max(1, base.yearsInRetirement - years),
      };
    case 'increase_contribution':
      return { ...base, monthlyContributionMinor: (base.monthlyContributionMinor ?? 0) + amount };
    case 'increase_corpus':
      return { ...base, currentCorpusMinor: base.currentCorpusMinor + amount };
    case 'change_income_target':
      return { ...base, currentAnnualExpensesMinor: amount };
  }
}

/**
 * Runs each scenario against the same base and reports the change in outcome.
 *
 * Deterministic and order-independent: every scenario is applied to the untouched base, so
 * results never compound and the list can be rendered in any order.
 */
export function projectRetirementScenarios(
  base: RetirementInput,
  scenarios: RetirementScenario[],
): RetirementScenarioOutcome[] {
  const baseResult = computeRetirement(base);
  return scenarios.map((scenario) => {
    const result = computeRetirement(withScenario(base, scenario));
    return {
      scenario,
      result,
      status: retirementStatus(result.surplusOrShortfall.minor, result.requiredCorpus.minor),
      deltaSurplusMinor: result.surplusOrShortfall.minor - baseResult.surplusOrShortfall.minor,
    };
  });
}

/** Financial Freedom: years until passive income (corpus * SWR) covers expenses. */
export function financialFreedomNumber(
  annualExpensesMinor: number,
  safeWithdrawalRatePct: number,
  currency: CurrencyCode,
): Money {
  const swr = safeWithdrawalRatePct / 100;
  if (swr <= 0) return fromMinor(0, currency);
  return fromMinor(annualExpensesMinor / swr, currency);
}
