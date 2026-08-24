import { HouseholdIntelligenceService } from './household-intelligence.service';
import { type FinancialSnapshotPayload } from '@lcos/core';

/**
 * Integration-style unit test for the M5 Financial Intelligence service. Uses fakes for
 * the ONLY two dependencies it is allowed (the kernel read API + the PII crypto boundary),
 * which itself documents the FUTURE_MODULE_CONTRACT wiring: no engine repositories, no
 * writes to the kernel. Verifies composition, the decrypted-name boundary, snapshot
 * selection, and graceful degradation when no snapshot exists.
 */

const payload: FinancialSnapshotPayload = {
  netWorth: { assetsMinor: 10_000_000, liabilitiesMinor: 3_000_000, netWorthMinor: 7_000_000, solvencyRatio: 0.7 },
  assets: [
    { accountId: 'a1', name: 'Cash', assetClass: 'cash', entityId: null, nativeCurrency: 'INR', nativeBalanceMinor: 1_500_000, baseBalanceMinor: 1_500_000 },
    { accountId: 'a2', name: 'Equity', assetClass: 'equity', entityId: null, nativeCurrency: 'INR', nativeBalanceMinor: 5_500_000, baseBalanceMinor: 5_500_000 },
  ],
  liabilities: [],
  debt: { totalOutstandingMinor: 3_000_000, totalMonthlyPaymentMinor: 40_000, weightedAvgRatePct: 9, debtCount: 1, byType: [] },
  cashflowSummary: { period: '2026-06', incomeMinor: 200_000, expenseMinor: 120_000, netMinor: 80_000, savingsRate: 0.4, byCategory: [] },
  budgetSummary: { period: '2026-06', exists: false, totalBudgetMinor: null, totalSpentMinor: 0, overTotal: false },
  assetAllocation: [
    { assetClass: 'cash', baseValueMinor: 1_500_000, pct: 21 },
    { assetClass: 'equity', baseValueMinor: 5_500_000, pct: 79 },
  ],
  currencyExposure: [{ currency: 'INR', baseValueMinor: 7_000_000, pct: 100 }],
  householdEquity: { netWorthMinor: 7_000_000, totalDebtMinor: 3_000_000, reconciledEquityMinor: 4_000_000 },
  entityHoldings: [],
  relationships: { memberCount: 2, entityCount: 0, entityIds: [], accountIds: ['a1', 'a2'] },
  members: [{ memberId: 'm1', ageYears: 44, isDependent: false, relation: 'self' }],
};

const snap = {
  id: 'snap_1',
  householdId: 'hh_1',
  schemaVersion: 1,
  engineVersion: 'm2-6.1.0',
  fxVersion: 'static-v1',
  currency: 'INR',
  capturedAt: new Date('2026-06-30T00:00:00.000Z'),
  payload,
};

const household = { id: 'hh_1', name: 'enc(Sharma Family)', baseCurrency: 'INR' } as any;

function fakeSnapshots(over: Partial<Record<string, any>> = {}) {
  return {
    latest: async () => snap,
    getById: async (_hid: string, id: string) => (id === 'snap_1' ? snap : null),
    timeline: async () => [
      { netWorthMinor: 6_000_000 },
      { netWorthMinor: 7_000_000 },
    ],
    ...over,
  } as any;
}

// Fake crypto boundary: "decrypts" by stripping the enc(...) wrapper.
const fakeCrypto = {
  decrypt: (v: string | null) => (v ? v.replace(/^enc\((.*)\)$/, '$1') : null),
} as any;

/**
 * The one resolver for module-owned inputs — protection (M5.9), retirement (M5.10), goals
 * (M5.11) — extracted into its own service in M5.12 so the Wealth Health Score reads exactly
 * what the intelligence layer reads.
 *
 * `undefined` is the honest default: these fakes describe a household that has recorded nothing,
 * and both consumers must read that as "not asked" rather than as a fact about the family.
 */
const fakeAssumptions = (assumptions?: unknown) => ({ resolve: async () => assumptions }) as any;

