import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/app.factory';

/**
 * M3-2 Explainable Financial Health Engine. Verifies the read-only explanation layer:
 * it consumes an existing Financial Health Score (never recomputes), returns the
 * structured HealthExplanation (summary, breakdown, strengths, weaknesses,
 * recommendations, priority ranking, potential improvement, confidence, reason codes),
 * matches the score it explains, and is scope-gated. Nothing is persisted.
 */
describe('Household financial health explanation e2e', () => {
  let app: INestApplication;

  let adminToken: string;
  let owner1Token: string;
  let owner1Id: string;
  let advisorAToken: string;
  let advisorAId: string;
  const advisorAEmail = `he_advA_${Date.now()}@example.com`;
  let analystToken: string;
  const analystEmail = `he_analyst_${Date.now()}@example.com`;
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

    ({ token: owner1Token, id: owner1Id } = await registerUser(`he_owner1_${ts}@example.com`));
    ({ token: advisorAToken, id: advisorAId } = await registerUser(advisorAEmail));
    ({ token: analystToken } = await registerUser(analystEmail));
    ({ token: outsiderToken } = await registerUser(`he_outsider_${ts}@example.com`));

    firmA = (
      await request(app.getHttpServer())
        .post('/api/firms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Firm HE ${ts}`, ownerUserId: owner1Id })
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

    // Thin liquidity + concentration → at least one weakness / recommendation.
    inrAccount = await addAccount({ name: 'HDFC Savings', type: 'bank', assetClass: 'cash', currency: 'INR', balanceMinor: 50_000_00 });
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
      .send({ accountId: inrAccount, type: 'expense', category: 'housing', amountMinor: 50_000_00, currency: 'INR', occurredAt: at(2) })
      .expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns not-available before any snapshot exists', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/households/${h1}/health-score/explanation/current`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(res.body.available).toBe(false);
  });

  it('explains the current score with the full structured payload', async () => {
    await request(app.getHttpServer())
      .post(`/api/households/${h1}/financial-snapshot`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({ cashflowPeriod: MONTH })
      .expect(201);

    // The score it explains, for cross-checking.
    const scoreRes = await request(app.getHttpServer())
      .get(`/api/households/${h1}/health-score/current`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .get(`/api/households/${h1}/health-score/explanation/current`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(res.body.available).toBe(true);
    const e = res.body.explanation;
    // Explanation matches the score it explains (does not recompute a different number).
    expect(e.overall).toBe(scoreRes.body.overall);
    expect(e.band).toBe(scoreRes.body.band);
    expect(e.modelVersion).toBe(scoreRes.body.scoreModelVersion);
    // Structured payload the 8 questions map onto.
    expect(e.summary.length).toBeGreaterThan(0);
    expect(e.categoryBreakdown).toHaveLength(5);
    expect(Array.isArray(e.strengths)).toBe(true);
    expect(Array.isArray(e.weaknesses)).toBe(true);
    expect(e.weaknesses.length).toBeGreaterThan(0); // thin liquidity
    expect(e.recommendations.length).toBeGreaterThan(0);
    expect(e.priorityRanking[0].rank).toBe(1);
    expect(typeof e.potentialScoreImprovement).toBe('number');
    expect(e.potentialOverall).toBeLessThanOrEqual(100);
    expect(e.confidence).toBeGreaterThan(0);
    expect(Array.isArray(e.reasonCodes)).toBe(true);
    // A liquidity recommendation with a computed cash gap.
    const liq = e.recommendations.find((r: { affectedCategory: string }) => r.affectedCategory === 'liquidity');
    expect(liq).toBeDefined();
    expect(liq.financialImpact.gapMinor).toBe(6 * 50_000_00 - 50_000_00);
    expect(liq.reasonCode).toBe('INSUFFICIENT_EMERGENCY_FUND');
  });

  it('explains a persisted score by id and via latest', async () => {
    const persisted = await request(app.getHttpServer())
      .post(`/api/households/${h1}/health-score`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({})
      .expect(201);
    const scoreId = persisted.body.id;

    const byId = await request(app.getHttpServer())
      .get(`/api/households/${h1}/health-score/explanation/${scoreId}`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(byId.body.available).toBe(true);
    expect(byId.body.scoreId).toBe(scoreId);
    expect(byId.body.explanation.overall).toBe(persisted.body.overall);

    const latest = await request(app.getHttpServer())
      .get(`/api/households/${h1}/health-score/explanation/latest`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(latest.body.explanation.overall).toBe(persisted.body.overall);
  });

  it('is a read: available to any in-scope member (incl. analyst), 404 for outsiders', async () => {
    await request(app.getHttpServer())
      .get(`/api/households/${h1}/health-score/explanation/current`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/households/${h1}/health-score/explanation/current`)
      .set('Authorization', `Bearer ${analystToken}`)
      .expect(200);
  });
});
