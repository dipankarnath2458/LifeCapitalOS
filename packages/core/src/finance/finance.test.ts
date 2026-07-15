import { describe, expect, it } from 'vitest';
import { computeNetWorth, financialIndependenceRatio } from './networth.js';
import { compareDebtStrategies, simulateDebtPayoff, summarizeDebt } from './debt.js';
import { computeRetirement, financialFreedomNumber } from './retirement.js';
import { analyzeAllocation, recommendedAllocation } from './assetAllocation.js';
import { evaluateBudget, summarizeCashflow } from './cashflow.js';
import { canonicalStringify, upgradePayload } from './financialSnapshot.js';
import {
  bandOf,
  computeFinancialHealthScore,
  interpolate,
  DEFAULT_FINANCIAL_HEALTH_MODEL,
} from './financialHealth.js';
import { explainFinancialHealth } from './financialHealthExplanation.js';
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

  it('summarises outstanding, monthly obligation and weighted rate by type', () => {
    const s = summarizeDebt(
      [
        { type: 'home_loan', outstandingMinor: 300_000_00, monthlyPaymentMinor: 25_000_00, annualInterestRatePct: 8 },
        { type: 'credit_card', outstandingMinor: 100_000_00, monthlyPaymentMinor: 5_000_00, annualInterestRatePct: 36 },
      ],
      'INR',
    );
    expect(s.totalOutstandingMinor).toBe(400_000_00);
    expect(s.totalMonthlyPaymentMinor).toBe(30_000_00);
    // Outstanding-weighted: (300k*8 + 100k*36) / 400k = 15.
    expect(s.weightedAvgRatePct).toBeCloseTo(15, 5);
    expect(s.byType[0]?.type).toBe('home_loan');
    expect(s.debtCount).toBe(2);
  });

  it('reports a zero weighted rate when nothing is outstanding', () => {
    const s = summarizeDebt([], 'INR');
    expect(s.totalOutstandingMinor).toBe(0);
    expect(s.weightedAvgRatePct).toBe(0);
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

describe('financial snapshot contract', () => {
  it('canonicalises key order so equal payloads hash identically', () => {
    const a = { b: 1, a: { y: 2, x: [3, { n: 4, m: 5 }] } };
    const b = { a: { x: [3, { m: 5, n: 4 }], y: 2 }, b: 1 };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it('preserves array order (order is meaningful)', () => {
    expect(canonicalStringify([1, 2, 3])).not.toBe(canonicalStringify([3, 2, 1]));
  });

  it('up-converts as identity within the same schema version', () => {
    const payload = { netWorth: { netWorthMinor: 100 } } as never;
    expect(upgradePayload(payload, 1, 1)).toBe(payload);
  });
});

describe('financial health score', () => {
  // A healthy household: positive net worth, low debt, good savings, cash buffer, diversified.
  const strong = {
    netWorth: { assetsMinor: 100_000_00, liabilitiesMinor: 20_000_00, netWorthMinor: 80_000_00, solvencyRatio: 0.8 },
    assets: [
      { accountId: 'a', name: 'Cash', assetClass: 'cash', entityId: null, nativeCurrency: 'INR', nativeBalanceMinor: 30_000_00, baseBalanceMinor: 30_000_00 },
      { accountId: 'b', name: 'Equity', assetClass: 'equity', entityId: null, nativeCurrency: 'INR', nativeBalanceMinor: 35_000_00, baseBalanceMinor: 35_000_00 },
      { accountId: 'c', name: 'Debt fund', assetClass: 'debt', entityId: null, nativeCurrency: 'INR', nativeBalanceMinor: 35_000_00, baseBalanceMinor: 35_000_00 },
    ],
    liabilities: [],
    debt: { totalOutstandingMinor: 10_000_00, totalMonthlyPaymentMinor: 500_00, weightedAvgRatePct: 8, debtCount: 1, byType: [] },
    cashflowSummary: { period: '2026-03', incomeMinor: 10_000_00, expenseMinor: 5_000_00, netMinor: 5_000_00, savingsRate: 0.5, byCategory: [] },
    budgetSummary: { period: '2026-03', exists: false, totalBudgetMinor: null, totalSpentMinor: 0, overTotal: false },
    assetAllocation: [
      { assetClass: 'cash', baseValueMinor: 30_000_00, pct: 30 },
      { assetClass: 'equity', baseValueMinor: 35_000_00, pct: 35 },
      { assetClass: 'debt', baseValueMinor: 35_000_00, pct: 35 },
    ],
    currencyExposure: [{ currency: 'INR', baseValueMinor: 100_000_00, pct: 100 }],
    householdEquity: { netWorthMinor: 80_000_00, totalDebtMinor: 10_000_00, reconciledEquityMinor: 70_000_00 },
    entityHoldings: [],
    relationships: { memberCount: 2, entityCount: 1, entityIds: [], accountIds: ['a', 'b', 'c'] },
  };

  it('interpolates piecewise-linearly and clamps at the ends', () => {
    const anchors = [{ x: 0, score: 0 }, { x: 10, score: 100 }];
    expect(interpolate(anchors, 5)).toBe(50);
    expect(interpolate(anchors, -1)).toBe(0);
    expect(interpolate(anchors, 99)).toBe(100);
  });

  it('bands map score ranges correctly', () => {
    expect(bandOf(30)).toBe('at_risk');
    expect(bandOf(50)).toBe('needs_attention');
    expect(bandOf(70)).toBe('fair');
    expect(bandOf(80)).toBe('good');
    expect(bandOf(95)).toBe('excellent');
  });

  it('scores a strong household highly and is fully explainable', () => {
    const r = computeFinancialHealthScore(strong);
    expect(r.overall).toBeGreaterThanOrEqual(75);
    expect(r.band === 'good' || r.band === 'excellent').toBe(true);
    expect(r.modelVersion).toBe('fhs-1.0.0');
    // Every category carries a metric, a reason and a suggestion (traceability).
    expect(r.categories).toHaveLength(5);
    for (const c of r.categories) {
      expect(c.reason.length).toBeGreaterThan(0);
      expect(c.suggestion.length).toBeGreaterThan(0);
      expect(typeof c.metric.value).toBe('number');
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(100);
    }
  });

  it('is deterministic (same payload → identical score)', () => {
    expect(computeFinancialHealthScore(strong)).toEqual(computeFinancialHealthScore(strong));
  });

  it('savings sub-score is monotonic (more savings never lowers it)', () => {
    const low = computeFinancialHealthScore({ ...strong, cashflowSummary: { ...strong.cashflowSummary, savingsRate: 0.05 } });
    const high = computeFinancialHealthScore({ ...strong, cashflowSummary: { ...strong.cashflowSummary, savingsRate: 0.3 } });
    const s = (r: ReturnType<typeof computeFinancialHealthScore>) => r.categories.find((c) => c.key === 'savings')!.score;
    expect(s(high)).toBeGreaterThanOrEqual(s(low));
  });

  it('penalises negative net worth and high leverage', () => {
    const weak = computeFinancialHealthScore({
      ...strong,
      netWorth: { assetsMinor: 10_000_00, liabilitiesMinor: 30_000_00, netWorthMinor: -20_000_00, solvencyRatio: 0.33 },
      debt: { totalOutstandingMinor: 9_000_00, totalMonthlyPaymentMinor: 6_000_00, weightedAvgRatePct: 30, debtCount: 2, byType: [] },
    });
    expect(weak.categories.find((c) => c.key === 'net_worth')!.score).toBe(0);
    expect(weak.overall).toBeLessThan(computeFinancialHealthScore(strong).overall);
  });

  it('handles zero income without throwing (drops DTI, uses debt-to-assets)', () => {
    const r = computeFinancialHealthScore({
      ...strong,
      cashflowSummary: { ...strong.cashflowSummary, incomeMinor: 0, expenseMinor: 0, netMinor: 0, savingsRate: 0 },
    });
    expect(r.categories.find((c) => c.key === 'debt_burden')!.metric.name).toBe('debtToAssets');
    expect(Number.isFinite(r.overall)).toBe(true);
  });

  it('default model weights sum to 100', () => {
    expect(DEFAULT_FINANCIAL_HEALTH_MODEL.categories.reduce((s, c) => s + c.weight, 0)).toBe(100);
  });

  describe('explanation engine (M3-2)', () => {
    // A mixed household: great savings, but thin liquidity and concentration.
    const mixed = {
      ...strong,
      assets: [
        { accountId: 'a', name: 'Cash', assetClass: 'cash', entityId: null, nativeCurrency: 'INR', nativeBalanceMinor: 5_000_00, baseBalanceMinor: 5_000_00 },
        { accountId: 'b', name: 'Equity', assetClass: 'equity', entityId: null, nativeCurrency: 'INR', nativeBalanceMinor: 95_000_00, baseBalanceMinor: 95_000_00 },
      ],
      assetAllocation: [
        { assetClass: 'cash', baseValueMinor: 5_000_00, pct: 5 },
        { assetClass: 'equity', baseValueMinor: 95_000_00, pct: 95 },
      ],
      cashflowSummary: { period: '2026-03', incomeMinor: 10_000_00, expenseMinor: 5_000_00, netMinor: 5_000_00, savingsRate: 0.5, byCategory: [] },
    };
    const scoreOf = (p: typeof strong) => computeFinancialHealthScore(p);

    it('is deterministic (same score → identical explanation)', () => {
      const s = scoreOf(mixed);
      expect(explainFinancialHealth(s, mixed)).toEqual(explainFinancialHealth(s, mixed));
    });

    it('partitions strengths and weaknesses at the 75 threshold', () => {
      const e = explainFinancialHealth(scoreOf(mixed), mixed);
      for (const w of e.weaknesses) expect(w.score).toBeLessThan(75);
      for (const st of e.strengths) expect(st.score).toBeGreaterThanOrEqual(75);
    });

    it('contributed + lost points reconcile to the category weight per 100', () => {
      const e = explainFinancialHealth(scoreOf(mixed), mixed);
      const totalWeight = e.categoryBreakdown.reduce((s, c) => s + c.weight, 0);
      for (const c of e.categoryBreakdown) {
        expect(c.pointsContributed + c.pointsLost).toBeCloseTo((c.weight * 100) / totalWeight, 1);
      }
    });

    it('ranks recommendations by estimated improvement (highest first)', () => {
      const e = explainFinancialHealth(scoreOf(mixed), mixed);
      expect(e.recommendations.length).toBeGreaterThan(0);
      for (let i = 1; i < e.recommendations.length; i++) {
        expect(e.recommendations[i - 1]!.estimatedScoreImprovement).toBeGreaterThanOrEqual(
          e.recommendations[i]!.estimatedScoreImprovement,
        );
      }
      expect(e.recommendations[0]!.priorityRank).toBe(1);
      expect(e.priorityRanking[0]!.rank).toBe(1);
    });

    it('every recommendation carries the full required shape', () => {
      const e = explainFinancialHealth(scoreOf(mixed), mixed);
      for (const r of e.recommendations) {
        expect(r.title.length).toBeGreaterThan(0);
        expect(r.description.length).toBeGreaterThan(0);
        expect(['high', 'medium', 'low']).toContain(r.priority);
        expect(typeof r.estimatedScoreImprovement).toBe('number');
        expect(r.financialImpact).toHaveProperty('summary');
        expect(r.recommendedAction.length).toBeGreaterThan(0);
        expect(r.reasonCode.length).toBeGreaterThan(0);
        // recommendations only target weak categories
        expect(e.weaknesses.map((w) => w.key)).toContain(r.affectedCategory);
      }
    });

    it('computes a liquidity cash gap from the snapshot (financial impact)', () => {
      const e = explainFinancialHealth(scoreOf(mixed), mixed);
      const liq = e.recommendations.find((r) => r.affectedCategory === 'liquidity');
      expect(liq).toBeDefined();
      // 6 months × ₹5,000 expense − ₹5,000 cash = ₹25,000.
      expect(liq!.financialImpact.gapMinor).toBe(6 * 5_000_00 - 5_000_00);
    });

    it('caps potential improvement so overall never exceeds 100', () => {
      const e = explainFinancialHealth(scoreOf(mixed), mixed);
      expect(e.potentialOverall).toBeLessThanOrEqual(100);
      expect(e.potentialScoreImprovement).toBeLessThanOrEqual(100 - e.overall + 0.05);
    });

    it('lowers confidence and flags a reason code when income data is missing', () => {
      const noIncome = { ...mixed, cashflowSummary: { ...mixed.cashflowSummary, incomeMinor: 0, savingsRate: 0 } };
      const e = explainFinancialHealth(scoreOf(noIncome), noIncome);
      expect(e.confidence).toBeLessThan(1);
      expect(e.reasonCodes).toContain('NO_INCOME_DATA');
    });

    it('produces no recommendations for an all-strong household', () => {
      const e = explainFinancialHealth(scoreOf(strong), strong);
      expect(e.weaknesses.length).toBe(0);
      expect(e.recommendations.length).toBe(0);
      expect(e.potentialScoreImprovement).toBe(0);
    });
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
