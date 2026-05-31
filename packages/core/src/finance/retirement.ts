import { CurrencyCode, fromMinor, Money } from '../money/money.js';

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

export function computeRetirement(input: RetirementInput): RetirementResult {
  const yearsToRetire = Math.max(0, input.retirementAge - input.currentAge);

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

  const projectedFromCurrent = futureValue(
    input.currentCorpusMinor,
    input.preRetirementReturnPct,
    yearsToRetire,
  );

  const gap = Math.max(0, requiredCorpus - projectedFromCurrent);
  const sip = yearsToRetire > 0 ? sipForTarget(gap, input.preRetirementReturnPct, yearsToRetire) : gap;

  return {
    inflatedAnnualExpenses: fromMinor(inflatedAnnual, input.currency),
    requiredCorpus: fromMinor(requiredCorpus, input.currency),
    projectedCorpusFromCurrent: fromMinor(projectedFromCurrent, input.currency),
    corpusGap: fromMinor(gap, input.currency),
    monthlySipRequired: fromMinor(sip, input.currency),
    onTrack: gap <= 0,
    currency: input.currency,
  };
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
