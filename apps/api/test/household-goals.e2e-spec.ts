import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Household goals (M5.8 PR 2).
 *
 * See `docs/M5_8_GOALS_CHARTS_ARCHITECTURE.md`.
 *
 * `Goal` already carried `firmId`, `householdId` and `memberId` from M1b, so this milestone added
 * an API rather than a schema change. These tests assert the scoping that makes a goal the
 * *household's* rather than only one person's, and the boundary that keeps an advisor from filing
 * a client's goal under their own name.
 */
describe('Household goals (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const PASSWORD = 'Goals1passw';
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
  const inAYear = () => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString();
  };

  async function newConsumer(prefix: string) {
    const email = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`;
    const reg = await http()
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, fullName: 'Goal Setter' });
    expect(reg.status).toBe(201);
    const token = reg.body.accessToken as string;
    const ws = await http().post('/api/onboarding/household').set(auth(token)).send({});
    expect(ws.status).toBe(201);
    return { token, householdId: ws.body.householdId as string, firmId: ws.body.firmId as string };
  }

  const goals = (t: string, id: string) => http().get(`/api/households/${id}/goals`).set(auth(t));

  const addGoal = (t: string, id: string, over: Record<string, unknown> = {}) =>
    http()
      .post(`/api/households/${id}/goals`)
      .set(auth(t))
      .send({
        name: 'New home',
        type: 'home_purchase',
        currency: 'INR',
        targetAmountMinor: rupees(5000000),
        currentAmountMinor: rupees(500000),
        targetDate: inAYear(),
        ...over,
      });

  it('creates, lists, edits and removes a goal', async () => {
    const { token, householdId } = await newConsumer('goal_crud');

    const created = await addGoal(token, householdId);
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('New home');
    expect(created.body.targetAmountMinor).toBe(rupees(5000000));

    const listed = await goals(token, householdId);
    expect(listed.body.map((g: { name: string }) => g.name)).toContain('New home');

    const edited = await http()
      .patch(`/api/households/${householdId}/goals/${created.body.id}`)
      .set(auth(token))
      .send({ currentAmountMinor: rupees(900000) });
    expect(edited.status).toBe(200);
    expect(edited.body.currentAmountMinor).toBe(rupees(900000));

    const removed = await http()
      .delete(`/api/households/${householdId}/goals/${created.body.id}`)
      .set(auth(token));
    expect(removed.status).toBe(200);
    expect((await goals(token, householdId)).body).toHaveLength(0);
  });

  it('stores the goal against the household AND the firm, not only the user', async () => {
    // This is what makes it the family's goal rather than one person's. Asserted on the row,
    // because the serialized response would look identical either way.
    const { token, householdId, firmId } = await newConsumer('goal_scope');
    const created = await addGoal(token, householdId);

    const row = await prisma.goal.findUnique({ where: { id: created.body.id } });
    expect(row).not.toBeNull();
    expect(row!.householdId).toBe(householdId);
    expect(row!.firmId).toBe(firmId);
    // `Goal.userId` is NOT NULL in the model, so it is set too — for a consumer that is
    // themselves, which is unambiguous.
    expect(row!.userId).toBeTruthy();
  });

  it('is household-scoped — another household is a 404', async () => {
    const a = await newConsumer('goal_scope_a');
    const b = await newConsumer('goal_scope_b');
    const mine = await addGoal(a.token, a.householdId, { name: 'Private goal' });

    expect((await goals(b.token, a.householdId)).status).toBe(404);
    const cross = await http()
      .patch(`/api/households/${b.householdId}/goals/${mine.body.id}`)
      .set(auth(b.token))
      .send({ name: 'Renamed' });
    expect(cross.status).toBe(404);
  });

  it('refuses to file a goal under someone who is not a member of the household', async () => {
    // The boundary from §1.1 of the design note. `Goal.userId` is NOT NULL, so a goal created by
    // an advisor on a client's household would name the ADVISOR — their client's money filed
    // under their own name, and visible in their own retail goal list. That is the confusion
    // that put advisors inside client households in #52 and #54, so the service refuses instead
    // of guessing.
    const advisor = await newConsumer('goal_advisor');
    const client = await http()
      .post('/api/households')
      .set(auth(advisor.token))
      .send({ name: 'Client Family', baseCurrency: 'INR' });
    expect(client.status).toBe(201);

    // The advisor can reach the household — it is in their firm — but must not author a goal in it.
    const listed = await goals(advisor.token, client.body.id);
    expect(listed.status).toBe(200);

    const rejected = await addGoal(advisor.token, client.body.id);
    expect(rejected.status).toBe(403);
    expect((await goals(advisor.token, client.body.id)).body).toHaveLength(0);
  });

  it('requires authentication', async () => {
    const { householdId } = await newConsumer('goal_anon');
    expect((await http().get(`/api/households/${householdId}/goals`)).status).toBe(401);
  });

  it('a goal now moves a figure — without touching the kernel or the score (M5.11)', async () => {
    // This test used to assert the opposite, and failing was its purpose: M5.8 shipped goals
    // that changed nothing, and the assertion was written so that closing the gap could not
    // pass silently. M5.11 closes it. What survives unchanged is deliberate and still pinned
    // below — the snapshot payload is frozen, and what "health" means is a separate decision.
    const { token, householdId } = await newConsumer('goal_nofigure');
    const cash = await http()
      .post(`/api/households/${householdId}/accounts`)
      .set(auth(token))
      .send({
        name: 'Cash & savings',
        type: 'bank',
        assetClass: 'cash',
        currency: 'INR',
        balanceMinor: rupees(900000),
        isLiability: false,
      });
    const occurredAt = new Date().toISOString();
    for (const f of [
      { type: 'income', category: 'salary', amountMinor: rupees(300000) },
      { type: 'expense', category: 'living', amountMinor: rupees(75000) },
    ]) {
      await http()
        .post(`/api/households/${householdId}/cashflow`)
        .set(auth(token))
        .send({ accountId: cash.body.id, currency: 'INR', occurredAt, ...f });
    }
    await http().post(`/api/households/${householdId}/financial-snapshot`).set(auth(token)).send({});
    const before = await http()
      .get(`/api/households/${householdId}/intelligence/current`)
      .set(auth(token));

    await addGoal(token, householdId, { targetAmountMinor: rupees(20000000) });
    const snap = await http()
      .post(`/api/households/${householdId}/financial-snapshot`)
      .set(auth(token))
      .send({});
    const after = await http()
      .get(`/api/households/${householdId}/intelligence/current`)
      .set(auth(token));

    const goalRisk = (res: { body: { risk: { data: { topRisks: { key: string }[] } } } }) =>
      res.body.risk.data.topRisks.find((r) => r.key === 'goal_slippage');

    // Before: no goals, so nothing to be behind on.
    expect(goalRisk(before)).toBeUndefined();
    // After: a ₹2,00,00,000 goal with nothing saved is entirely unfunded, and says so.
    expect(goalRisk(after)).toMatchObject({ key: 'goal_slippage', severity: 'high' });

    // Still true, and still deliberate:
    // 1. the frozen snapshot payload gained no goals section (ADR-012, schemaVersion 1);
    expect(snap.body.payload.goals).toBeUndefined();
    // 2. the Wealth Health Score is unmoved — adding a category re-bands every score a family
    //    has already been shown, which is M5.12's decision to make, not this milestone's.
    expect(after.body.wealthHealth.data.overall).toBe(before.body.wealthHealth.data.overall);
  });

  it('funding the goal clears the signal — it tracks the family, not the row', async () => {
    // The failure mode this guards against is a signal that fires once a goal exists and never
    // stops, which is indistinguishable from a working one until a family fixes something.
    const { token, householdId } = await newConsumer('goal_clears');
    await http()
      .post(`/api/households/${householdId}/accounts`)
      .set(auth(token))
      .send({
        name: 'Cash & savings',
        type: 'bank',
        assetClass: 'cash',
        currency: 'INR',
        balanceMinor: rupees(900000),
        isLiability: false,
      });
    await http().post(`/api/households/${householdId}/financial-snapshot`).set(auth(token)).send({});

    const created = await addGoal(token, householdId, { targetAmountMinor: rupees(1000000) });
    const goalId = created.body.id as string;
    const risks = async () =>
      (
        await http().get(`/api/households/${householdId}/intelligence/current`).set(auth(token))
      ).body.risk.data.topRisks.map((r: { key: string }) => r.key);

    expect(await risks()).toContain('goal_slippage');

    // Fund it fully. The gap closes, so the signal must go green and drop out of topRisks.
    const funded = await http()
      .patch(`/api/households/${householdId}/goals/${goalId}`)
      .set(auth(token))
      .send({ currentAmountMinor: rupees(1000000) });
    expect(funded.status).toBe(200);
    expect(funded.body.plan.slippage).toBe(0);

    expect(await risks()).not.toContain('goal_slippage');
  });

  it('the goals list reports where each goal stands, computed server-side', async () => {
    // The web page renders these; it must never compute them. V1's RetirementCalculator doing
    // arithmetic in React is the pattern this project keeps moving away from.
    const { token, householdId } = await newConsumer('goal_plan');
    await addGoal(token, householdId, {
      targetAmountMinor: rupees(1000000),
      currentAmountMinor: 0,
    });

    const [goal] = (await goals(token, householdId)).body;
    expect(goal.plan).toMatchObject({
      monthsRemaining: expect.any(Number),
      gapMinor: expect.any(Number),
      monthlySipRequiredMinor: expect.any(Number),
      progress: expect.any(Number),
      slippage: expect.any(Number),
    });
    // Nothing saved yet: the whole target is unfunded, and a real SIP is required to close it.
    expect(goal.plan.slippage).toBe(1);
    expect(goal.plan.gapMinor).toBeGreaterThan(0);
    expect(goal.plan.monthlySipRequiredMinor).toBeGreaterThan(0);
    expect(goal.plan.monthsRemaining).toBeGreaterThanOrEqual(1);
  });
});
