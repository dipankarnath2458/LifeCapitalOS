import { describe, expect, it } from 'vitest';
import {
  computeFinancialHealthScore,
  DEFAULT_FINANCIAL_HEALTH_MODEL,
  type FinancialHealthModel,
  type HealthFacts,
} from './financialHealth.js';
import { deriveHealthFacts } from './healthFacts.js';
import type { FinancialSnapshotPayload } from './financialSnapshot.js';

/**
 * Wealth Health Score v2 (M5.12) — protection and retirement count.
 *
 * See `docs/M5_12_WEALTH_HEALTH_SCORE_V2_ARCHITECTURE.md`.
 *
 * Two properties carry this milestone, and both are asserted here rather than argued in a
 * document: a family who has told us nothing sees **no change at all**, and a family who has told
 * us something is scored on what they said and never on a silence.
 */

const payload = {
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
  members: [
    { memberId: 'm1', ageYears: 40, isDependent: false, relation: 'self' },
    { memberId: 'm2', ageYears: 8, isDependent: true, relation: 'child' },
  ],
} as unknown as FinancialSnapshotPayload;

/** The model exactly as `fhs-1.0.0` defined it, kept here to prove the identity in §3. */
const V1_MODEL: FinancialHealthModel = {
  version: 'fhs-1.0.0',
  categories: [
    { key: 'net_worth', label: 'Net Worth & Solvency', weight: 25 },
    { key: 'debt_burden', label: 'Debt Burden', weight: 25 },
    { key: 'savings', label: 'Savings', weight: 20 },
    { key: 'liquidity', label: 'Emergency Liquidity', weight: 20 },
    { key: 'diversification', label: 'Diversification', weight: 10 },
  ],
  anchors: DEFAULT_FINANCIAL_HEALTH_MODEL.anchors,
};

describe('a family who told us nothing sees no change', () => {
  /**
   * Households whose category scores differ sharply from one another. A single balanced fixture
   * is not enough: the overall is rounded to an integer, so an uneven re-weighting can hide
   * inside the rounding on one payload and still move thousands of real families. These spread
   * the weight across categories that disagree, which is where a proportional error shows.
   */
  const VARIANTS: [string, FinancialSnapshotPayload][] = [
    ['balanced', payload],
    [
      'poor savings, strong everything else',
      { ...payload, cashflowSummary: { ...payload.cashflowSummary, savingsRate: 0.02 } } as FinancialSnapshotPayload,
    ],
    [
      'wholly concentrated in one asset class',
      {
        ...payload,
        assetAllocation: [{ assetClass: 'real_estate', baseValueMinor: 100_000_00, pct: 100 }],
      } as FinancialSnapshotPayload,
    ],
    [
      'insolvent',
      {
        ...payload,
        netWorth: { ...payload.netWorth, netWorthMinor: -5_000_00, solvencyRatio: -0.05 },
      } as FinancialSnapshotPayload,
    ],
    [
      'heavily indebted, no cash',
      {
        ...payload,
        debt: { ...payload.debt, totalOutstandingMinor: 70_000_00, totalMonthlyPaymentMinor: 6_000_00 },
        assets: payload.assets.filter((a) => a.assetClass !== 'cash'),
      } as FinancialSnapshotPayload,
    ],
  ];

  it.each(VARIANTS)(
    'scores identically under fhs-2.0.0 with no facts as under fhs-1.0.0 — %s',
    (_name, p) => {
      // THE property of this milestone. The five original categories were scaled by one common
      // factor, so omitting the two new ones and renormalising restores the original proportions
      // exactly. If someone re-weights unevenly later, a whole population's headline number moves
      // silently — and this is the test that stops it.
      const before = computeFinancialHealthScore(p, V1_MODEL);
      const after = computeFinancialHealthScore(p, DEFAULT_FINANCIAL_HEALTH_MODEL, {});

      expect(after.overall).toBe(before.overall);
      expect(after.band).toBe(before.band);
    },
  );

  it('the identity is exact before rounding, not merely close', () => {
    // Rounding to an integer can hide a small proportional error on any single household. This
    // compares the unrounded weighted means, so a drift of a fraction of a point still fails.
    const exactMean = (r: ReturnType<typeof computeFinancialHealthScore>) =>
      r.categories.reduce((s, c) => s + c.score * c.weight, 0) /
      r.categories.reduce((s, c) => s + c.weight, 0);

    for (const [, p] of VARIANTS) {
      const before = computeFinancialHealthScore(p, V1_MODEL);
      const after = computeFinancialHealthScore(p, DEFAULT_FINANCIAL_HEALTH_MODEL, {});
      expect(exactMean(after)).toBeCloseTo(exactMean(before), 10);
    }
  });

  it('omits the categories entirely rather than scoring them zero', () => {
    const r = computeFinancialHealthScore(payload, DEFAULT_FINANCIAL_HEALTH_MODEL, {});
    const keys = r.categories.map((c) => c.key);

    expect(keys).not.toContain('protection');
    expect(keys).not.toContain('retirement');
    // A zero would be an assertion about a family nobody asked. It would also drag the overall
    // down by 30 points of weight, which is the difference between "we don't know" and "you are
    // failing".
    expect(r.overall).toBeGreaterThan(0);
  });

  it('treats null the same as absent — both mean not asked', () => {
    const absent = computeFinancialHealthScore(payload, DEFAULT_FINANCIAL_HEALTH_MODEL, {});
    const explicitNull = computeFinancialHealthScore(payload, DEFAULT_FINANCIAL_HEALTH_MODEL, {
      protection: null,
      retirement: null,
    });
    expect(explicitNull).toEqual(absent);
  });
});