describe('HouseholdIntelligenceService', () => {
  it('composes the canonical intelligence object from the latest snapshot', async () => {
    const svc = new HouseholdIntelligenceService(fakeSnapshots(), fakeCrypto, fakeAssumptions());
    const res = await svc.current(household);
    expect(res.available).toBe(true);
    if (res.available) {
      expect(res.meta.snapshotId).toBe('snap_1');
      expect(res.netWorth.available).toBe(true);
      expect(res.wealthHealth.available).toBe(true);
      // trend series (6M → 7M) yields an "up" net-worth trend
      if (res.netWorth.available) expect(res.netWorth.data.trend).toBe('up');
    }
  });

  it('resolves the family name only at the decrypted boundary (object stays PII-light otherwise)', async () => {
    const svc = new HouseholdIntelligenceService(fakeSnapshots(), fakeCrypto, fakeAssumptions());
    const res = await svc.current(household);
    if (res.available) {
      expect(res.household.name).toBe('Sharma Family');
      expect(res.household.baseCurrency).toBe('INR');
    }
  });

  it('honours an explicit snapshotId', async () => {
    const svc = new HouseholdIntelligenceService(fakeSnapshots(), fakeCrypto, fakeAssumptions());
    const res = await svc.current(household, 'snap_1');
    expect(res.available).toBe(true);
  });

  it('404s an unknown snapshotId', async () => {
    const svc = new HouseholdIntelligenceService(fakeSnapshots(), fakeCrypto, fakeAssumptions());
    await expect(svc.current(household, 'nope')).rejects.toThrow();
  });

  it('degrades gracefully when the household has no snapshot yet', async () => {
    const svc = new HouseholdIntelligenceService(
      fakeSnapshots({ latest: async () => null }),
      fakeCrypto,
      fakeAssumptions(),
    );
    const res = await svc.current(household);
    expect(res.available).toBe(false);
    if (!res.available) expect(res.reason).toBe('no snapshot captured');
  });

  /**
   * M5.11. The defect this guards against is not arithmetic — it is a module-owned input that
   * no call site remembers to load. It happened to insurance (M5.9), and `resolveAssumptions`
   * exists so it cannot happen again; these tests hold that promise for goals specifically.
   */
  describe('goals reach the layer without any caller remembering to pass them', () => {
    const goalRisk = (res: any) =>
      res.risk.data.topRisks.find((r: { key: string }) => r.key === 'goal_slippage');

    it('a goal that is badly behind becomes a risk signal', async () => {
      const svc = new HouseholdIntelligenceService(
        fakeSnapshots(),
        fakeCrypto,
        fakeAssumptions({ goals: { slippage: [0.62] } }),
      );
      const res: any = await svc.current(household);

      expect(res.available).toBe(true);
      expect(goalRisk(res)).toMatchObject({ severity: 'high' });
      expect(goalRisk(res).detail).toContain('62%');
    });

    it('a household on track raises nothing — the signal is a finding, not a fixture', async () => {
      const svc = new HouseholdIntelligenceService(
        fakeSnapshots(),
        fakeCrypto,
        fakeAssumptions({ goals: { slippage: [0.02, 0.05] } }),
      );
      const res: any = await svc.current(household);
      // Green signals are filtered out of topRisks; the absence IS the pass here.
      expect(goalRisk(res)).toBeUndefined();
    });

    it('a household with no goals is not reported as on track', async () => {
      // `undefined`, not `[]`. Both produce no risk, but only one of them means "we looked and
      // there is nothing to be behind on" — and the engine's message differs accordingly.
      const svc = new HouseholdIntelligenceService(
        fakeSnapshots(),
        fakeCrypto,
        fakeAssumptions(undefined),
      );
      const res: any = await svc.current(household);
      expect(goalRisk(res)).toBeUndefined();
    });

    it('an explicit assumptions argument still overrides the loaded ones', async () => {
      // The escape hatch the AI grounding path and tests use must keep working.
      const svc = new HouseholdIntelligenceService(
        fakeSnapshots(),
        fakeCrypto,
        fakeAssumptions({ goals: { slippage: [0.9] } }),
      );
      const res: any = await svc.current(household, undefined, { goals: { slippage: [0.0] } });
      expect(goalRisk(res)).toBeUndefined();
    });
  });
});
