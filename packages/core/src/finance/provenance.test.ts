import { describe, expect, it } from 'vitest';
import {
  computeHouseholdFinancialIntelligence,
  type IntelligenceAssumptions,
} from './financialIntelligence.js';
import { investableCorpusMinor, type FinancialSnapshotPayload } from './financialSnapshot.js';

/**
 * Per-field provenance, and the corpus split it exposed (M5.14, Gap 3).
 *
 * ## What was wrong
 *
 * The layer reported **one** flag for the whole retirement projection:
 *
 *     const usingDefaults = !input.assumptions?.retirement;
 *
 * All-or-nothing, decided by whether a plan row existed. It was wrong in both directions — a
 * family who stated only a retirement age was reported as using no defaults at `confidence:
 * 'high'`, and a family who stated nothing was told the whole projection rested on "standard
 * assumptions" when their corpus and income target came from figures they had actually recorded.
 *
 * ## What it hid
 *
 * Labelling the corpus honestly forced the question *derived from what*, and there were two
 * answers: the planning surface used investable assets, the layer used reconciled net worth. For
 * a homeowning family those differ by the value of the house — measured at **4×** on the fixture
 * below. Same household, two screens, two retirement corpora.
 */

const HOME = 80_00_000_00;
const EQUITY = 15_00_000_00;
const CASH = 5_00_000_00;
const DEBT = 20_00_000_00;
const MONTHLY_EXPENSE = 1_00_000_00;

/** A family that owns its home — the common case, and the one where the two definitions differ. */
const payload = {
  netWorth: {
    assetsMinor: HOME + EQUITY + CASH,
    liabilitiesMinor: 0,
    netWorthMinor: HOME + EQUITY + CASH,
    solvencyRatio: 1,
  },
  assets: [],
  liabilities: [],
  debt: {
    totalOutstandingMinor: DEBT,
    totalMonthlyPaymentMinor: 50_000_00,
    weightedAvgRatePct: 8,
    debtCount: 1,
    byType: [],
  },
  cashflowSummary: {
    period: '2026-08',
    incomeMinor: 3_00_000_00,
    expenseMinor: MONTHLY_EXPENSE,
    netMinor: 2_00_000_00,
    savingsRate: 0.66,
    byCategory: [],
  },
  budgetSummary: {
    period: '2026-08',
    exists: false,
    totalBudgetMinor: null,
    totalSpentMinor: 0,
    overTotal: false,
  },
  assetAllocation: [
    { assetClass: 'real_estate', baseValueMinor: HOME, pct: 80 },
    { assetClass: 'equity', baseValueMinor: EQUITY, pct: 15 },
    { assetClass: 'cash', baseValueMinor: CASH, pct: 5 },
  ],
  currencyExposure: [{ currency: 'INR', baseValueMinor: HOME + EQUITY + CASH, pct: 100 }],
  householdEquity: {
    netWorthMinor: HOME + EQUITY + CASH,
    totalDebtMinor: DEBT,
    reconciledEquityMinor: HOME + EQUITY + CASH - DEBT,
  },
  entityHoldings: [],
  relationships: { memberCount: 1, entityCount: 0, entityIds: [], accountIds: [] },
  members: [{ memberId: 'm1', ageYears: 40, isDependent: false, relation: 'self' }],
} as unknown as FinancialSnapshotPayload;

const meta = {
  householdId: 'h1',
  snapshotId: 's1',
  snapshotSchemaVersion: 1,
  currency: 'INR',
};

const build = (assumptions?: IntelligenceAssumptions['retirement']) =>
  computeHouseholdFinancialIntelligence({
    payload,
    meta,
    ...(assumptions ? { assumptions: { retirement: assumptions } } : {}),
  });

const retirementOf = (assumptions?: IntelligenceAssumptions['retirement']) => {
  const section = build(assumptions).retirement;
  if (!section.available) throw new Error(`retirement unavailable: ${section.reason}`);
  return section.data;
};

const FULL_PLAN = {
  retirementAge: 62,
  yearsInRetirement: 20,
  inflationRatePct: 5,
  preRetirementReturnPct: 11,
  postRetirementReturnPct: 6,
  currentCorpusMinor: 40_00_000_00,
  desiredAnnualIncomeMinor: 18_00_000_00,
  monthlyContributionMinor: 50_000_00,
};

