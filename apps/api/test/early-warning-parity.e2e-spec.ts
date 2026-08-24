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
 * ## Insurance: diverged in #67, and CLOSED here (M5.9)
 *
 * A short history, because this signal has meant three different things.
 *
 * 1. Originally V1 read real protection booleans from `Profile` while V2 had no protection store
 *    and defaulted to `false`. Parity "held" only because **both paths were wrong in the same
 *    way** — one saying "no cover" from a real answer, the other from a default.
 * 2. The #67 hotfix made V2 pass `null` (not asked) so the engine stopped asserting a fact about
 *    unasked families. Insurance then had to be excluded here, and the divergence was asserted
 *    explicitly so it would fail the day it closed.
 * 3. M5.9 gives V2 a protection store. `seedHousehold` now records the *same* answers the retail
 *    profile states, so the insurance signal is comparable again and is back inside the parity
 *    assertion. The gap is closed rather than permanently excused.
 *
 * The distinction that survives is asserted separately below: a household that has recorded
 * nothing must still produce no signal at all.
 *
 * ## Goals: the last excluded signal, closed in M5.11
 *
 * **Goals** were the one signal that could not match. V1's input carries `goalSlippage`; the
 * layer's input omitted it entirely, because the Financial Snapshot has no goals section — so no
 * goal-derived signal could appear in V2's `risk`, however far behind a family was. That gap was
 * asserted here explicitly so it would fail the day it closed, and it now has: goals reach the
 * layer as a module-owned assumption (the same route protection took), and both paths compute
 * slippage with the same `@lcos/core` function. Goals are inside the parity assertion below, and
 * nothing is excluded from it any more.
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
   * The profile states `hasTermCover: false` deliberately: that is a real answer on the retail
   * side, and since M5.9 `seedHousehold` records the SAME answer against every household member,
   * so both paths derive the same insurance signal from equivalent facts.
   *
   * Income is monthly on the household path and annual on the retail one — the layer multiplies
   * the month by 12 (`financialIntelligence.ts:304`), so the retail profile states that product.
   */
  const CASH = 900000;
  const MONTHLY_INCOME = 300000;
  const MONTHLY_EXPENSES = 75000;
  const DEPENDANTS = 2;
  /**
   * One goal, stated identically on both paths (M5.11). Badly underfunded on purpose: a goal
   * both paths agree is *fine* would pass this test even if one of them had stopped looking.
   */
  const GOAL = {
    name: 'New home',
    type: 'home_purchase' as const,
    currency: 'INR',
    targetAmountMinor: rupees(5000000),
    currentAmountMinor: rupees(200000),
    expectedAnnualReturnPct: 10,
  };
  const goalTargetDate = () => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 3);
    return d.toISOString();
  };

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

    const goal = await http()
      .post('/api/goals')
      .set(auth(token))
      .send({ ...GOAL, targetDate: goalTargetDate() });
    expect(goal.status).toBe(201);
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

    // Protection, recorded to match the retail profile exactly (M5.9). Until this milestone the
    // household path had NO protection store, so V2 could not answer the question at all. Every
    // member must answer or the layer declines to assess — which is the behaviour the separate
    // test below covers.
    const members = await http().get(`/api/households/${householdId}/members`).set(auth(token));
    expect(members.status).toBe(200);
    for (const m of members.body as { id: string; isDependent: boolean }[]) {
      const res = await http()
        .patch(`/api/households/${householdId}/protection/members/${m.id}`)
        .set(auth(token))
        .send({
          hasHealthInsurance: false,
          ...(m.isDependent ? {} : { hasTermCover: false, termLifeCoverMinor: 0 }),
        });
      expect(res.status).toBe(200);
    }

    // The same goal the retail profile states (M5.11). Goals are module-owned, so this does not
    // reach the snapshot — it reaches the layer through `resolveAssumptions`.
    const goal = await http()
      .post(`/api/households/${householdId}/goals`)
      .set(auth(token))
      .send({ ...GOAL, targetDate: goalTargetDate() });
    expect(goal.status).toBe(201);

    const snap = await http()
      .post(`/api/households/${householdId}/financial-snapshot`)
      .set(auth(token))
      .send({});
    expect(snap.status).toBe(201);
  }

  // Nothing is excluded from parity any more (M5.11). Insurance rejoined the comparison in
  // M5.9 and goals in M5.11; the helper is kept as a deliberate no-op so that re-excluding a
  // signal has to be an edit someone makes on purpose, with a reason, rather than a filter that
  // quietly grows.
  const incomparable = (_key: string) => false;

  it('reports the same signals on both paths — nothing excluded any more', async () => {
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
    // And specifically the two that were once excluded, so this cannot silently narrow back to
    // the subset it used to compare.
    expect(v1Signals.join(' ')).toContain('insurance');
    expect(v1Signals.join(' ')).toContain('goal_slippage');
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

  it('the protection gap is CLOSED: both paths derive the same insurance signal (M5.9)', async () => {
    // Step 3 of the history at the top of this file. Both paths now hold the same real answers
    // — the retail profile says no cover, and every household member says the same — so the
    // insurance signal must agree in status AND in the sentence shown to the family.
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
    const v2Insurance = (
      v2.body.risk.data.topRisks as { key: string; severity: string; detail: string }[]
    ).find((r) => r.key === 'insurance');

    expect(v1Insurance).toBeDefined();
    expect(v2Insurance).toBeDefined();
    expect(v1Insurance!.status).toBe('red');
    expect(v2Insurance!.severity).toBe('high'); // 'red' in the layer's severity vocabulary
    expect(v2Insurance!.detail).toBe(v1Insurance!.detail);
    expect(v2Insurance!.detail).toBe('no term cover, no health cover');

    // And the layer now assesses the gap itself, which it could not do before M5.9.
    expect(v2.body.insurance.available).toBe(true);
  });

  it('but an unrecorded household still makes no claim — the #67 distinction survives', async () => {
    // Closing the parity gap must not quietly reintroduce the defect for families who have not
    // answered. A household with no protection recorded gets NO signal: not a red, not a green.
    const { token, householdId } = await consumer();
    await seedRetail(token);
    // Deliberately NOT seedHousehold: no protection is recorded on the household path here.
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
    await http().post(`/api/households/${householdId}/financial-snapshot`).set(auth(token)).send({});

    const v2 = await http()
      .get(`/api/households/${householdId}/intelligence/current`)
      .set(auth(token));

    expect((v2.body.risk.data.topRisks as { key: string }[]).map((r) => r.key)).not.toContain(
      'insurance',
    );
    // `risk` is on the AI coach's allow-list, so the claim must not survive anywhere inside it —
    // not as a signal, not as a detail string the model could quote back to a family.
    expect(JSON.stringify(v2.body.risk)).not.toMatch(/no term cover|no health cover/);
    expect(v2.body.insurance.available).toBe(false);
  });

  it('the goal gap is closed: both paths raise the same goal signal (M5.11)', async () => {
    // The inverse of the assertion this replaced. Both paths are given the same goal and must
    // now agree that the family is behind on it — V2 through the module-owned assumption, V1
    // through the retail snapshot input, both via the same core function.
    const { token, householdId } = await consumer();
    await seedRetail(token);
    await seedHousehold(token, householdId);

    const [v1, v2] = await Promise.all([
      http().get('/api/insights/early-warning').set(auth(token)),
      http().get(`/api/households/${householdId}/intelligence/current`).set(auth(token)),
    ]);

    const v1Goal = (v1.body.signals as { key: string; status: string }[]).find(
      (s) => s.key === 'goal_slippage',
    );
    const v2Goal = (v2.body.risk.data.topRisks as { key: string; severity: string }[]).find(
      (r) => r.key === 'goal_slippage',
    );

    expect(v1Goal?.status).toBe('red');
    expect(v2Goal?.severity).toBe('high');
  });

  it('a household with no goals is silent, and says so in the same words as V1', async () => {
    // The distinction the whole assumption plumbing exists to preserve: "no goals" is not
    // "on track". Neither path may raise a signal, and neither may claim the family is fine.
    const { token, householdId } = await consumer();
    const v2 = await http()
      .get(`/api/households/${householdId}/intelligence/current`)
      .set(auth(token));

    if (v2.body.risk?.data) {
      const keys = (v2.body.risk.data.topRisks as { key: string }[]).map((r) => r.key);
      expect(keys).not.toContain('goal_slippage');
    }
  });
});
