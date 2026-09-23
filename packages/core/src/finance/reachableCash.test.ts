import { describe, expect, it } from 'vitest';
import {
  isReachableCash,
  reachableCashMinor,
  type FinancialSnapshotPayload,
} from './financialSnapshot.js';
import { computeFinancialHealthScore, FINANCIAL_HEALTH_MODEL_VERSION } from './financialHealth.js';
import { explainFinancialHealth } from './financialHealthExplanation.js';
import { computeHouseholdFinancialIntelligence, type IntelligenceInput } from './financialIntelligence.js';

/**
 * Retirement money is never emergency liquidity (M5.19).
 *
 * See `docs/M5_19_REACHABLE_CASH_ARCHITECTURE.md`.
 *
 * ## What was wrong
 *
 * "Cash a family can reach in a crisis" was defined FOUR separate times, and no copy looked at
 * `accountType`:
 *
 *   1. `financialIntelligence.ts` `cashMinorOf`  -> `emergencyFund.cashMinor`, and
 *      `emergencyFundMinor`/`liquidAssetsMinor` into the early-warning engine
 *   2. `financialHealth.ts`                      -> the Emergency Liquidity dimension, weight 14
 *   3. `financialHealthExplanation.ts`           -> the gap a family is told to close
 *   4. the retail composer in `apps/api`         -> the V1 score and the Wealth Coach's grounding
 *
 * A family whose EPF was recorded as `assetClass: 'cash'` was therefore told they held months of
 * buffer in money locked until 58, and told they needed to save LESS than they do. Reachable by
 * default, not in theory: V1's `AddAccount` offered `type: 'retirement'` and defaulted the class
 * to `cash`.
 *
 * These tests pin the one rule and all three core readers of it. The fourth reader is an API
 * service and is covered by `apps/api/test/retirement-liquidity.e2e-spec.ts`.
 */

const CASH = 1_500_000; // reachable
const EPF = 2_000_000; // NOT reachable — locked until 58
const EQUITY = 5_500_000;
const PROPERTY = 3_000_000;
/**
 * Chosen so the difference is visible rather than saturated: 6 months of this is ₹24,00,000, so
 * reachable cash alone (₹15,00,000) is 3.75 months — a genuine weakness — while counting the EPF
 * makes it 8.75 and the whole thing disappears from view. A smaller figure puts both sides at the
 * top of the anchor curve, where the score cannot move and the test proves nothing.
 */
const EXPENSE = 400_000;

type Asset = FinancialSnapshotPayload['assets'][number];

const asset = (over: Partial<Asset>): Asset => ({
  accountId: 'a',
  name: 'Asset',
  assetClass: null,
  entityId: null,
  nativeCurrency: 'INR',
  nativeBalanceMinor: 0,
  baseBalanceMinor: 0,
  ...over,
});

/**
 * The household at the centre of this milestone: they hold ₹15,000 of real cash and ₹20,000 of
 * EPF that someone recorded as cash. `accountType` is what tells the two apart.
 */
const payloadWith = (epfAccountType: string | undefined): FinancialSnapshotPayload => ({
  netWorth: {
    assetsMinor: CASH + EPF + EQUITY + PROPERTY,
    liabilitiesMinor: 0,
    netWorthMinor: CASH + EPF + EQUITY + PROPERTY,
    solvencyRatio: 1,
  },
  assets: [
    { ...asset({ accountId: 'a1', name: 'Savings', assetClass: 'cash' }), nativeBalanceMinor: CASH, baseBalanceMinor: CASH, accountType: 'bank' },
    // The whole milestone, in one row.
    { ...asset({ accountId: 'a2', name: 'EPF', assetClass: 'cash' }), nativeBalanceMinor: EPF, baseBalanceMinor: EPF, ...(epfAccountType !== undefined ? { accountType: epfAccountType } : {}) },
    { ...asset({ accountId: 'a3', name: 'Equity', assetClass: 'equity' }), nativeBalanceMinor: EQUITY, baseBalanceMinor: EQUITY, accountType: 'investment' },
    { ...asset({ accountId: 'a4', name: 'Home', assetClass: 'real_estate' }), nativeBalanceMinor: PROPERTY, baseBalanceMinor: PROPERTY, accountType: 'real_estate' },
  ],
  liabilities: [],
  debt: { totalOutstandingMinor: 0, totalMonthlyPaymentMinor: 0, weightedAvgRatePct: 0, debtCount: 0, byType: [] },
  cashflowSummary: { period: '2026-06', incomeMinor: 600_000, expenseMinor: EXPENSE, netMinor: 200_000, savingsRate: 1 / 3, byCategory: [] },
  budgetSummary: { period: '2026-06', exists: false, totalBudgetMinor: null, totalSpentMinor: 0, overTotal: false },
  assetAllocation: [
    { assetClass: 'cash', baseValueMinor: CASH + EPF, pct: 29.2 },
    { assetClass: 'equity', baseValueMinor: EQUITY, pct: 45.8 },
    { assetClass: 'real_estate', baseValueMinor: PROPERTY, pct: 25 },
  ],
  currencyExposure: [{ currency: 'INR', baseValueMinor: CASH + EPF + EQUITY + PROPERTY, pct: 100 }],
  householdEquity: { netWorthMinor: CASH + EPF + EQUITY + PROPERTY, totalDebtMinor: 0, reconciledEquityMinor: CASH + EPF + EQUITY + PROPERTY },
  entityHoldings: [],
  relationships: { memberCount: 1, entityCount: 0, entityIds: [], accountIds: ['a1', 'a2', 'a3', 'a4'] },
  members: [{ memberId: 'm1', ageYears: 41, isDependent: false, relation: 'self' }],
});