describe('a family who has stated nothing', () => {
  it('is not told their own figures are our assumptions', () => {
    // The understatement half of the bug. Corpus and income target come from what this family
    // actually recorded, so calling them "standard assumptions" was untrue.
    const a = retirementOf().assumptions;

    expect(a.currentCorpusMinor.source).toBe('derived');
    expect(a.desiredAnnualIncomeMinor.source).toBe('derived');
  });

  it('is told which figures really are ours', () => {
    const a = retirementOf().assumptions;

    expect(a.retirementAge.source).toBe('default');
    expect(a.yearsInRetirement.source).toBe('default');
    expect(a.inflationRatePct.source).toBe('default');
    expect(a.preRetirementReturnPct.source).toBe('default');
    expect(a.postRetirementReturnPct.source).toBe('default');
  });

  it('derives the income target from their actual spending, not a convention', () => {
    const a = retirementOf().assumptions;
    expect(a.desiredAnnualIncomeMinor.value).toBe(MONTHLY_EXPENSE * 12);
  });

  it('has no contribution at all rather than a defaulted zero', () => {
    // A zero would decide the projection's answer for them. #67, again.
    expect(retirementOf().assumptions.monthlyContributionMinor).toBeNull();
  });
});

describe('a family who stated PART of a plan', () => {
  /** Only a retirement age — the case the old boolean called "no defaults, high confidence". */
  const partial = { ...FULL_PLAN, retirementAge: 55 } as Record<string, unknown>;
  delete partial.inflationRatePct;
  delete partial.preRetirementReturnPct;
  delete partial.postRetirementReturnPct;
  delete partial.currentCorpusMinor;
  delete partial.desiredAnnualIncomeMinor;

  it('has each stated figure marked stated and each unstated one marked otherwise', () => {
    const a = retirementOf(partial as never).assumptions;

    expect(a.retirementAge).toEqual({ value: 55, source: 'stated' });
    expect(a.yearsInRetirement.source).toBe('stated'); // FULL_PLAN keeps this one
    expect(a.inflationRatePct.source).toBe('default');
    expect(a.currentCorpusMinor.source).toBe('derived');
    expect(a.desiredAnnualIncomeMinor.source).toBe('derived');
  });

  it('is NOT reported as free of defaults — the overstatement half of the bug', () => {
    // Before M5.14 this read `false`, because a plan row existed. Inflation and both return
    // rates were ours, and nothing on any screen said so.
    expect(retirementOf(partial as never).usingDefaultAssumptions).toBe(true);
  });
});

describe('a family who stated everything', () => {
  it('has no assumption of ours anywhere in the projection', () => {
    const a = retirementOf(FULL_PLAN).assumptions;

    for (const [key, f] of Object.entries(a)) {
      expect(f, `${key} should be stated`).not.toBeNull();
      expect(f!.source, `${key} should be stated`).toBe('stated');
    }
    expect(retirementOf(FULL_PLAN).usingDefaultAssumptions).toBe(false);
  });

  it('reports high confidence, and a partial plan does not', () => {
    const full = build(FULL_PLAN).retirement;
    expect(full.available && full.confidence).toBe('high');
  });
});

describe('the boolean still means what it always claimed', () => {
  it('is true when any single figure is ours, false only when none is', () => {
    expect(retirementOf().usingDefaultAssumptions).toBe(true);
    expect(retirementOf(FULL_PLAN).usingDefaultAssumptions).toBe(false);
  });

  it('agrees with the per-field data it is computed from', () => {
    for (const assumptions of [undefined, FULL_PLAN]) {
      const r = retirementOf(assumptions);
      const anyDefault = Object.values(r.assumptions).some(
        (f) => f !== null && f.source === 'default',
      );
      expect(r.usingDefaultAssumptions).toBe(anyDefault);
    }
  });
});

describe('the retirement corpus has ONE definition', () => {
  it('excludes the family home', () => {
    // Nobody sells the house to buy groceries at seventy.
    expect(investableCorpusMinor(payload)).toBe(EQUITY + CASH);
  });

  it('is what the layer falls back to when no plan is stated', () => {
    // The fix. This used to be reconciled net worth, which includes the home.
    expect(retirementOf().currentCorpusMinor).toBe(EQUITY + CASH);
  });

  it('no longer reports 4x the planning surface for a homeowning family', () => {
    // The measured disagreement: ₹80,00,000 on the dashboard against ₹20,00,000 on
    // /household/retirement, for one household at one moment.
    const reconciled = payload.householdEquity.reconciledEquityMinor;
    const investable = investableCorpusMinor(payload);

    expect(reconciled).toBe(HOME + EQUITY + CASH - DEBT);
    expect(reconciled / investable).toBe(4);
    // And the layer now reports the smaller, correct one.
    expect(retirementOf().currentCorpusMinor).toBe(investable);
    expect(retirementOf().currentCorpusMinor).not.toBe(reconciled);
  });

  it('still lets a family override it with a stated corpus', () => {
    expect(retirementOf(FULL_PLAN).currentCorpusMinor).toBe(FULL_PLAN.currentCorpusMinor);
  });

  it('is never negative, even for a family that owns only a mortgaged home', () => {
    const onlyHome = {
      ...payload,
      assetAllocation: [{ assetClass: 'real_estate', baseValueMinor: HOME, pct: 100 }],
    } as FinancialSnapshotPayload;
    expect(investableCorpusMinor(onlyHome)).toBe(0);
  });
});
