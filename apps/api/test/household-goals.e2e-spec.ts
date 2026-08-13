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

  it('a goal changes no figure — the snapshot carries no goals', async () => {
    // Stated as a test because "native goals" reads like "goals now count", and they do not.
    // When goals reach the snapshot this fails, which is the point: the parity gap in
    // early-warning-parity.e2e-spec.ts and this assertion must be revisited together.
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

    expect(snap.body.payload.goals).toBeUndefined();
    expect(after.body.wealthHealth.data.overall).toBe(before.body.wealthHealth.data.overall);
    expect(after.body.risk.data.topRisks).toEqual(before.body.risk.data.topRisks);
  });
});
