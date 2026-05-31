import { CurrencyCode, fromMinor, Money } from '../money/money.js';

export type DebtStrategy = 'snowball' | 'avalanche';

export interface DebtInput {
  id: string;
  name: string;
  principalMinor: number;
  annualInterestRatePct: number;
  minimumPaymentMinor: number;
}

export interface DebtPayoffResult {
  strategy: DebtStrategy;
  months: number;
  totalInterestMinor: number;
  /** Order in which debts are cleared. */
  payoffOrder: { id: string; name: string; clearedInMonth: number }[];
  currency: CurrencyCode;
}

const MAX_MONTHS = 1200; // 100-year safety cap to prevent infinite loops.

/**
 * Simulate month-by-month debt payoff. Snowball orders by smallest balance first
 * (behavioural wins); avalanche orders by highest interest rate first (math-optimal).
 * `extraMonthlyMinor` is the budget available on top of all minimum payments.
 */
export function simulateDebtPayoff(
  debts: DebtInput[],
  extraMonthlyMinor: number,
  strategy: DebtStrategy,
  currency: CurrencyCode,
): DebtPayoffResult {
  const balances = debts.map((d) => ({ ...d, balance: d.principalMinor }));
  const payoffOrder: DebtPayoffResult['payoffOrder'] = [];
  let totalInterest = 0;
  let month = 0;

  const order = () =>
    balances
      .filter((d) => d.balance > 0)
      .sort((a, b) =>
        strategy === 'snowball'
          ? a.balance - b.balance
          : b.annualInterestRatePct - a.annualInterestRatePct,
      );

  while (balances.some((d) => d.balance > 0) && month < MAX_MONTHS) {
    month += 1;

    // 1. Accrue interest.
    for (const d of balances) {
      if (d.balance <= 0) continue;
      const monthlyInterest = Math.round((d.balance * d.annualInterestRatePct) / 100 / 12);
      d.balance += monthlyInterest;
      totalInterest += monthlyInterest;
    }

    // 2. Pay minimums on every active debt.
    let pool = extraMonthlyMinor;
    for (const d of balances) {
      if (d.balance <= 0) continue;
      const pay = Math.min(d.minimumPaymentMinor, d.balance);
      d.balance -= pay;
    }

    // 3. Throw the extra pool at the target debt(s) in strategy order.
    for (const d of order()) {
      if (pool <= 0) break;
      const pay = Math.min(pool, d.balance);
      d.balance -= pay;
      pool -= pay;
    }

    // 4. Record any debts cleared this month.
    for (const d of balances) {
      if (d.balance <= 0 && !payoffOrder.find((p) => p.id === d.id)) {
        payoffOrder.push({ id: d.id, name: d.name, clearedInMonth: month });
      }
    }
  }

  return {
    strategy,
    months: month,
    totalInterestMinor: totalInterest,
    payoffOrder,
    currency,
  };
}

/** Convenience: compare both strategies and report interest saved by avalanche. */
export function compareDebtStrategies(
  debts: DebtInput[],
  extraMonthlyMinor: number,
  currency: CurrencyCode,
): { snowball: DebtPayoffResult; avalanche: DebtPayoffResult; interestSaved: Money } {
  const snowball = simulateDebtPayoff(debts, extraMonthlyMinor, 'snowball', currency);
  const avalanche = simulateDebtPayoff(debts, extraMonthlyMinor, 'avalanche', currency);
  return {
    snowball,
    avalanche,
    interestSaved: fromMinor(
      Math.max(0, snowball.totalInterestMinor - avalanche.totalInterestMinor),
      currency,
    ),
  };
}
