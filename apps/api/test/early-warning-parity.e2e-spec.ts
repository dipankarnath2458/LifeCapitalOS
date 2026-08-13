import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Early-warning parity — V1's retail signals versus V2's `risk` section (M5.8 PR 1).
 *
 * `V2_PRIMARY_MIGRATION_PLAN` §E listed early warning as "unmigrated" on the grounds that
 * `intelligence.risk` overlaps V1 but **no test proved parity**. This is that test.
 *
 * ## Why parity is expected at all
 *
 * Both paths compose the *same* pure engine — V1's `/insights/early-warning` and the
 * intelligence layer both call `computeEarlyWarning` (`financialIntelligence.ts:544`). So this
 * does not test the finance; it tests that the V2 composition feeds the engine faithfully and
 * does not drop or distort a signal on the way.
 *
 * ## The one signal that cannot match, stated rather than hidden
 *
 * V1's input carries `goalSlippage`; the layer's input **omits it entirely**, because the
 * Financial Snapshot has no goals section. No goal-derived signal can therefore appear in V2's
 * `risk`, and no assertion here can honestly claim otherwise.
 *
 * This test asserts parity across every **non-goal** signal and names the gap. Closing it needs
 * goals in the snapshot — M5.8 PR 2's territory, not something to smuggle in by weakening the
 * assertion until it passes.
 */
