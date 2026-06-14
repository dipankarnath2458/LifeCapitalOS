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
