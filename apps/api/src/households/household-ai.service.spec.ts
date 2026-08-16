import { containsNoPiiKeys, type FinancialSnapshotPayload, type HouseholdFinancialIntelligence } from '@lcos/core';
import { PrismaService } from '../prisma/prisma.service';
import { buildHouseholdGrounding, HouseholdAiService } from './household-ai.service';

/**
 * The two properties the M5.7 design leans on, asserted directly rather than trusted.
 *
 * See `docs/M5_7_AI_INSIGHTS_ARCHITECTURE.md` §2 and §3.1.
 */

const payload = (): FinancialSnapshotPayload => ({
  netWorth: { assetsMinor: 2_000_000, liabilitiesMinor: 0, netWorthMinor: 2_000_000, solvencyRatio: 1 },
  assets: [
    {
      accountId: 'acc_1',
      name: 'Sunita’s salary account',
      assetClass: 'cash',
      entityId: 'ent_1',
      nativeCurrency: 'INR',
      nativeBalanceMinor: 2_000_000,
      baseBalanceMinor: 2_000_000,
    },
  ],
  liabilities: [],
  debt: { totalOutstandingMinor: 0, totalMonthlyPaymentMinor: 0, weightedAvgRatePct: 0, debtCount: 0, byType: [] },
  cashflowSummary: { period: '2026-08', incomeMinor: 300_000, expenseMinor: 150_000, netMinor: 150_000, savingsRate: 0.5, byCategory: [] },
  budgetSummary: { period: '2026-08', exists: false, totalBudgetMinor: null, totalSpentMinor: 0, overTotal: false },
  assetAllocation: [{ assetClass: 'cash', baseValueMinor: 2_000_000, pct: 100 }],
  currencyExposure: [{ currency: 'INR', baseValueMinor: 2_000_000, pct: 100 }],
  householdEquity: { netWorthMinor: 2_000_000, totalDebtMinor: 0, reconciledEquityMinor: 2_000_000 },
  entityHoldings: [],
  relationships: { memberCount: 2, entityCount: 1, entityIds: ['ent_1'], accountIds: ['acc_1'] },
  members: [{ memberId: 'mem_1', ageYears: 41, isDependent: false, relation: 'self' }],
});

/**
 * An intelligence object in the state the API layer actually hands over: `household.name`
 * DECRYPTED, because `HouseholdIntelligenceService.current()` resolves it for the dashboard
 * header. This is the hazard — the pure object would have `null` here.
 */
const FAMILY_NAME = 'Sunita Raghunathan household';
const intelligence = (): HouseholdFinancialIntelligence =>
  ({
    household: {
      householdId: 'hh_1',
      name: FAMILY_NAME,
      baseCurrency: 'INR',
      members: [{ memberId: 'mem_1', ageYears: 41, isDependent: false, relation: 'self' }],
      memberCount: 2,
      entityCount: 1,
      lastUpdated: '2026-08-01T00:00:00.000Z',
    },
    netWorth: { available: false, reason: 'n/a' },
    emergencyFund: { available: false, reason: 'n/a' },
    assetAllocation: { available: false, reason: 'n/a' },
    retirement: { available: false, reason: 'n/a' },
    insurance: { available: false, reason: 'n/a' },
    cashflow: { available: false, reason: 'n/a' },
    risk: { available: true, confidence: 'high', data: { topRisks: [], overall: 'green', redCount: 0, yellowCount: 0 } },
    opportunity: { available: true, confidence: 'high', data: { quickWins: [], longTerm: [] } },
    wealthHealth: {
      available: true,
      confidence: 'high',
      data: { overall: 72, band: 'good', category: 'Good', categories: [], trend: 'unknown' },
    },
    executiveSummary: { headline: 'Financial health is good at 72/100.', paragraphs: [], highlights: [], watchouts: [] },
    recommendedActions: [],
    meta: {
      schemaVersion: 1,
      engineVersion: 'm5-fil-1.0.0',
      scoreModelVersion: 'm3-1',
      snapshotId: 'snap_1',
      snapshotSchemaVersion: 1,
      fxVersion: 'static-v1',
      currency: 'INR',
      computedAt: '2026-08-01T00:00:00.000Z',
      confidence: 'high',
      dataCompleteness: { pct: 100, missing: [] },
    },
  }) as HouseholdFinancialIntelligence;

const envelope = {
  snapshotId: 'snap_1',
  schemaVersion: 1,
  engineVersion: 'm2-6.1.0',
  fxVersion: 'static-v1',
  currency: 'INR',
  capturedAt: '2026-08-01T00:00:00.000Z',
  status: 'active',
};

