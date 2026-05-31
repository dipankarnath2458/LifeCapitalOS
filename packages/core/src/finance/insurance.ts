import { CurrencyCode, fromMinor, Money } from '../money/money.js';

export interface LifeCoverInput {
  annualIncomeMinor: number;
  /** Outstanding liabilities (loans) to be cleared on death. */
  outstandingLiabilitiesMinor: number;
  existingCoverMinor: number;
  dependents: number;
  /** Income-replacement multiple; defaults to a 10–15x rule blended with HLV. */
  incomeMultiple?: number;
  currency: CurrencyCode;
}

export interface InsuranceGapResult {
  recommendedCoverMinor: Money;
  existingCoverMinor: Money;
  shortfallMinor: Money;
  adequate: boolean;
  currency: CurrencyCode;
}

/**
 * Term-life gap using a simplified Human Life Value: income * multiple +
 * liabilities, less existing cover. Dependents nudge the multiple upward.
 */
export function analyzeLifeInsuranceGap(input: LifeCoverInput): InsuranceGapResult {
  const multiple = input.incomeMultiple ?? (input.dependents > 0 ? 15 : 10);
  const recommended = input.annualIncomeMinor * multiple + input.outstandingLiabilitiesMinor;
  const shortfall = Math.max(0, recommended - input.existingCoverMinor);
  return {
    recommendedCoverMinor: fromMinor(recommended, input.currency),
    existingCoverMinor: fromMinor(input.existingCoverMinor, input.currency),
    shortfallMinor: fromMinor(shortfall, input.currency),
    adequate: shortfall <= 0,
    currency: input.currency,
  };
}

/** Emergency fund target = months of expenses (default 6). */
export function emergencyFundTarget(
  monthlyExpensesMinor: number,
  months: number,
  currentEmergencyFundMinor: number,
  currency: CurrencyCode,
): { targetMinor: Money; shortfallMinor: Money; monthsCovered: number } {
  const target = monthlyExpensesMinor * months;
  return {
    targetMinor: fromMinor(target, currency),
    shortfallMinor: fromMinor(Math.max(0, target - currentEmergencyFundMinor), currency),
    monthsCovered:
      monthlyExpensesMinor > 0 ? currentEmergencyFundMinor / monthlyExpensesMinor : 0,
  };
}

export type { Money, CurrencyCode };