/** The same family, with the EPF correctly typed. */
const LOCKED = payloadWith('retirement');
/** The same family, with it typed as an ordinary account — the control. */
const UNLOCKED = payloadWith('bank');
/** The same family from a snapshot captured before M5.15, which carries no types at all. */
const UNTYPED = payloadWith(undefined);

const intel = (payload: FinancialSnapshotPayload) =>
  computeHouseholdFinancialIntelligence({
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
  } as IntelligenceInput);

const liquidityOf = (p: FinancialSnapshotPayload) => {
  const score = computeFinancialHealthScore(p);
  return score.categories.find((c) => c.key === 'liquidity')!;
};

describe('the rule — isReachableCash', () => {
  it('excludes cash held inside a retirement account', () => {
    // The defect, at its smallest. Cash in an EPF is genuinely cash; it is simply not reachable,
    // and reachability is a property of the wrapper.
    expect(isReachableCash({ assetClass: 'cash', accountType: 'retirement' })).toBe(false);
  });

  it('includes cash held anywhere else', () => {
    expect(isReachableCash({ assetClass: 'cash', accountType: 'bank' })).toBe(true);
    expect(isReachableCash({ assetClass: 'cash', accountType: 'investment' })).toBe(true);
    expect(isReachableCash({ assetClass: 'cash', accountType: 'other_asset' })).toBe(true);
  });

  it('includes cash whose account type was never recorded — absence is not a lock', () => {
    // A pre-M5.15 snapshot carries no `accountType` at all, and never will: snapshots are
    // immutable. Treating that unknown as locked would cut every historical family's emergency
    // fund on the strength of a fact nobody recorded — the `unknown -> false` failure again.
    expect(isReachableCash({ assetClass: 'cash' })).toBe(true);
    expect(isReachableCash({ assetClass: 'cash', accountType: undefined })).toBe(true);
    expect(isReachableCash({ assetClass: 'cash', accountType: null })).toBe(true);
  });

  it('excludes everything that is not cash, whatever holds it', () => {
    // The rule narrows an existing filter; it must not widen it into one.
    expect(isReachableCash({ assetClass: 'equity', accountType: 'bank' })).toBe(false);
    expect(isReachableCash({ assetClass: 'debt', accountType: 'retirement' })).toBe(false);
    expect(isReachableCash({ assetClass: null, accountType: 'bank' })).toBe(false);
    expect(isReachableCash({})).toBe(false);
  });

  it('sums only the reachable cash in a payload', () => {
    expect(reachableCashMinor(LOCKED)).toBe(CASH);
    expect(reachableCashMinor(UNLOCKED)).toBe(CASH + EPF);
    expect(reachableCashMinor(UNTYPED)).toBe(CASH + EPF);
  });
});

