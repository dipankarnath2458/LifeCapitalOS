import { describe, expect, it } from 'vitest';
import { type FinancialSnapshotPayload } from './financialSnapshot.js';
import {
  computeHouseholdFinancialIntelligence,
  FINANCIAL_INTELLIGENCE_SCHEMA_VERSION,
  FINANCIAL_INTELLIGENCE_ENGINE_VERSION,
  type IntelligenceInput,
} from './financialIntelligence.js';
import { FINANCIAL_HEALTH_MODEL_VERSION } from './financialHealth.js';

/**
 * Financial Intelligence Layer (M5) tests. Covers: determinism, section correctness,
 * graceful degradation (missing inputs → available:false, never fabricated numbers),
 * backward compatibility (payload without the optional `members` field), and snapshot
 * compatibility (a schemaVersion-1 payload composes cleanly). The layer must never
 * invent numbers — it only composes the existing calculators.
 */

/** A rich, well-populated v1 payload (money in base-currency minor units). */
const richPayload: FinancialSnapshotPayload = {
  netWorth: { assetsMinor: 10_000_000, liabilitiesMinor: 3_000_000, netWorthMinor: 7_000_000, solvencyRatio: 0.7 },
  assets: [
    { accountId: 'a1', name: 'Cash', assetClass: 'cash', entityId: null, nativeCurrency: 'INR', nativeBalanceMinor: 1_500_000, baseBalanceMinor: 1_500_000 },
    { accountId: 'a2', name: 'Equity', assetClass: 'equity', entityId: null, nativeCurrency: 'INR', nativeBalanceMinor: 5_500_000, baseBalanceMinor: 5_500_000 },
    { accountId: 'a3', name: 'Property', assetClass: 'real_estate', entityId: null, nativeCurrency: 'INR', nativeBalanceMinor: 3_000_000, baseBalanceMinor: 3_000_000 },
  ],
  liabilities: [
    { accountId: 'l1', name: 'Loan', entityId: null, nativeCurrency: 'INR', nativeBalanceMinor: 3_000_000, baseBalanceMinor: 3_000_000 },
  ],
  debt: { totalOutstandingMinor: 3_000_000, totalMonthlyPaymentMinor: 40_000, weightedAvgRatePct: 9, debtCount: 1, byType: [{ type: 'home_loan', outstandingMinor: 3_000_000 }] },
  cashflowSummary: { period: '2026-06', incomeMinor: 200_000, expenseMinor: 120_000, netMinor: 80_000, savingsRate: 0.4, byCategory: [{ category: 'housing', amountMinor: 60_000 }, { category: 'food', amountMinor: 30_000 }, { category: 'transport', amountMinor: 30_000 }] },
  budgetSummary: { period: '2026-06', exists: true, totalBudgetMinor: 130_000, totalSpentMinor: 120_000, overTotal: false },
  assetAllocation: [
    { assetClass: 'cash', baseValueMinor: 1_500_000, pct: 15 },
    { assetClass: 'equity', baseValueMinor: 5_500_000, pct: 55 },
    { assetClass: 'real_estate', baseValueMinor: 3_000_000, pct: 30 },
  ],
  currencyExposure: [{ currency: 'INR', baseValueMinor: 10_000_000, pct: 100 }],
  householdEquity: { netWorthMinor: 7_000_000, totalDebtMinor: 3_000_000, reconciledEquityMinor: 4_000_000 },
  entityHoldings: [{ entityId: null, assetsMinor: 10_000_000, liabilitiesMinor: 3_000_000, debtOutstandingMinor: 3_000_000, netMinor: 7_000_000 }],
  relationships: { memberCount: 3, entityCount: 0, entityIds: [], accountIds: ['a1', 'a2', 'a3'] },
  members: [
    { memberId: 'm1', ageYears: 42, isDependent: false, relation: 'self' },
    { memberId: 'm2', ageYears: 39, isDependent: false, relation: 'spouse' },
    { memberId: 'm3', ageYears: 8, isDependent: true, relation: 'child' },
  ],
};

const baseInput = (payload: FinancialSnapshotPayload, over: Partial<IntelligenceInput> = {}): IntelligenceInput => ({
  payload,
  meta: {
    householdId: 'hh_1',
    snapshotId: 'snap_1',
    snapshotSchemaVersion: 1,
    engineVersion: 'm2-6.1.0',
    fxVersion: 'static-v1',
    currency: 'INR',
    capturedAt: '2026-06-30T00:00:00.000Z',
  },
  computedAt: '2026-07-16T00:00:00.000Z',
  ...over,
});

