import { CurrencyCode, fromMinor, Money, toMajor } from '../money/money.js';

export interface NetWorthAccount {
  balanceMinor: number;
  currency: CurrencyCode;
  isLiability: boolean;
}

export interface NetWorthResult {
  assets: Money;
  liabilities: Money;
  netWorth: Money;
  /** Net worth / assets, a simple solvency ratio in [0,1]. 0 when no assets. */
  solvencyRatio: number;
}

/**
 * Family Balance Sheet — aggregate net worth from a flat list of accounts.
 * All accounts are assumed pre-converted to `baseCurrency` (FX handled upstream).
 */
export function computeNetWorth(
  accounts: NetWorthAccount[],
  baseCurrency: CurrencyCode,
): NetWorthResult {
  let assetMinor = 0;
  let liabilityMinor = 0;
  for (const a of accounts) {
    if (a.isLiability) {
      liabilityMinor += Math.abs(a.balanceMinor);
    } else {
      assetMinor += a.balanceMinor;
    }
  }
  const netMinor = assetMinor - liabilityMinor;
  return {
    assets: fromMinor(assetMinor, baseCurrency),
    liabilities: fromMinor(liabilityMinor, baseCurrency),
    netWorth: fromMinor(netMinor, baseCurrency),
    solvencyRatio: assetMinor > 0 ? netMinor / assetMinor : 0,
  };
}

/** Financial Independence Ratio = passive-capable assets / annual expenses. */
export function financialIndependenceRatio(netWorth: Money, annualExpenses: Money): number {
  const expensesMajor = toMajor(annualExpenses);
  if (expensesMajor <= 0) return 0;
  return toMajor(netWorth) / expensesMajor;
}
