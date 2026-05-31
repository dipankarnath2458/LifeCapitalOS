import { CurrencyCode, fromMinor, Money } from '../money/money.js';

export interface GoalInput {
  targetAmountMinor: number;
  currentAmountMinor: number;
  monthsRemaining: number;
  expectedAnnualReturnPct: number;
  currency: CurrencyCode;
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
  const r = input.expectedAnnualReturnPct / 100 / 12;

  const projectedCurrent = input.currentAmountMinor * Math.pow(1 + r, months);
  const gap = Math.max(0, input.targetAmountMinor - projectedCurrent);

  let sip: number;
  if (gap <= 0) sip = 0;
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
