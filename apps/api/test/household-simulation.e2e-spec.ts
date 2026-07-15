import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/app.factory';

/**
 * M3-3 Financial What-if Simulation Engine. Verifies the non-mutating simulation:
 * scenarios run against an immutable snapshot, improve/weaken categories with point
 * deltas, surface the best single action + top recommendation, list scenario types,
 * are scope-gated, and persist nothing (a later score read is unchanged).
 */
describe('Household what-if simulation e2e', () => {
  let app: INestApplication;

  let adminToken: string;
  let owner1Token: string;
  let owner1Id: string;
  let advisorAToken: string;
  let advisorAId: string;
  const advisorAEmail = `sim_advA_${Date.now()}@example.com`;
  let analystToken: string;
  const analystEmail = `sim_analyst_${Date.now()}@example.com`;
  let outsiderToken: string;

  let firmA: string;
  let h1: string;
  let inrAccount: string;

  const ts = Date.now();
  const MONTH = '2026-03';
  const at = (d: number) => `${MONTH}-${String(d).padStart(2, '0')}T00:00:00.000Z`;

  async function registerUser(email: string): Promise<{ token: string; id: string }> {
    const reg = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'Passw0rd1', fullName: 'Test User' });
    const token = reg.body.accessToken as string;
    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    return { token, id: me.body.id as string };
  }

  async function addMember(email: string, inviteeToken: string, firmRole: string) {
    await request(app.getHttpServer())
      .post(`/api/firms/${firmA}/invitations`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({ email, firmRole })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/firms/${firmA}/accept`)
      .set('Authorization', `Bearer ${inviteeToken}`)
      .expect(201);
  }

  async function addAccount(body: Record<string, unknown>): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/api/households/${h1}/accounts`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send(body)
      .expect(201);
    return res.body.id as string;
  }

  const asFirmA = (token: string) => ({ Authorization: `Bearer ${token}`, 'x-firm-id': firmA });

  beforeAll(async () => {
    app = await createApp();
    await app.init();

    adminToken = (
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@lifecapitalos.dev', password: 'Admin@12345' })
    ).body.accessToken;

    ({ token: owner1Token, id: owner1Id } = await registerUser(`sim_owner1_${ts}@example.com`));
    ({ token: advisorAToken, id: advisorAId } = await registerUser(advisorAEmail));
    ({ token: analystToken } = await registerUser(analystEmail));
    ({ token: outsiderToken } = await registerUser(`sim_outsider_${ts}@example.com`));

    firmA = (
      await request(app.getHttpServer())
        .post('/api/firms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Firm SIM ${ts}`, ownerUserId: owner1Id })
        .expect(201)
    ).body.id;
    await addMember(advisorAEmail, advisorAToken, 'ADVISOR');
    await addMember(analystEmail, analystToken, 'ANALYST');

    h1 = (
      await request(app.getHttpServer())
        .post('/api/households')
        .set(asFirmA(owner1Token))
        .send({ name: 'The Sharmas', advisorId: advisorAId, baseCurrency: 'INR' })
        .expect(201)
    ).body.id;

    // Weak savings + thin liquidity → scenarios have room to help.
    inrAccount = await addAccount({ name: 'HDFC Savings', type: 'bank', assetClass: 'cash', currency: 'INR', balanceMinor: 20_000_00 });
    await addAccount({ name: 'Equity', type: 'investment', assetClass: 'equity', currency: 'INR', balanceMinor: 400_000_00 });
    await addAccount({ name: 'Debt fund', type: 'investment', assetClass: 'debt', currency: 'INR', balanceMinor: 300_000_00 });
    await request(app.getHttpServer())
      .post(`/api/households/${h1}/cashflow`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({ accountId: inrAccount, type: 'income', category: 'salary', amountMinor: 100_000_00, currency: 'INR', occurredAt: at(1) })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/households/${h1}/cashflow`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({ accountId: inrAccount, type: 'expense', category: 'housing', amountMinor: 90_000_00, currency: 'INR', occurredAt: at(2) })
      .expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  function simulate(token: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`/api/households/${h1}/simulation`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  it('lists the supported scenario types', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/households/${h1}/simulation/scenario-types`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(res.body.simulationEngineVersion).toBe('sim-1.0.0');
    const types = res.body.scenarioTypes.map((s: { type: string }) => s.type);
    expect(types).toContain('repay_debt');
    expect(types).toContain('increase_emergency_fund');
    expect(types.length).toBeGreaterThanOrEqual(10);
  });

  it('returns not-available before any snapshot exists', async () => {
    const res = await simulate(advisorAToken, { scenarios: [{ type: 'reduce_expenses', params: { monthlyAmountMinor: 1000 } }] }).expect(201);
    expect(res.body.available).toBe(false);
  });

  it('simulates a scenario against the immutable snapshot and improves the score', async () => {
    await request(app.getHttpServer())
      .post(`/api/households/${h1}/financial-snapshot`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({ cashflowPeriod: MONTH })
      .expect(201);

    const res = await simulate(advisorAToken, {
      scenarios: [
        { type: 'increase_emergency_fund', params: { amountMinor: 300_000_00, fromClass: 'equity' } },
        { type: 'reduce_expenses', params: { monthlyAmountMinor: 30_000_00 } },
      ],
    }).expect(201);

    expect(res.body.available).toBe(true);
    const r = res.body.result;
    expect(r.metadata.simulationEngineVersion).toBe('sim-1.0.0');
    expect(r.metadata.deterministic).toBe(true);
    expect(r.summary.overallAfter).toBeGreaterThan(r.summary.overallBefore);
    expect(r.categoryImpacts).toHaveLength(5);
    const liq = r.categoryImpacts.find((c: { key: string }) => c.key === 'liquidity');
    expect(liq.delta).toBeGreaterThan(0);
    expect(liq.direction).toBe('improved');
    expect(r.bestSingleAction).toBeTruthy();
    expect(typeof r.bestSingleAction.overallDelta).toBe('number');
    // advisor-grade output: recommendations present as structured next actions
    expect(Array.isArray(r.recommendations)).toBe(true);
  });

  it('rejects an unknown scenario type (validation)', async () => {
    await simulate(advisorAToken, { scenarios: [{ type: 'teleport_money', params: {} }] }).expect(400);
    await simulate(advisorAToken, { scenarios: [] }).expect(400);
  });

  it('persists nothing: no health score is created by simulating', async () => {
    const before = await request(app.getHttpServer())
      .get(`/api/households/${h1}/health-score/timeline`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    await simulate(advisorAToken, { scenarios: [{ type: 'repay_debt', params: { amountMinor: 10_000_00 } }] }).expect(201);
    const after = await request(app.getHttpServer())
      .get(`/api/households/${h1}/health-score/timeline`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(after.body.length).toBe(before.body.length);
  });

  it('is non-mutating: available to analyst, 404 for outsiders', async () => {
    await simulate(outsiderToken, { scenarios: [{ type: 'reduce_expenses', params: { monthlyAmountMinor: 1000 } }] }).expect(404);
    await simulate(analystToken, { scenarios: [{ type: 'reduce_expenses', params: { monthlyAmountMinor: 1000 } }] }).expect(201);
  });
});
