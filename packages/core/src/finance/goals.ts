import { CurrencyCode, fromMinor, Money } from '../money/money.js';
import { netOfTaxReturnPct } from './tax.js';

export interface GoalInput {
  targetAmountMinor: number;
  currentAmountMinor: number;
  monthsRemaining: number;
  expectedAnnualReturnPct: number;
  currency: CurrencyCode;
  /**
   * Effective tax on investment gains (%). When set, projections use a post-tax
   * return so the required SIP isn't understated. Optional — omit for gross planning.
   */
  gainsTaxPct?: number;
  /**
   * Annual SIP step-up (%). When set, `monthlySipRequired` is the *first-year* monthly
   * contribution of a plan that steps up each year (e.g. with income/inflation).
   */
  annualStepUpPct?: number;
}

/**
 * First-year monthly SIP for a plan that steps up `annualStep` (fraction) each year and
 * reaches `target` by the horizon. Computed year-by-year (12 level months per year), so a
 * partial final year is rounded up to a whole year — a documented planning approximation.
 */
function steppedFirstYearSip(
  target: number,
  monthlyRate: number,
  months: number,
  annualStep: number,
): number {
  const years = Math.max(1, Math.ceil(months / 12));
  const r = monthlyRate;
  const yearAnnuityFactor = Math.abs(r) < 1e-9 ? 12 : (Math.pow(1 + r, 12) - 1) / r;
  let fvPerUnitFirstSip = 0;
  for (let k = 0; k < years; k++) {
    fvPerUnitFirstSip += Math.pow(1 + annualStep, k) * yearAnnuityFactor * Math.pow(1 + r, 12 * (years - 1 - k));
  }
  return fvPerUnitFirstSip > 0 ? target / fvPerUnitFirstSip : 0;
}

export interface GoalPlan {
  /** Future value the current savings will grow to by the target date. */
  projectedCurrentMinor: Money;
  /** Remaining gap after growth of current savings. */
  gap: Money;
  /** Monthly SIP needed to fund the gap. */
  monthlySipRequired: Money;
  /** Progress toward target today, in [0,1]. */
  progress: number;
  currency: CurrencyCode;
}

/** Average month length used to convert a target DATE into a planning horizon. */
const DAYS_PER_MONTH = 30.44;

/**
 * Whole months from `from` until `to`, floored at 1.
 *
 * Extracted in M5.11 because this line existed twice, character for character, in
 * `apps/api/src/goals/goals.module.ts` and `apps/api/src/common/financial-snapshot.service.ts`
 * — the retail goal list and the retail early-warning input, each with its own private copy of
 * how long a family has left. A third copy was about to be written for households. The floor at
 * 1 keeps an overdue or same-day goal fundable in principle rather than dividing by zero: it is
 * measured as needing its whole remaining gap this month, which is what being out of time means.
 */
export function monthsUntil(from: Date, to: Date): number {
  return Math.max(1, Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24 * DAYS_PER_MONTH)));
}

/**
 * How far behind its funding schedule a goal is, as a fraction of the target in [0, 1].
 *
 * The gap is what remains AFTER today's savings are grown to the target date, so this answers
 * "how much of this goal is currently unfunded", not "how much have you saved". A goal with no
 * target cannot be behind, and returns 0 rather than dividing by zero.
 *
 * This is the definition the Wealth Early Warning System bands (≥0.15 yellow, ≥0.30 red), and it
 * is deliberately the same number V1 has always fed it — M5.11 moved it here rather than
 * inventing a household-specific one, so the two generations cannot drift apart.
 */
export function goalSlippage(plan: GoalPlan, targetAmountMinor: number): number {
  if (targetAmountMinor <= 0) return 0;
  return Math.min(1, Math.max(0, plan.gap.minor / targetAmountMinor));
}

export interface DatedGoalInput extends Omit<GoalInput, 'monthsRemaining'> {
  targetDate: Date;
}

/**
 * Plan a goal from its target DATE rather than a month count, and report how far behind it is.
 *
 * The single entry point for "where does this goal stand right now", used by the retail list,
 * the retail early-warning input and the household intelligence layer. `now` is injected — this
 * package never reads a clock.
 */
export function planGoalAsOf(
  goal: DatedGoalInput,
  now: Date,
): { plan: GoalPlan; monthsRemaining: number; slippage: number } {
  const { targetDate, ...rest } = goal;
  const monthsRemaining = monthsUntil(now, targetDate);
  const plan = planGoal({ ...rest, monthsRemaining });
  return { plan, monthsRemaining, slippage: goalSlippage(plan, goal.targetAmountMinor) };
}

export function planGoal(input: GoalInput): GoalPlan {
  const months = Math.max(1, Math.round(input.monthsRemaining));
  const annualReturn =
    input.gainsTaxPct !== undefined
      ? netOfTaxReturnPct(input.expectedAnnualReturnPct, input.gainsTaxPct)
      : input.expectedAnnualReturnPct;
  const r = annualReturn / 100 / 12;

  const projectedCurrent = input.currentAmountMinor * Math.pow(1 + r, months);
  const gap = Math.max(0, input.targetAmountMinor - projectedCurrent);

  let sip: number;
  if (gap <= 0) sip = 0;
  else if (input.annualStepUpPct && input.annualStepUpPct > 0)
    sip = steppedFirstYearSip(gap, r, months, input.annualStepUpPct / 100);
  else if (Math.abs(r) < 1e-9) sip = gap / months;
  else sip = (gap * r) / (Math.pow(1 + r, months) - 1);

  return {
    projectedCurrentMinor: fromMinor(projectedCurrent, input.currency),
    gap: fromMinor(gap, input.currency),
    monthlySipRequired: fromMinor(sip, input.currency),
    progress:
      input.targetAmountMinor > 0
        ? Math.min(1, input.currentAmountMinor / input.targetAmountMinor)
        : 0,
    currency: input.currency,
  };
}