describe('Early-warning parity: V1 retail vs V2 household (e2e)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  const PASSWORD = 'Parity1pass';
  const rupees = (n: number) => n * 100;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  /**
   * Figures chosen so both paths derive an IDENTICAL `EarlyWarningInput`.
   *
   * Cash-only assets (so liquid == emergency fund == total assets on both sides), no debt, and
   * no insurance (V1 reads the profile flags; the layer receives no insurance assumptions and
   * defaults both to false, so the profile must say the same).
   *
   * Income is monthly on the household path and annual on the retail one — the layer multiplies
   * the month by 12 (`financialIntelligence.ts:304`), so the retail profile states that product.
   */
  const CASH = 900000;
  const MONTHLY_INCOME = 300000;
  const MONTHLY_EXPENSES = 75000;
  const DEPENDANTS = 2;

  async function consumer() {
    const email = `parity_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`;
    const reg = await http()
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, fullName: 'Parity Probe' });
    expect(reg.status).toBe(201);
    const token = reg.body.accessToken as string;
    const ws = await http().post('/api/onboarding/household').set(auth(token)).send({});
    expect(ws.status).toBe(201);
    return { token, householdId: ws.body.householdId as string };
  }

  /** The V1 retail path: profile + a retail cash account. */
  async function seedRetail(token: string) {
    const profile = await http()
      .put('/api/profile')
      .set(auth(token))
      .send({
        annualIncomeMinor: rupees(MONTHLY_INCOME * 12),
        monthlyExpensesMinor: rupees(MONTHLY_EXPENSES),
        dependents: DEPENDANTS,
        hasTermCover: false,
        hasHealthInsurance: false,
        riskTolerance: 'moderate',
      });
    expect(profile.status).toBe(200);

    const account = await http().post('/api/accounts').set(auth(token)).send({
      name: 'Savings',
      type: 'bank',
      assetClass: 'cash',
      currency: 'INR',
      balanceMinor: rupees(CASH),
      isLiability: false,
    });
    expect(account.status).toBe(201);
  }

  /** The V2 household path: household cash account, cashflow, dependants, snapshot. */
  async function seedHousehold(token: string, householdId: string) {
    const cash = await http()
      .post(`/api/households/${householdId}/accounts`)
      .set(auth(token))
      .send({
        name: 'Cash & savings',
        type: 'bank',
        assetClass: 'cash',
        currency: 'INR',
        balanceMinor: rupees(CASH),
        isLiability: false,
      });
    expect(cash.status).toBe(201);

    const occurredAt = new Date().toISOString();
    for (const f of [
      { type: 'income', category: 'salary', amountMinor: rupees(MONTHLY_INCOME) },
      { type: 'expense', category: 'living', amountMinor: rupees(MONTHLY_EXPENSES) },
    ]) {
      await http()
        .post(`/api/households/${householdId}/cashflow`)
        .set(auth(token))
        .send({ accountId: cash.body.id, currency: 'INR', occurredAt, ...f });
    }

    for (let i = 0; i < DEPENDANTS; i += 1) {
      const created = await http()
        .post(`/api/households/${householdId}/members`)
        .set(auth(token))
        .send({ name: `Dependant ${i + 1}`, relation: 'child', isDependent: true });
      expect(created.status).toBe(201);
    }

    const snap = await http()
      .post(`/api/households/${householdId}/financial-snapshot`)
      .set(auth(token))
      .send({});
    expect(snap.status).toBe(201);
  }

  /** Signals that can only ever come from goals, which the snapshot does not carry. */
  const GOAL_SIGNALS = ['goal_slippage', 'goals', 'goal'];
  const isGoalSignal = (key: string) => GOAL_SIGNALS.some((g) => key.includes(g));

  it('reports the same non-goal signals on both paths', async () => {
    const { token, householdId } = await consumer();
    await seedRetail(token);
    await seedHousehold(token, householdId);

    const v1 = await http().get('/api/insights/early-warning').set(auth(token));
    expect(v1.status).toBe(200);
    const v2 = await http()
      .get(`/api/households/${householdId}/intelligence/current`)
      .set(auth(token));
    expect(v2.body.risk.available).toBe(true);

    // V1 returns every signal including green ones; V2's `topRisks` carries only the
    // non-green. Compare like with like.
    const v1Signals = (v1.body.signals as { key: string; status: string; label: string }[])
      .filter((s) => s.status !== 'green' && !isGoalSignal(s.key))
      .map((s) => `${s.key}:${s.status}`)
      .sort();

    const severityToLight: Record<string, string> = { high: 'red', medium: 'yellow', low: 'green' };
    const v2Signals = (v2.body.risk.data.topRisks as { key: string; severity: string }[])
      .filter((r) => !isGoalSignal(r.key))
      .map((r) => `${r.key}:${severityToLight[r.severity]}`)
      .sort();

    expect(v2Signals).toEqual(v1Signals);
    // A vacuous pass would be two empty arrays. These figures deliberately trip signals.
    expect(v1Signals.length).toBeGreaterThan(0);
  });

  it('agrees on the headline traffic light and the red/amber counts', async () => {
    const { token, householdId } = await consumer();
    await seedRetail(token);
    await seedHousehold(token, householdId);

    const v1 = await http().get('/api/insights/early-warning').set(auth(token));
    const v2 = await http()
      .get(`/api/households/${householdId}/intelligence/current`)
      .set(auth(token));

    // These come straight from the engine's report on both sides, so any divergence means the
    // composition fed it different inputs.
    expect(v2.body.risk.data.overall).toBe(v1.body.overall);
    expect(v2.body.risk.data.redCount).toBe(v1.body.redCount);
    expect(v2.body.risk.data.yellowCount).toBe(v1.body.yellowCount);
  });

  it('documents the goal gap: V2 carries no goal-derived signal', async () => {
    // Asserted rather than left as a comment, so that when goals reach the snapshot this test
    // fails and forces the parity claim to be revisited.
    const { token, householdId } = await consumer();
    await seedRetail(token);
    await seedHousehold(token, householdId);

    const v2 = await http()
      .get(`/api/households/${householdId}/intelligence/current`)
      .set(auth(token));
    const goalRisks = (v2.body.risk.data.topRisks as { key: string }[]).filter((r) =>
      isGoalSignal(r.key),
    );
    expect(goalRisks).toHaveLength(0);
  });
});