describe('financial intelligence — versioning', () => {
  it('pins the schema + engine versions', () => {
    expect(FINANCIAL_INTELLIGENCE_SCHEMA_VERSION).toBe(1);
    expect(FINANCIAL_INTELLIGENCE_ENGINE_VERSION).toMatch(/^m5-fil-/);
  });

  it('reuses the M3-1 score model version (composition, not a new score)', () => {
    const out = computeHouseholdFinancialIntelligence(baseInput(richPayload));
    expect(out.meta.scoreModelVersion).toBe(FINANCIAL_HEALTH_MODEL_VERSION);
  });
});

describe('financial intelligence — determinism', () => {
  it('produces identical output for identical input', () => {
    const a = computeHouseholdFinancialIntelligence(baseInput(richPayload));
    const b = computeHouseholdFinancialIntelligence(baseInput(richPayload));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('does not read a clock — computedAt is exactly what was injected', () => {
    const out = computeHouseholdFinancialIntelligence(baseInput(richPayload, { computedAt: '2000-01-01T00:00:00.000Z' }));
    expect(out.meta.computedAt).toBe('2000-01-01T00:00:00.000Z');
  });
});

describe('financial intelligence — section correctness (rich payload)', () => {
  const out = computeHouseholdFinancialIntelligence(baseInput(richPayload));

  it('carries household summary (PII-light — name is null)', () => {
    expect(out.household.householdId).toBe('hh_1');
    expect(out.household.name).toBeNull();
    expect(out.household.memberCount).toBe(3);
    expect(out.household.members).toHaveLength(3);
    expect(out.household.lastUpdated).toBe('2026-06-30T00:00:00.000Z');
  });

  it('net worth mirrors the snapshot figures', () => {
    expect(out.netWorth.available).toBe(true);
    if (out.netWorth.available) {
      expect(out.netWorth.data.netWorthMinor).toBe(7_000_000);
      expect(out.netWorth.data.solvencyRatio).toBe(0.7);
    }
  });

  it('computes net-worth trend from the provided series', () => {
    const withTrend = computeHouseholdFinancialIntelligence(
      baseInput(richPayload, { trend: [{ netWorthMinor: 6_000_000 }, { netWorthMinor: 7_000_000 }] }),
    );
    expect(withTrend.netWorth.available).toBe(true);
    if (withTrend.netWorth.available) {
      expect(withTrend.netWorth.data.trend).toBe('up');
      expect(withTrend.netWorth.data.changeMinor).toBe(1_000_000);
    }
  });

  it('emergency fund reuses emergencyFundTarget (cash / monthly expenses)', () => {
    expect(out.emergencyFund.available).toBe(true);
    if (out.emergencyFund.available) {
      // cash 1,500,000 / expenses 120,000 = 12.5 months
      expect(out.emergencyFund.data.monthsCovered).toBeCloseTo(12.5, 1);
      expect(out.emergencyFund.data.status).toBe('green');
      expect(out.emergencyFund.data.shortfallMinor).toBe(0);
    }
  });

  it('asset allocation reports diversification + concentration', () => {
    expect(out.assetAllocation.available).toBe(true);
    if (out.assetAllocation.available) {
      expect(out.assetAllocation.data.topConcentration?.assetClass).toBe('equity');
      expect(out.assetAllocation.data.concentrationRisk).toBe('yellow'); // 55% top
      expect(out.assetAllocation.data.diversificationIndex).toBeGreaterThan(0);
    }
  });

  it('retirement reuses computeRetirement (default assumptions flagged)', () => {
    expect(out.retirement.available).toBe(true);
    if (out.retirement.available) {
      expect(out.retirement.data.usingDefaultAssumptions).toBe(true);
      expect(out.retirement.data.requiredCorpusMinor).toBeGreaterThan(0);
      expect(out.retirement.data.readinessPct).toBeGreaterThanOrEqual(0);
      expect(out.retirement.data.readinessPct).toBeLessThanOrEqual(100);
    }
  });

  it('insurance reuses analyzeLifeInsuranceGap (cover untracked → low confidence)', () => {
    expect(out.insurance.available).toBe(true);
    if (out.insurance.available) {
      expect(out.insurance.data.dependents).toBe(1);
      expect(out.insurance.data.coverTracked).toBe(false);
      expect(out.insurance.confidence).toBe('low');
      expect(out.insurance.data.recommendedCoverMinor).toBeGreaterThan(0);
    }
  });

  it('cash flow reflects savings rate + status', () => {
    expect(out.cashflow.available).toBe(true);
    if (out.cashflow.available) {
      expect(out.cashflow.data.savingsRate).toBe(0.4);
      expect(out.cashflow.data.status).toBe('green');
      expect(out.cashflow.data.topCategories[0]?.category).toBe('housing');
    }
  });

  it('risk reuses computeEarlyWarning', () => {
    expect(out.risk.available).toBe(true);
    if (out.risk.available) {
      expect(['green', 'yellow', 'red']).toContain(out.risk.data.overall);
      expect(out.risk.data.redCount + out.risk.data.yellowCount).toBeGreaterThanOrEqual(0);
    }
  });

  it('wealth health reuses computeFinancialHealthScore (0..100 + band)', () => {
    expect(out.wealthHealth.available).toBe(true);
    if (out.wealthHealth.available) {
      expect(out.wealthHealth.data.overall).toBeGreaterThanOrEqual(0);
      expect(out.wealthHealth.data.overall).toBeLessThanOrEqual(100);
      expect(out.wealthHealth.data.categories.length).toBe(5);
    }
  });

  it('executive summary + recommended actions are populated deterministically', () => {
    expect(out.executiveSummary.headline).toMatch(/Financial health is/);
    expect(Array.isArray(out.recommendedActions)).toBe(true);
  });

  it('reports full data completeness when assumptions are supplied', () => {
    const full = computeHouseholdFinancialIntelligence(
      baseInput(richPayload, {
        assumptions: {
          retirement: { retirementAge: 60, yearsInRetirement: 25, inflationRatePct: 6, preRetirementReturnPct: 10, postRetirementReturnPct: 7 },
          insurance: { existingCoverMinor: 50_000_000, hasTermCover: true, hasHealthInsurance: true },
          risk: 'moderate',
        },
      }),
    );
    expect(full.meta.dataCompleteness.pct).toBe(100);
    expect(full.meta.dataCompleteness.missing).toHaveLength(0);
    expect(full.meta.confidence).toBe('high');
    if (full.insurance.available) {
      expect(full.insurance.data.coverTracked).toBe(true);
      expect(full.insurance.data.existingCoverMinor).toBe(50_000_000);
    }
  });
});

describe('financial intelligence — graceful degradation', () => {
  const emptyPayload: FinancialSnapshotPayload = {
    netWorth: { assetsMinor: 0, liabilitiesMinor: 0, netWorthMinor: 0, solvencyRatio: 0 },
    assets: [],
    liabilities: [],
    debt: { totalOutstandingMinor: 0, totalMonthlyPaymentMinor: 0, weightedAvgRatePct: 0, debtCount: 0, byType: [] },
    cashflowSummary: { period: '2026-06', incomeMinor: 0, expenseMinor: 0, netMinor: 0, savingsRate: 0, byCategory: [] },
    budgetSummary: { period: '2026-06', exists: false, totalBudgetMinor: null, totalSpentMinor: 0, overTotal: false },
    assetAllocation: [],
    currencyExposure: [],
    householdEquity: { netWorthMinor: 0, totalDebtMinor: 0, reconciledEquityMinor: 0 },
    entityHoldings: [],
    relationships: { memberCount: 0, entityCount: 0, entityIds: [], accountIds: [] },
  };

  const out = computeHouseholdFinancialIntelligence(baseInput(emptyPayload));

  it('never throws on an empty payload', () => {
    expect(out).toBeTruthy();
  });

  it('marks input-starved sections unavailable with a reason (no fabricated numbers)', () => {
    expect(out.emergencyFund.available).toBe(false);
    expect(out.assetAllocation.available).toBe(false);
    expect(out.retirement.available).toBe(false);
    expect(out.cashflow.available).toBe(false);
    if (!out.emergencyFund.available) expect(out.emergencyFund.reason).toBeTruthy();
    if (!out.retirement.available) expect(out.retirement.reason).toBeTruthy();
  });

  it('keeps always-computable sections available even when empty', () => {
    expect(out.netWorth.available).toBe(true);
    expect(out.risk.available).toBe(true);
    expect(out.wealthHealth.available).toBe(true);
  });

  it('reports low completeness + lists every missing input', () => {
    expect(out.meta.dataCompleteness.pct).toBeLessThan(50);
    expect(out.meta.dataCompleteness.missing).toEqual(
      expect.arrayContaining(['income', 'expenses', 'assets', 'memberAges', 'insurancePolicies', 'retirementAssumptions']),
    );
    expect(out.meta.confidence).toBe('low');
  });
});

describe('financial intelligence — backward + snapshot compatibility', () => {
  it('composes a payload WITHOUT the optional members[] field (pre-M3-hardening snapshots)', () => {
    const { members, ...withoutMembers } = richPayload;
    void members;
    const out = computeHouseholdFinancialIntelligence(baseInput(withoutMembers as FinancialSnapshotPayload));
    expect(out.household.members).toEqual([]);
    // retirement needs a member age → unavailable, not a crash or a fake number
    expect(out.retirement.available).toBe(false);
    expect(out.meta.dataCompleteness.missing).toContain('memberAges');
  });

  it('accepts a schemaVersion-1 snapshot and stamps its provenance into meta', () => {
    const out = computeHouseholdFinancialIntelligence(baseInput(richPayload));
    expect(out.meta.snapshotSchemaVersion).toBe(1);
    expect(out.meta.snapshotId).toBe('snap_1');
    expect(out.meta.fxVersion).toBe('static-v1');
    expect(out.meta.currency).toBe('INR');
  });
});