describe('household AI grounding', () => {
  const grounding = buildHouseholdGrounding(envelope, payload(), intelligence());
  const serialized = JSON.stringify(grounding);

  it('never carries the family name, even though the intelligence object does', () => {
    // The precise hazard: the API layer decrypts `household.name` into the object for the
    // dashboard header. Spreading that object into a prompt would send a real family's name to a
    // third-party model. Asserted on the serialized form because that is what actually gets sent.
    expect(intelligence().household.name).toBe(FAMILY_NAME); // the hazard is present in the input
    expect(serialized).not.toContain(FAMILY_NAME);
    expect(serialized).not.toContain('Sunita');
  });

  it('drops per-account rows, ids and account names', () => {
    // `buildAiGroundingContext` redacts these; this asserts we did not reintroduce them by
    // attaching something else alongside it.
    expect(serialized).not.toContain('Sunita’s salary account');
    expect(serialized).not.toContain('acc_1');
    expect(serialized).not.toContain('ent_1');
    expect(serialized).not.toContain('mem_1');
  });

  it('passes the redaction contract guard', () => {
    expect(containsNoPiiKeys(grounding)).toBe(true);
  });

  it('carries the figures and the provenance the answer must cite', () => {
    expect(grounding.context.provenance.snapshotId).toBe('snap_1');
    expect(grounding.context.provenance.redactionVersion).toBeTruthy();
    expect(grounding.context.financial.householdEquity.reconciledEquityMinor).toBe(2_000_000);
    // Coarse demographics survive — they are what makes planning advice specific.
    expect(grounding.context.demographics).toEqual([
      { ageYears: 41, isDependent: false, relation: 'self' },
    ]);
  });

  it('hands the model a net worth that already subtracts the family’s loan', () => {
    // Asserted on the grounding block itself — the object that is serialized into the prompt —
    // rather than on any rendered sentence. The earlier e2e for this checked the response text,
    // which in CI comes from the deterministic template and was already correct; the block the
    // model actually reads went unexamined, and shipped the gross figure to production.
    //
    // Assets 20,00,000 with a 3,50,000 loan → 16,50,000 owned, 20,00,000 gross.
    const withLoan: FinancialSnapshotPayload = {
      ...payload(),
      debt: { totalOutstandingMinor: 350_000, totalMonthlyPaymentMinor: 12_000, weightedAvgRatePct: 9, debtCount: 1, byType: [] },
      householdEquity: { netWorthMinor: 2_000_000, totalDebtMinor: 350_000, reconciledEquityMinor: 1_650_000 },
    };
    const g = buildHouseholdGrounding(envelope, withLoan, intelligence());

    expect(g.context.financial.netWorth.netWorthMinor).toBe(1_650_000);
    expect(g.context.financial.netWorth.grossNetWorthMinor).toBe(2_000_000);
    expect(g.context.financial.netWorth.totalDebtMinor).toBe(350_000);

    // And the gross figure must not be reachable under any name that reads as "net worth".
    const serializedNw = JSON.stringify(g.context.financial.netWorth);
    expect(serializedNw).not.toMatch(/"netWorthMinor":2000000/);
  });

  it('carries the layer’s conclusions, so the model assesses nothing itself', () => {
    expect(grounding.analysis.wealthHealth).toBeDefined();
    expect(grounding.analysis.risk).toBeDefined();
    expect(grounding.analysis.opportunity).toBeDefined();
    expect(grounding.analysis.executiveSummary.headline).toContain('72/100');
    // The coach receives the retirement projection as settled fact and never recomputes it.
    expect(grounding.analysis.retirement).toBeDefined();
  });

  it('does not leak sections that were never allow-listed', () => {
    // A spread would have brought `household` and `meta` along with everything in them. The
    // allow-list is what keeps a future field from reaching a model by default.
    expect(Object.keys(grounding.analysis).sort()).toEqual([
      'executiveSummary',
      'opportunity',
      'recommendedActions',
      // M5.10: added deliberately, which is exactly how an allow-list is supposed to grow.
      // Before this the coach had no retirement figures at all and could only decline the
      // most common question a family asks.
      'retirement',
      'risk',
      'wealthHealth',
    ]);
    expect(grounding).not.toHaveProperty('analysis.household');
    expect(grounding).not.toHaveProperty('analysis.meta');
  });
});