describe('a family who told us something is scored on it', () => {
  const withFacts = (facts: HealthFacts) =>
    computeFinancialHealthScore(payload, DEFAULT_FINANCIAL_HEALTH_MODEL, facts);
  const overallOf = (facts: HealthFacts) => withFacts(facts).overall;
  const categoryOf = (facts: HealthFacts, key: string) =>
    withFacts(facts).categories.find((c) => c.key === key);

  it('being uninsured lowers the score; being well covered does not', () => {
    const uninsured = overallOf({ protection: { coverRatio: 0, hasHealthInsurance: false } });
    const unknown = overallOf({});
    const covered = overallOf({ protection: { coverRatio: 1, hasHealthInsurance: true } });

    expect(uninsured).toBeLessThan(unknown);
    expect(covered).toBeGreaterThanOrEqual(unknown);
    expect(categoryOf({ protection: { coverRatio: 0, hasHealthInsurance: false } }, 'protection')?.score).toBe(0);
    expect(categoryOf({ protection: { coverRatio: 1, hasHealthInsurance: true } }, 'protection')?.score).toBe(100);
  });

  it('being behind on retirement lowers the score; being on track does not', () => {
    const behind = overallOf({ retirement: { readiness: 0 } });
    const unknown = overallOf({});
    const onTrack = overallOf({ retirement: { readiness: 1 } });

    expect(behind).toBeLessThan(unknown);
    expect(onTrack).toBeGreaterThanOrEqual(unknown);
  });

  it('a surplus earns full marks, not extra ones — the score is bounded', () => {
    const exactly = categoryOf({ retirement: { readiness: 1 } }, 'retirement')?.score;
    const triple = categoryOf({ retirement: { readiness: 3 } }, 'retirement')?.score;
    expect(exactly).toBe(100);
    expect(triple).toBe(100);
  });

  it('scores protection on whichever half is known, and says which', () => {
    // Health cover stated, life cover not: the category is scored on the one real answer rather
    // than dropped, and rather than a zero standing in for the missing half.
    const healthOnly = categoryOf(
      { protection: { coverRatio: null, hasHealthInsurance: true } },
      'protection',
    );
    expect(healthOnly?.score).toBe(100);
    expect(healthOnly?.reason).toContain('life cover has not been recorded');

    const lifeOnly = categoryOf(
      { protection: { coverRatio: 0.5, hasHealthInsurance: null } },
      'protection',
    );
    expect(lifeOnly?.score).toBe(55);
  });

  it('every scored category still carries a metric, a reason and a suggestion', () => {
    const r = withFacts({
      protection: { coverRatio: 0.3, hasHealthInsurance: false },
      retirement: { readiness: 0.4 },
    });
    for (const c of r.categories) {
      expect(c.metric.name.length).toBeGreaterThan(0);
      expect(c.reason.length).toBeGreaterThan(0);
      expect(c.suggestion.length).toBeGreaterThan(0);
    }
  });

  it('weights still total 100 once both new categories are present', () => {
    const r = withFacts({
      protection: { coverRatio: 0.3, hasHealthInsurance: false },
      retirement: { readiness: 0.4 },
    });
    expect(r.categories.reduce((s, c) => s + c.weight, 0)).toBe(100);
  });
});

