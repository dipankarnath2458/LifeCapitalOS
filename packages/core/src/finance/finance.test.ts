import { describe, expect, it } from 'vitest';
import { computeNetWorth, financialIndependenceRatio } from './networth.js';
import { compareDebtStrategies, simulateDebtPayoff } from './debt.js';
import { computeRetirement, financialFreedomNumber } from './retirement.js';
import { analyzeAllocation, recommendedAllocation } from './assetAllocation.js';
import { evaluateBudget, summarizeCashflow } from './cashflow.js';
import { planGoal } from './goals.js';
import { analyzeLifeInsuranceGap, emergencyFundTarget } from './insurance.js';
import { fromMinor, money, toMajor } from '../money/money.js';

describe('net worth', () => {
  it('sums assets and liabilities', () => {
    const r = computeNetWorth(
      [
        { balanceMinor: 1_000_00, currency: 'INR', isLiability: false },
        { balanceMinor: 500_00, currency: 'INR', isLiability: false },
        { balanceMinor: 300_00, currency: 'INR', isLiability: true },
      ],
      'INR',
    );
    expect(r.assets.minor).toBe(1_500_00);
    expect(r.liabilities.minor).toBe(300_00);
    expect(r.netWorth.minor).toBe(1_200_00);
    expect(r.solvencyRatio).toBeCloseTo(0.8, 5);
  });

  it('FI ratio guards against zero expenses', () => {
    expect(financialIndependenceRatio(money(100, 'INR'), money(0, 'INR'))).toBe(0);
    expect(financialIndependenceRatio(money(100, 'INR'), money(25, 'INR'))).toBe(4);
  });
});

describe('debt payoff', () => {
  const debts = [
    { id: 'a', name: 'Card', principalMinor: 50_000_00, annualInterestRatePct: 36, minimumPaymentMinor: 2_000_00 },
    { id: 'b', name: 'Car', principalMinor: 300_000_00, annualInterestRatePct: 11, minimumPaymentMinor: 8_000_00 },
  ];

  it('clears all debt in finite months', () => {
    const r = simulateDebtPayoff(debts, 10_000_00, 'avalanche', 'INR');
    expect(r.months).toBeGreaterThan(0);
    expect(r.months).toBeLessThan(1200);
    expect(r.payoffOrder).toHaveLength(2);
    expect(r.converged).toBe(true);
  });

  it('flags non-convergence when the budget cannot cover interest', () => {
    // A 36% card with no minimum and no extra budget can never be paid down.
    const stuck = [
      { id: 'a', name: 'Card', principalMinor: 50_000_00, annualInterestRatePct: 36, minimumPaymentMinor: 0 },
    ];
    const r = simulateDebtPayoff(stuck, 0, 'avalanche', 'INR');
    expect(r.converged).toBe(false);
    expect(r.months).toBe(1200);
    expect(r.payoffOrder).toHaveLength(0);
  });

  it('avalanche targets the highest rate first', () => {
    const r = simulateDebtPayoff(debts, 10_000_00, 'avalanche', 'INR');
    expect(r.payoffOrder[0]?.id).toBe('a'); // 36% card cleared before 11% car
  });

  it('avalanche never costs more interest than snowball', () => {
    const { interestSaved } = compareDebtStrategies(debts, 10_000_00, 'INR');
    expect(interestSaved.minor).toBeGreaterThanOrEqual(0);
  });
});

describe('retirement', () => {
  it('produces a positive SIP when there is a gap', () => {
    const r = computeRetirement({
      currentAge: 30,
      retirementAge: 60,
      yearsInRetirement: 25,
      currentAnnualExpensesMinor: 12_00_000_00,
      currentCorpusMinor: 50_00_000_00,
      inflationRatePct: 6,
      preRetirementReturnPct: 11,
      postRetirementReturnPct: 7,
      currency: 'INR',
    });
    expect(r.requiredCorpus.minor).toBeGreaterThan(0);
    expect(r.monthlySipRequired.minor).toBeGreaterThan(0);
  });

  it('financial freedom number uses safe withdrawal rate', () => {
    const ff = financialFreedomNumber(10_00_000_00, 4, 'INR');
    expect(toMajor(ff)).toBeCloseTo(2_50_00_000, 0);
  });
});

describe('asset allocation', () => {
  it('recommended allocations sum to ~100%', () => {
    const a = recommendedAllocation('moderate');
    const total = Object.values(a).reduce((s, v) => s + v, 0);
    expect(total).toBeGreaterThan(99);
    expect(total).toBeLessThan(101);
  });

  it('flags overweight real estate', () => {
    const r = analyzeAllocation(
      { equity: 10, debt: 10, real_estate: 80 },
      'moderate',
    );
    expect(r.suggestions.join(' ')).toMatch(/Real Estate/i);
  });
});

describe('cashflow & budget', () => {
  it('computes savings rate', () => {
    const s = summarizeCashflow(
      [
        { type: 'income', amountMinor: 100_000_00, category: 'salary' },
        { type: 'expense', amountMinor: 60_000_00, category: 'rent' },
      ],
      'INR',
    );
    expect(s.savingsRate).toBeCloseTo(0.4, 5);
    expect(s.byCategory[0]?.category).toBe('rent');
  });

  it('excludes transfers and adjustments from income/expense', () => {
    const s = summarizeCashflow(
      [
        { type: 'income', amountMinor: 100_000_00, category: 'salary' },
        { type: 'expense', amountMinor: 40_000_00, category: 'rent' },
        { type: 'transfer', amountMinor: 25_000_00, category: 'savings' },
        { type: 'adjustment', amountMinor: 5_000_00, category: 'correction' },
      ],
      'INR',
    );
    expect(s.income.minor).toBe(100_000_00);
    expect(s.expense.minor).toBe(40_000_00);
    expect(s.net.minor).toBe(60_000_00);
    expect(s.byCategory.map((c) => c.category)).toEqual(['rent']);
  });

  it('flags over-budget envelopes', () => {
    const [b] = evaluateBudget([{ category: 'food', limitMinor: 10_000_00, spentMinor: 12_000_00 }]);
    expect(b?.overBudget).toBe(true);
  });
});

describe('goals', () => {
  it('requires zero SIP when already funded', () => {
    const p = planGoal({
      targetAmountMinor: 100_00,
      currentAmountMinor: 100_00,
      monthsRemaining: 12,
      expectedAnnualReturnPct: 10,
      currency: 'INR',
    });
    expect(p.monthlySipRequired.minor).toBe(0);
    expect(p.progress).toBe(1);
  });
});

describe('insurance & emergency fund', () => {
  it('computes a life cover shortfall', () => {
    const r = analyzeLifeInsuranceGap({
      annualIncomeMinor: 20_00_000_00,
      outstandingLiabilitiesMinor: 50_00_000_00,
      existingCoverMinor: 50_00_000_00,
      dependents: 2,
      currency: 'INR',
    });
    expect(r.shortfallMinor.minor).toBeGreaterThan(0);
    expect(r.adequate).toBe(false);
  });

  it('computes months of expenses covered', () => {
    const e = emergencyFundTarget(50_000_00, 6, 1_50_000_00, 'INR');
    expect(e.monthsCovered).toBeCloseTo(3, 5);
    expect(e.shortfallMinor.minor).toBe(fromMinor(1_50_000_00, 'INR').minor);
  });
});
