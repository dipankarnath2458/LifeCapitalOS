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
 * ## The two signals that cannot match, stated rather than hidden
 *
 * **Goals.** V1's input carries `goalSlippage`; the layer's input **omits it entirely**, because
 * the Financial Snapshot has no goals section. No goal-derived signal can appear in V2's `risk`.
 *
 * **Insurance (new — the M5.9 hotfix).** V1 reads real protection booleans from `Profile`. The V2
 * layer has no protection data at all, and now passes `null` rather than `false`, so the engine
 * emits no insurance signal for V2 instead of asserting "no term cover, no health cover" about a
 * family nobody asked.
 *
 * That divergence is the *point* of the hotfix, not a regression. Before it, this file's parity
 * held only because **both paths were wrong in the same way** — V1 said "no cover" from a real
 * answer, V2 said "no cover" from a default. Matching outputs, incomparable meanings.
 *
 * So parity is asserted across every **non-goal, non-insurance** signal, and each gap is asserted
 * explicitly below so it fails the day it closes. M5.9 closes the insurance one by giving V2 real
 * protection data.
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
   * Cash-only assets (so liquid == emergency fund == total assets on both sides) and no debt.
   *
   * The profile states `hasTermCover: false` deliberately: that is a real answer, and V1 must
   * still raise its red for it. V2 receives no protection assumptions at all and now makes no
   * claim either way, which is why the insurance signal is compared separately below.
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
  /** Protection: V1 has real answers, V2 has none. Closed by M5.9, asserted below until then. */
  const isInsuranceSignal = (key: string) => key === 'insurance';
  const incomparable = (key: string) => isGoalSignal(key) || isInsuranceSignal(key);

  it('reports the same non-goal, non-insurance signals on both paths', async () => {
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
      .filter((s) => s.status !== 'green' && !incomparable(s.key))
      .map((s) => `${s.key}:${s.status}`)
      .sort();

    const severityToLight: Record<string, string> = { high: 'red', medium: 'yellow', low: 'green' };
    const v2Signals = (v2.body.risk.data.topRisks as { key: string; severity: string }[])
      .filter((r) => !incomparable(r.key))
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

    // Compared over the comparable subset. V2 emits the goal signal as green (the snapshot has
    // no goals) and no insurance signal at all, so its counts are exactly V1's counts with the
    // incomparable signals removed — computed from V1's own report rather than hardcoded, so
    // this still fails if the composition feeds the engine different inputs.
    const comparable = (v1.body.signals as { key: string; status: string }[]).filter(
      (s) => !incomparable(s.key),
    );
    const expectedRed = comparable.filter((s) => s.status === 'red').length;
    const expectedYellow = comparable.filter((s) => s.status === 'yellow').length;
    const expectedOverall = expectedRed > 0 ? 'red' : expectedYellow > 0 ? 'yellow' : 'green';

    expect(v2.body.risk.data.redCount).toBe(expectedRed);
    expect(v2.body.risk.data.yellowCount).toBe(expectedYellow);
    expect(v2.body.risk.data.overall).toBe(expectedOverall);

    // A vacuous pass would be all zeros. These figures deliberately trip signals on both paths.
    expect(expectedRed + expectedYellow).toBeGreaterThan(0);
  });

  it('documents the protection gap: V1 states a cover answer, V2 makes no claim', async () => {
    // The M5.9 hotfix, asserted from both sides at once.
    //
    // The profile says `hasTermCover: false` — a real answer — so V1 must still raise its red.
    // V2 has no protection data, so it must say NOTHING: not a red, not a green, no signal. The
    // two are different states, and before the hotfix they produced the same output.
    //
    // When M5.9 gives V2 real protection data this fails, which is the point: the parity claim
    // must be revisited then rather than drifting.
    const { token, householdId } = await consumer();
    await seedRetail(token);
    await seedHousehold(token, householdId);

    const v1 = await http().get('/api/insights/early-warning').set(auth(token));
    const v2 = await http()
      .get(`/api/households/${householdId}/intelligence/current`)
      .set(auth(token));

    const v1Insurance = (
      v1.body.signals as { key: string; status: string; detail: string }[]
    ).find((s) => s.key === 'insurance');
    expect(v1Insurance).toBeDefined();
    expect(v1Insurance!.status).toBe('red');
    expect(v1Insurance!.detail).toBe('no term cover, no health cover');

    expect((v2.body.risk.data.topRisks as { key: string }[]).map((r) => r.key)).not.toContain(
      'insurance',
    );
    // `risk` is on the AI coach's allow-list, so the claim must not survive anywhere inside it —
    // not as a signal, not as a detail string the model could quote back to a family.
    expect(JSON.stringify(v2.body.risk)).not.toMatch(/no term cover|no health cover/);
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
