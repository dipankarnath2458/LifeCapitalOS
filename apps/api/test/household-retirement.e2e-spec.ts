import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Retirement Planning (M5.10) — the first Planning Experience.
 *
 * See `docs/M5_10_RETIREMENT_PLANNING_ARCHITECTURE.md`.
 *
 * The milestone's claim is that retirement stops being an isolated calculator and becomes part
 * of the operating system, so most of these assert what the **intelligence layer** says once a
 * plan exists — not merely that a row was written.
 */
describe('Household retirement planning (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const PASSWORD = 'Retire1passw';
  const rupees = (n: number) => n * 100;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const dobYearsAgo = (y: number) => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - y);
    return d.toISOString();
  };

  /**
   * A consumer with an age, expenses, a home and investments, and a captured snapshot.
   *
   * The property split matters: it is what makes "corpus excludes the residence" observable.
   */
  async function consumer(prefix: string) {
    const email = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`;
    const reg = await http()
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, fullName: 'Future Retiree' });
    expect(reg.status).toBe(201);
    const token = reg.body.accessToken as string;
    const ws = await http().post('/api/onboarding/household').set(auth(token)).send({});
    const householdId = ws.body.householdId as string;

    const self = await prisma.householdMember.findFirst({ where: { householdId } });
    await http()
      .patch(`/api/households/${householdId}/members/${self!.id}`)
      .set(auth(token))
      .send({ dateOfBirth: dobYearsAgo(40), isDependent: false });

    const accounts: Record<string, string> = {};
    for (const a of [
      { key: 'equity', name: 'Mutual funds', type: 'investment', assetClass: 'equity', balanceMinor: rupees(4000000) },
      { key: 'cash', name: 'Savings', type: 'bank', assetClass: 'cash', balanceMinor: rupees(1000000) },
      { key: 'home', name: 'Our home', type: 'real_estate', assetClass: 'real_estate', balanceMinor: rupees(20000000) },
    ]) {
      const res = await http()
        .post(`/api/households/${householdId}/accounts`)
        .set(auth(token))
        .send({ ...a, currency: 'INR', isLiability: false });
      accounts[a.key] = res.body.id;
    }

    const occurredAt = new Date().toISOString();
    for (const f of [
      { type: 'income', category: 'salary', amountMinor: rupees(300000) },
      { type: 'expense', category: 'living', amountMinor: rupees(100000) },
    ]) {
      await http()
        .post(`/api/households/${householdId}/cashflow`)
        .set(auth(token))
        .send({ accountId: accounts.cash, currency: 'INR', occurredAt, ...f });
    }
    await http().post(`/api/households/${householdId}/financial-snapshot`).set(auth(token)).send({});
    return { token, householdId };
  }

  const overview = (t: string, id: string) =>
    http().get(`/api/households/${id}/retirement`).set(auth(t));
  const plan = (t: string, id: string, body: Record<string, unknown>) =>
    http().put(`/api/households/${id}/retirement`).set(auth(t)).send(body);
  const intelligence = (t: string, id: string) =>
    http().get(`/api/households/${id}/intelligence/current`).set(auth(t));

  it('starts with no plan — every assumption is ours, and labelled as ours', () => {
    return consumer('ret_defaults').then(async ({ token, householdId }) => {
      const res = await overview(token, householdId);
      expect(res.status).toBe(200);
      expect(res.body.available).toBe(true);

      expect(res.body.assumptions.retirementAge).toEqual({ value: 60, source: 'default' });
      // Not a guess: today's spend, from the snapshot. ₹1,00,000/month.
      expect(res.body.assumptions.desiredAnnualIncomeMinor).toEqual({
        value: rupees(1200000),
        source: 'derived',
      });
      // The one field with no honest default stays absent rather than becoming zero.
      expect(res.body.assumptions.monthlyContributionMinor).toBeNull();
      expect(await prisma.retirementPlan.findUnique({ where: { householdId } })).toBeNull();
    });
  });

  it('without a stated contribution, where you LAND is unavailable — but what you NEED is not', async () => {
    // The §9 distinction. Assuming a family saves nothing would be fabrication; refusing to say
    // anything at all would throw away figures we can honestly derive.
    const { token, householdId } = await consumer('ret_nocontrib');
    const res = await overview(token, householdId);

    expect(res.body.retirement.available).toBe(true);
    expect(res.body.retirement.data.requiredCorpusMinor).toBeGreaterThan(0);
    // Note the SIP may legitimately be zero here: with no plan the layer still values the
    // corpus at reconciled NET WORTH, which includes this family's ₹2Cr home and makes them
    // look retirement-ready. That overstatement is precisely what decision 1 corrects, and the
    // corpus test below asserts the correction.
    expect(typeof res.body.retirement.data.monthlySipRequiredMinor).toBe('number');

    expect(res.body.retirement.data.projection.available).toBe(false);
    expect(res.body.retirement.data.projection.reason).toMatch(/contribution/i);
    // No status, no surplus — not a zero, not an "on track" by omission.
    expect(JSON.stringify(res.body.retirement.data.projection)).not.toMatch(/surplus|status/);

    expect(res.body.recommendations.map((r: { key: string }) => r.key)).toContain(
      'state_contribution',
    );
  });

  it('a plan WITHOUT a contribution still cannot project — stating other fields is not consent', async () => {
    // The gap a teeth check found: the "no plan at all" case exits early in `assumptionsFor`,
    // so it never exercises the resolution path. A family who sets a retirement age but has not
    // said what they save is the realistic middle state, and it is where an unstated
    // contribution would most easily be defaulted to zero without anyone noticing.
    const { token, householdId } = await consumer('ret_plan_nocontrib');
    expect((await plan(token, householdId, { retirementAge: 62 })).status).toBe(200);

    const res = await overview(token, householdId);
    expect(res.body.assumptions.retirementAge).toEqual({ value: 62, source: 'stated' });
    expect(res.body.assumptions.monthlyContributionMinor).toBeNull();
    expect(res.body.retirement.data.projection.available).toBe(false);
    expect(res.body.retirement.data.projection.reason).toMatch(/contribution/i);

    // And the same must hold on the dashboard, which reads the layer directly.
    const intel = await intelligence(token, householdId);
    expect(intel.body.retirement.data.projection.available).toBe(false);
  });

  it('a stated contribution of ZERO is a finding, not silence', async () => {
    // The other half of the distinction, exactly as Protection draws it.
    const { token, householdId } = await consumer('ret_zero');
    expect((await plan(token, householdId, { monthlyContributionMinor: 0 })).status).toBe(200);

    const res = await overview(token, householdId);
    expect(res.body.retirement.data.projection.available).toBe(true);
    expect(res.body.retirement.data.projection.data.monthlyContributionMinor).toBe(0);
    expect(res.body.retirement.data.projection.data.status).toBe('at_risk');
    expect(res.body.retirement.data.projection.data.surplusOrShortfallMinor).toBeLessThan(0);
  });

  it('the corpus excludes the family home — decision 1, observable', async () => {
    // ₹40L investments + ₹10L cash + ₹2Cr home. Planning against the house would treat ₹2.5Cr
    // as retirement money.
    //
    // **Rewritten deliberately in M5.14.** This test used to assert that a household with NO
    // stated plan saw ₹2.5Cr — the layer's old fallback of reconciled net worth, which includes
    // the home. M5.10 knew that was wrong and worked around it by having the plan supply a
    // corrected corpus, so the wart was pinned here as expected behaviour. It meant a family
    // without a plan read one corpus on /household and another on /household/retirement.
    //
    // The layer now uses the same definition as the planning surface, so the home is excluded
    // on BOTH paths — which is what this test's own name always claimed. The assertion is
    // strictly stronger than the one it replaces.
    const { token, householdId } = await consumer('ret_corpus');

    const INVESTABLE = rupees(5000000); // ₹40L + ₹10L, home excluded

    const before = await intelligence(token, householdId);
    expect(before.body.retirement.data.currentCorpusMinor).toBe(INVESTABLE);
    // Teeth: the home really is in this household, so the equality is not trivially true.
    expect(before.body.netWorth.data.netWorthMinor).toBeGreaterThan(rupees(20000000));

    await plan(token, householdId, { retirementAge: 60 });

    const after = await intelligence(token, householdId);
    expect(after.body.retirement.data.currentCorpusMinor).toBe(INVESTABLE);
    expect((await overview(token, householdId)).body.assumptions.currentCorpusMinor).toEqual({
      value: INVESTABLE,
      source: 'derived',
    });
    // Stating a plan no longer *corrects* the corpus — it was already right. Both surfaces agree
    // before and after, which is the property M5.14 exists to hold.
    expect(after.body.retirement.data.currentCorpusMinor).toBe(
      before.body.retirement.data.currentCorpusMinor,
    );
  });

  it('a stated plan reaches the intelligence layer and moves the figures', async () => {
    // The milestone's whole point: planning is part of the operating system, not a calculator.
    const { token, householdId } = await consumer('ret_path');
    const before = await intelligence(token, householdId);
    expect(before.body.retirement.data.usingDefaultAssumptions).toBe(true);
    const requiredBefore = before.body.retirement.data.requiredCorpusMinor;

    await plan(token, householdId, {
      retirementAge: 55,
      lifeExpectancy: 90,
      desiredAnnualIncomeMinor: rupees(2400000),
      monthlyContributionMinor: rupees(100000),
    });

    const after = await intelligence(token, householdId);
    expect(after.body.retirement.data.usingDefaultAssumptions).toBe(false);
    expect(after.body.retirement.data.retirementAge).toBe(55);
    expect(after.body.retirement.data.planningToAge).toBe(90);
    // Retiring 5 years earlier, funding 35 years instead of 25, on double the income target.
    expect(after.body.retirement.data.requiredCorpusMinor).toBeGreaterThan(requiredBefore);
    expect(after.body.retirement.data.projection.available).toBe(true);
    expect(after.body.retirement.data.projection.data.projectedFromContributionsMinor).toBeGreaterThan(0);
  });

  it('the planning surface and the dashboard cannot disagree', async () => {
    // Both must come from ONE computation. If the planning service ever assembled its own
    // input, this is where the two definitions would show up.
    const { token, householdId } = await consumer('ret_agree');
    await plan(token, householdId, { retirementAge: 62, monthlyContributionMinor: rupees(50000) });

    const fromPlanning = (await overview(token, householdId)).body.retirement;
    const fromDashboard = (await intelligence(token, householdId)).body.retirement;
    expect(fromPlanning).toEqual(fromDashboard);
  });

  it('omitting a field leaves the stored answer alone', async () => {
    const { token, householdId } = await consumer('ret_partial');
    await plan(token, householdId, { retirementAge: 58, monthlyContributionMinor: rupees(30000) });
    await plan(token, householdId, { retirementAge: 59 });

    const row = await prisma.retirementPlan.findUnique({ where: { householdId } });
    expect(row!.retirementAge).toBe(59);
    expect(Number(row!.monthlyContributionMinor)).toBe(rupees(30000));
    // One plan per household, guaranteed by the database.
    expect(await prisma.retirementPlan.count({ where: { householdId } })).toBe(1);
  });

  it('what-if is deterministic, comparable, and persists nothing', async () => {
    const { token, householdId } = await consumer('ret_whatif');
    await plan(token, householdId, { retirementAge: 60, monthlyContributionMinor: rupees(40000) });

    const body = {
      scenarios: [
        { type: 'retire_later', years: 5 },
        { type: 'increase_contribution', amountMinor: rupees(25000) },
      ],
    };
    const first = await http()
      .post(`/api/households/${householdId}/retirement/what-if`)
      .set(auth(token))
      .send(body);
    expect(first.status).toBe(201);
    expect(first.body.outcomes).toHaveLength(2);
    for (const o of first.body.outcomes) expect(o.deltaSurplusMinor).toBeGreaterThan(0);

    // Deterministic: the same request twice yields the same answer.
    const second = await http()
      .post(`/api/households/${householdId}/retirement/what-if`)
      .set(auth(token))
      .send(body);
    expect(second.body.outcomes).toEqual(first.body.outcomes);

    // And nothing was written — a simulation is not a decision.
    const row = await prisma.retirementPlan.findUnique({ where: { householdId } });
    expect(row!.retirementAge).toBe(60);
    expect(Number(row!.monthlyContributionMinor)).toBe(rupees(40000));
  });

  it('captures no snapshot — planning never touches the kernel', async () => {
    const { token, householdId } = await consumer('ret_nosnap');
    const before = await prisma.financialSnapshot.count({ where: { householdId } });

    await plan(token, householdId, { retirementAge: 61, monthlyContributionMinor: rupees(10000) });
    await overview(token, householdId);
    await http()
      .post(`/api/households/${householdId}/retirement/what-if`)
      .set(auth(token))
      .send({ scenarios: [{ type: 'retire_later', years: 2 }] });

    expect(await prisma.financialSnapshot.count({ where: { householdId } })).toBe(before);
  });

  it('is household-scoped, and refuses an actor who is not a member', async () => {
    const a = await consumer('ret_scope_a');
    const b = await consumer('ret_scope_b');

    expect((await overview(b.token, a.householdId)).status).toBe(404);
    expect((await plan(b.token, a.householdId, { retirementAge: 60 })).status).toBe(404);

    const client = await http()
      .post('/api/households')
      .set(auth(a.token))
      .send({ name: 'Client Family', baseCurrency: 'INR' });
    expect((await overview(a.token, client.body.id)).status).toBe(200);
    expect((await plan(a.token, client.body.id, { retirementAge: 60 })).status).toBe(403);
  });

  it('requires authentication', async () => {
    const { householdId } = await consumer('ret_anon');
    expect((await http().get(`/api/households/${householdId}/retirement`)).status).toBe(401);
  });

  it('rejects impossible plans rather than projecting nonsense', async () => {
    const { token, householdId } = await consumer('ret_validate');
    expect((await plan(token, householdId, { retirementAge: 5 })).status).toBe(400);
    expect((await plan(token, householdId, { preRetirementReturnPct: 95 })).status).toBe(400);
    expect((await plan(token, householdId, { monthlyContributionMinor: -1 })).status).toBe(400);
  });
});