describe('reader 1 — the intelligence layer', () => {
  it('keeps locked retirement money out of the emergency fund', () => {
    const locked = intel(LOCKED);
    const unlocked = intel(UNLOCKED);
    if (!locked.emergencyFund.available || !unlocked.emergencyFund.available) {
      throw new Error('fixture should produce an available emergency fund');
    }
    expect(locked.emergencyFund.data.cashMinor).toBe(CASH);
    expect(unlocked.emergencyFund.data.cashMinor).toBe(CASH + EPF);
    // And it is a real difference to a family, not a rounding one: 12.5 months of cover claimed
    // against the 12.5 they do not have.
    expect(unlocked.emergencyFund.data.cashMinor - locked.emergencyFund.data.cashMinor).toBe(EPF);
  });

  it('leaves everything that is not about liquidity exactly where it was', () => {
    // The blast radius, stated as an assertion. Net worth, the allocation, the corpus and the
    // retirement figure all read other fields, and none of them may move.
    const locked = intel(LOCKED);
    const unlocked = intel(UNLOCKED);

    expect(locked.netWorth).toEqual(unlocked.netWorth);
    expect(JSON.stringify(locked.assetAllocation)).toBe(JSON.stringify(unlocked.assetAllocation));
    expect(locked.retirement).toEqual(unlocked.retirement);
    // M5.17's figure reads `accountType` too, and reads it the other way round: the EPF IS
    // retirement money. Both facts are true at once, which is the point of the boundary.
    expect(locked.retirementAccountsMinor).toBe(EPF);
    expect(unlocked.retirementAccountsMinor).toBe(0);
  });

  it('reports a pre-M5.15 snapshot exactly as it did before this milestone', () => {
    // The compatibility guarantee. No stored history changes meaning.
    const untyped = intel(UNTYPED);
    if (!untyped.emergencyFund.available) throw new Error('fixture should be available');
    expect(untyped.emergencyFund.data.cashMinor).toBe(CASH + EPF);
  });
});

describe('reader 2 — the Wealth Health Score', () => {
  it('scores Emergency Liquidity on reachable cash only', () => {
    const locked = liquidityOf(LOCKED);
    const unlocked = liquidityOf(UNLOCKED);

    // 15,00,000 / 4,00,000 = 3.75 months of real cover, against the 8.75 claimed before.
    expect(locked.metric!.value).toBe(3.8); // rounded to one decimal by the engine
    expect(unlocked.metric!.value).toBe(8.8);
    expect(locked.score).toBeLessThan(unlocked.score);

    // And it crosses the line that decides whether a family is warned at all: below 75 the
    // category is a weakness, at or above it a strength. See the explanation test below.
    expect(locked.score).toBeLessThan(75);
    expect(unlocked.score).toBeGreaterThanOrEqual(75);
  });

  it('changes the input, not the model', () => {
    // The decision this milestone was approved under: the score can move because the number fed
    // to it was wrong, not because the model changed. Weights and anchors are untouched.
    expect(FINANCIAL_HEALTH_MODEL_VERSION).toBe('fhs-2.0.0');
    expect(liquidityOf(LOCKED).weight).toBe(14);
    expect(liquidityOf(LOCKED).weight).toBe(liquidityOf(UNLOCKED).weight);

    // Every other dimension is identical — only liquidity may differ.
    const l = computeFinancialHealthScore(LOCKED);
    const u = computeFinancialHealthScore(UNLOCKED);
    for (const c of l.categories.filter((x) => x.key !== 'liquidity')) {
      expect(JSON.stringify(c)).toBe(JSON.stringify(u.categories.find((x) => x.key === c.key)));
    }
  });

  it('does not move the score for a household with no retirement account at all', () => {
    // Most households. If this ever fails, the rule has started reaching beyond its subject.
    const noEpf: FinancialSnapshotPayload = {
      ...LOCKED,
      assets: LOCKED.assets.filter((a) => a.accountId !== 'a2'),
    };
    const asIs = computeFinancialHealthScore(noEpf);
    const typed = computeFinancialHealthScore({
      ...noEpf,
      assets: noEpf.assets.map((a) => ({ ...a, accountType: a.accountType ?? 'bank' })),
    });
    expect(asIs.overall).toBe(typed.overall);
  });
});

describe('reader 3 — the explanation a family is given', () => {
  it('tells the family to build a buffer they actually lack, instead of nothing at all', () => {
    // The sharpest of the four in product terms. A recommendation is only produced for a WEAK
    // category (score < 75), so counting locked money did not merely understate the gap — it
    // moved Emergency Liquidity into the "strengths" column and the family was given **no
    // advice whatsoever** about a shortfall of ₹9,00,000.
    const liquidityRec = (p: FinancialSnapshotPayload) =>
      explainFinancialHealth(computeFinancialHealthScore(p), p).recommendations.find(
        (r) => r.affectedCategory === 'liquidity',
      );

    const locked = liquidityRec(LOCKED);
    expect(locked).toBeDefined();
    // 6 x 4,00,000 = 24,00,000 needed, 15,00,000 reachable.
    expect(locked!.financialImpact.gapMinor).toBe(6 * EXPENSE - CASH);
    expect(locked!.financialImpact.gapMinor).toBe(900_000);

    // Before the fix, with the EPF counted: no recommendation existed at all.
    expect(liquidityRec(UNLOCKED)).toBeUndefined();
    expect(
      explainFinancialHealth(
        computeFinancialHealthScore(UNLOCKED),
        UNLOCKED,
      ).strengths.map((s) => s.key),
    ).toContain('liquidity');
  });
});