describe('household AI fallback answer', () => {
  /**
   * The service with no model configured — production's state when `ANTHROPIC_API_KEY` is unset,
   * and the path any API outage also takes.
   */
  const service = () =>
    new HouseholdAiService(
      { current: async () => ({ available: true, ...intelligence() }) } as never,
      {
        latest: async () => ({ id: 'snap_1', schemaVersion: 1, engineVersion: 'm2-6.1.0', fxVersion: 'static-v1', currency: 'INR', capturedAt: '2026-08-01T00:00:00.000Z', status: 'active', payload: payload() }),
      } as never,
      { get: () => undefined } as never,
    );

  const household = { id: 'hh_1' } as never;

  it('admits it did not answer the question, instead of replying with a non-sequitur', async () => {
    // Someone asks "can I afford to retire at 55?" and gets a balance-sheet summary. Without
    // this, the reply reads as though the coach considered the question and chose to talk about
    // something else. `ai: false` explains where the text came from, not that the question was
    // never reasoned about.
    const res = await service().coach(household, [
      { role: 'user', content: 'can i afford to retire at 55?' },
    ]);
    expect(res.available).toBe(true);
    if (!res.available) return;
    expect(res.ai).toBe(false);
    expect(res.answer).toMatch(/can.t answer that specific question right now/i);
    // The position is still reported — the fallback is honest, not empty.
    expect(res.answer).toContain('Financial health is good at 72/100.');
  });

  it('never calls a model on the free summary, even with a key configured', async () => {
    // The cost defect this pins. `insights` is free and ungated on the argument that it narrates
    // figures already on the consumer's dashboard. The coach page loads it automatically on
    // mount, so the moment an API key existed, every page view and every refresh became a billed
    // model call for any signed-in consumer — no entitlement, no rate limit.
    //
    // Driven with a key present, because that is the only state in which the bug exists: with no
    // key the deterministic path is taken anyway and a passing test would prove nothing.
    const withKey = new HouseholdAiService(
      { current: async () => ({ available: true, ...intelligence() }) } as never,
      {
        latest: async () => ({ id: 'snap_1', schemaVersion: 1, engineVersion: 'm2-6.1.0', fxVersion: 'static-v1', currency: 'INR', capturedAt: '2026-08-01T00:00:00.000Z', status: 'active', payload: payload() }),
      } as never,
      { get: (k: string) => (k === 'ai.apiKey' ? 'sk-ant-test-not-a-real-key' : undefined) } as never,
    );
    // COUNT the calls; do not merely make them throw. `answer()` catches a failed model call and
    // falls back to the deterministic narrative with `ai: false` — so a throwing stub produces an
    // identical response either way, and a test built on one passes while the money is spent.
    // The only observable that distinguishes the two is whether the SDK was reached at all.
    let calls = 0;
    const client = (withKey as unknown as { client: { messages: { create: () => Promise<unknown> } } }).client;
    expect(client).toBeTruthy();
    client.messages.create = async () => {
      calls += 1;
      return { content: [{ type: 'text', text: 'model output' }] };
    };

    const res = await withKey.insights(household);
    expect(calls).toBe(0);
    expect(res.available).toBe(true);
    if (!res.available) return;
    expect(res.ai).toBe(false);
    expect(res.answer).toContain('Financial health is good at 72/100.');
  });

  it('still calls the model on the coach, which is gated and asked for', async () => {
    // The other half: making the summary deterministic must not disable the paid surface too.
    const withKey = new HouseholdAiService(
      { current: async () => ({ available: true, ...intelligence() }) } as never,
      {
        latest: async () => ({ id: 'snap_1', schemaVersion: 1, engineVersion: 'm2-6.1.0', fxVersion: 'static-v1', currency: 'INR', capturedAt: '2026-08-01T00:00:00.000Z', status: 'active', payload: payload() }),
      } as never,
      { get: (k: string) => (k === 'ai.apiKey' ? 'sk-ant-test-not-a-real-key' : undefined) } as never,
    );
    let called = false;
    const client = (withKey as unknown as { client: { messages: { create: () => Promise<unknown> } } }).client;
    client.messages.create = async () => {
      called = true;
      return { content: [{ type: 'text', text: 'Here is a real answer.' }] };
    };

    const res = await withKey.coach(household, [{ role: 'user', content: 'can i retire at 55?' }]);
    expect(called).toBe(true);
    expect(res.available).toBe(true);
    if (!res.available) return;
    expect(res.ai).toBe(true);
    expect(res.answer).toBe('Here is a real answer.');
  });

  it('does not apologise on the summary surface, which asks nothing', async () => {
    // `insights` narrates; it poses no question, so a fallback there is a complete answer rather
    // than a substitute for one.
    const res = await service().insights(household);
    expect(res.available).toBe(true);
    if (!res.available) return;
    expect(res.answer).not.toMatch(/can.t answer that specific question/i);
    expect(res.answer).toContain('Financial health is good at 72/100.');
  });
});

describe('household AI dependency boundary', () => {
  it('does not inject Prisma or any engine repository', () => {
    // `AI_INTEGRATION_ARCHITECTURE` §5: the dependency boundary IS the enforcement mechanism —
    // AI services depend only on snapshot/intelligence reads, never on the tables underneath.
    // Asserted from the DI metadata so an edit that reaches for a repository fails here, rather
    // than depending on someone noticing it in review.
    const deps: unknown[] = Reflect.getMetadata('design:paramtypes', HouseholdAiService) ?? [];
    const names = deps.map((d) => (d as { name?: string })?.name ?? String(d));

    expect(names).not.toContain(PrismaService.name);
    expect(names.filter((n) => /Accounts?Service|CashflowService|DebtService|BudgetService/.test(n))).toEqual([]);
    expect(names).toContain('HouseholdIntelligenceService');
    expect(names).toContain('HouseholdFinancialSnapshotService');
  });
});
