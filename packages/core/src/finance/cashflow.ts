import { CurrencyCode, fromMinor, Money } from '../money/money.js';

export interface CashflowEntry {
  type: 'income' | 'expense' | 'transfer';
  amountMinor: number;
  category: string;
}

export interface CashflowSummary {
  income: Money;
  expense: Money;
  net: Money;
  /** Savings rate = (income - expense) / income, in [−∞, 1]. 0 when no income. */
  savingsRate: number;
  byCategory: { category: string; amountMinor: number }[];
  currency: CurrencyCode;
}

/** Summarise a period's transactions into income/expense/net + category breakdown. */
export function summarizeCashflow(
  entries: CashflowEntry[],
  currency: CurrencyCode,
): CashflowSummary {
  let income = 0;
  let expense = 0;
  const catMap = new Map<string, number>();
  for (const e of entries) {
    if (e.type === 'income') income += e.amountMinor;
    else if (e.type === 'expense') {
      expense += e.amountMinor;
      catMap.set(e.category, (catMap.get(e.category) ?? 0) + e.amountMinor);
    }
  }
  const net = income - expense;
  return {
    income: fromMinor(income, currency),
    expense: fromMinor(expense, currency),
    net: fromMinor(net, currency),
    savingsRate: income > 0 ? net / income : 0,
    byCategory: [...catMap.entries()]
      .map(([category, amountMinor]) => ({ category, amountMinor }))
      .sort((a, b) => b.amountMinor - a.amountMinor),
    currency,
  };
}

export interface BudgetEnvelope {
  category: string;
  limitMinor: number;
  spentMinor: number;
}

export interface BudgetStatus extends BudgetEnvelope {
  remainingMinor: number;
  utilization: number;
  overBudget: boolean;
}

/** Envelope budgeting status with utilisation and over-budget flags. */
export function evaluateBudget(envelopes: BudgetEnvelope[]): BudgetStatus[] {
  return envelopes.map((e) => ({
    ...e,
    remainingMinor: e.limitMinor - e.spentMinor,
    utilization: e.limitMinor > 0 ? e.spentMinor / e.limitMinor : 0,
    overBudget: e.spentMinor > e.limitMinor,
  }));
}
