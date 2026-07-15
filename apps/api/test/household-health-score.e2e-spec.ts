import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/app.factory';

/**
 * M3-1 Financial Health Score. Verifies that the score is derived from an immutable
 * Financial Snapshot (never raw tables), is explainable (per-category metric/reason/
 * suggestion), reproducible (same snapshot ⇒ identical score even after mutations),
 * and scope/role gated. The scoring engine never mutates the kernel.
 */
describe('Household financial health score e2e', () => {
  let app: INestApplication;

  let adminToken: string;
  let owner1Token: string;
  let owner1Id: string;
  let advisorAToken: string;
  let advisorAId: string;
  const advisorAEmail = `hs_advA_${Date.now()}@example.com`;
  let analystToken: string;
  const analystEmail = `hs_analyst_${Date.now()}@example.com`;
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

    ({ token: owner1Token, id: owner1Id } = await registerUser(`hs_owner1_${ts}@example.com`));
    ({ token: advisorAToken, id: advisorAId } = await registerUser(advisorAEmail));
    ({ token: analystToken } = await registerUser(analystEmail));
    ({ token: outsiderToken } = await registerUser(`hs_outsider_${ts}@example.com`));

    firmA = (
      await request(app.getHttpServer())
        .post('/api/firms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Firm HS ${ts}`, ownerUserId: owner1Id })
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

    // A healthy household: ~6-month cash buffer + diversified assets, income > expense,
    // no debt ledger. Cash (₹3,00,000) ≈ 6× the ₹50,000 monthly expense.
    inrAccount = await addAccount({ name: 'HDFC Savings', type: 'bank', assetClass: 'cash', currency: 'INR', balanceMinor: 300_000_00 });
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

  it('returns "no snapshot" before any snapshot is captured', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/households/${h1}/health-score/current`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(res.body.available).toBe(false);
  });

  it('cannot persist a score without a snapshot', async () => {
    await request(app.getHttpServer())
      .post(`/api/households/${h1}/health-score`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({})
      .expect(400);
  });

  it('computes an explainable live score from the latest immutable snapshot', async () => {
    // Capture a Financial Snapshot first (the kernel).
    await request(app.getHttpServer())
      .post(`/api/households/${h1}/financial-snapshot`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({ cashflowPeriod: MONTH })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/api/households/${h1}/health-score/current`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(res.body.available).toBe(true);
    expect(res.body.live).toBe(true);
    expect(res.body.id).toBeUndefined(); // not persisted
    expect(res.body.scoreModelVersion).toBe('fhs-1.0.0');
    expect(res.body.overall).toBeGreaterThanOrEqual(0);
    expect(res.body.overall).toBeLessThanOrEqual(100);
    // Explainability: 5 categories, each with a metric, reason, and suggestion.
    expect(res.body.categories).toHaveLength(5);
    for (const c of res.body.categories) {
      expect(c.reason.length).toBeGreaterThan(0);
      expect(c.suggestion.length).toBeGreaterThan(0);
      expect(typeof c.metric.value).toBe('number');
    }
    // Healthy household with a 50% savings rate scores well.
    expect(res.body.overall).toBeGreaterThanOrEqual(70);
  });

  it('persists a score tied to a snapshot and lists it on the timeline', async () => {
    const persisted = await request(app.getHttpServer())
      .post(`/api/households/${h1}/health-score`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({})
      .expect(201);
    expect(persisted.body.id).toBeDefined();
    expect(persisted.body.snapshotId).toBeDefined();
    const scoreId = persisted.body.id;
    const frozenOverall = persisted.body.overall;

    const latest = await request(app.getHttpServer())
      .get(`/api/households/${h1}/health-score/latest`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(latest.body.id).toBe(scoreId);

    const timeline = await request(app.getHttpServer())
      .get(`/api/households/${h1}/health-score/timeline`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(timeline.body.map((r: { id: string }) => r.id)).toContain(scoreId);

    const byId = await request(app.getHttpServer())
      .get(`/api/households/${h1}/health-score/${scoreId}`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(byId.body.overall).toBe(frozenOverall);
  });

  it('is reproducible: the same snapshot yields the same score even after mutations', async () => {
    // Score the (still latest) snapshot now.
    const before = (
      await request(app.getHttpServer())
        .get(`/api/households/${h1}/health-score/current`)
        .set('Authorization', `Bearer ${advisorAToken}`)
        .expect(200)
    ).body;
    const snapId = before.snapshotId;

    // Mutate the household materially (add a big asset). The OLD snapshot is immutable,
    // so scoring that snapshot id must return the identical score.
    await addAccount({ name: 'New Gold', type: 'other_asset', assetClass: 'gold', currency: 'INR', balanceMinor: 500_000_00 });

    const afterSameSnap = (
      await request(app.getHttpServer())
        .get(`/api/households/${h1}/health-score/current?snapshotId=${snapId}`)
        .set('Authorization', `Bearer ${advisorAToken}`)
        .expect(200)
    ).body;
    expect(afterSameSnap.overall).toBe(before.overall);
    expect(afterSameSnap.categories).toEqual(before.categories);
  });

  it('enforces scope and role', async () => {
    // outsider sees nothing
    await request(app.getHttpServer())
      .get(`/api/households/${h1}/health-score/current`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(404);

    // analyst may read but not persist
    await request(app.getHttpServer())
      .get(`/api/households/${h1}/health-score/current`)
      .set('Authorization', `Bearer ${analystToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/households/${h1}/health-score`)
      .set('Authorization', `Bearer ${analystToken}`)
      .send({})
      .expect(403);
  });
});