describe('deriveHealthFacts decides what is known — and never invents', () => {
  const ctx = { primaryAgeYears: 40, currency: 'INR' as const };

  it('returns nothing for a household that has recorded nothing', () => {
    expect(deriveHealthFacts(payload, undefined, ctx)).toEqual({
      protection: null,
      retirement: null,
    });
  });

  it('derives a cover ratio from the recommendation, not from a guess', () => {
    const facts = deriveHealthFacts(
      payload,
      { insurance: { existingCoverMinor: 0, hasTermCover: false, hasHealthInsurance: false } },
      ctx,
    );
    expect(facts.protection?.coverRatio).toBe(0);
    expect(facts.protection?.hasHealthInsurance).toBe(false);

    // 15× annual income (a dependant is present) + outstanding debt.
    const annualIncome = payload.cashflowSummary.incomeMinor * 12;
    const recommended = annualIncome * 15 + payload.debt.totalOutstandingMinor;
    const half = deriveHealthFacts(
      payload,
      { insurance: { existingCoverMinor: recommended / 2, hasTermCover: true, hasHealthInsurance: true } },
      ctx,
    );
    expect(half.protection?.coverRatio).toBeCloseTo(0.5, 6);
  });

  it('does NOT score retirement on defaults the family never gave us', () => {
    // The intelligence layer falls back to documented assumptions so it can always show
    // something. The score must not: lowering a family's headline number against a plan they
    // never stated is the #67 defect wearing a different hat.
    const facts = deriveHealthFacts(payload, { insurance: undefined } as never, ctx);
    expect(facts.retirement).toBeNull();
  });

  it('scores retirement once a plan is stated', () => {
    const facts = deriveHealthFacts(
      payload,
      {
        retirement: {
          retirementAge: 60,
          yearsInRetirement: 25,
          inflationRatePct: 6,
          preRetirementReturnPct: 10,
          postRetirementReturnPct: 7,
        },
      },
      ctx,
    );
    expect(facts.retirement).not.toBeNull();
    expect(facts.retirement!.readiness).toBeGreaterThanOrEqual(0);
  });

  it('cannot project retirement with no age, and says so by staying silent', () => {
    const facts = deriveHealthFacts(
      payload,
      {
        retirement: {
          retirementAge: 60,
          yearsInRetirement: 25,
          inflationRatePct: 6,
          preRetirementReturnPct: 10,
          postRetirementReturnPct: 7,
        },
      },
      { ...ctx, primaryAgeYears: null },
    );
    expect(facts.retirement).toBeNull();
  });

  it('a family with nothing to protect is not marked down for having no cover', () => {
    // No income and no dependants: there is no life-cover need to fall short of. The ratio would
    // otherwise be 0/0, and reporting that as "no protection" would penalise, say, a retired
    // couple for not buying term insurance they do not need.
    const noNeed = {
      ...payload,
      cashflowSummary: { ...payload.cashflowSummary, incomeMinor: 0 },
      members: [{ memberId: 'm1', ageYears: 70, isDependent: false, relation: 'self' }],
    } as unknown as FinancialSnapshotPayload;

    const facts = deriveHealthFacts(
      noNeed,
      { insurance: { existingCoverMinor: 0, hasTermCover: false, hasHealthInsurance: true } },
      ctx,
    );
    expect(facts.protection?.coverRatio).toBeNull();
    expect(facts.protection?.hasHealthInsurance).toBe(true);
  });
});
