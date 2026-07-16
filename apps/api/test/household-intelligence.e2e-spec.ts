import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/app.factory';

/**
 * M5 Financial Intelligence Layer e2e. Verifies that the canonical intelligence object is
 * composed from an immutable Financial Snapshot (never raw tables), degrades gracefully
 * before a snapshot exists, is reproducible against a pinned snapshot even after the
 * household mutates, and is scope-gated. The layer never mutates the kernel.
 */
describe('Household financial intelligence e2e', () => {
  let app: INestApplication;

  let adminToken: string;
  let owner1Token: string;
  let owner1Id: string;
  let advisorAToken: string;
  let advisorAId: string;
  const advisorAEmail = `fi_advA_${Date.now()}@example.com`;
  let analystToken: string;
  const analystEmail = `fi_analyst_${Date.now()}@example.com`;
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

    ({ token: owner1Token, id: owner1Id } = await registerUser(`fi_owner1_${ts}@example.com`));
    ({ token: advisorAToken, id: advisorAId } = await registerUser(advisorAEmail));
    ({ token: analystToken } = await registerUser(analystEmail));
    ({ token: outsiderToken } = await registerUser(`fi_outsider_${ts}@example.com`));

    firmA = (
      await request(app.getHttpServer())
        .post('/api/firms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Firm FI ${ts}`, ownerUserId: owner1Id })
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

    // A healthy, diversified household with income > expense.
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

  it('returns "no snapshot" before any snapshot is captured (graceful degradation)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/households/${h1}/intelligence/current`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(res.body.available).toBe(false);
    expect(res.body.reason).toBe('no snapshot captured');
  });

  it('composes the canonical intelligence object from the latest immutable snapshot', async () => {
    await request(app.getHttpServer())
      .post(`/api/households/${h1}/financial-snapshot`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({ cashflowPeriod: MONTH })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/api/households/${h1}/intelligence/current`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);

    expect(res.body.available).toBe(true);
    // Provenance ties back to the immutable snapshot + reused score model.
    expect(res.body.meta.snapshotId).toBeDefined();
    expect(res.body.meta.schemaVersion).toBe(1);
    expect(res.body.meta.scoreModelVersion).toBe('fhs-1.0.0');
    expect(res.body.meta.engineVersion).toMatch(/^m5-fil-/);
    // Composed sections present.
    expect(res.body.netWorth.available).toBe(true);
    expect(res.body.wealthHealth.available).toBe(true);
    expect(res.body.emergencyFund.available).toBe(true);
    expect(res.body.risk.available).toBe(true);
    expect(Array.isArray(res.body.recommendedActions)).toBe(true);
    // Name resolved at the decrypted boundary.
    expect(res.body.household.name).toBe('The Sharmas');
    // Insurance cover is not tracked yet → reported honestly, not fabricated.
    if (res.body.insurance.available) {
      expect(res.body.insurance.data.coverTracked).toBe(false);
    }
  });

  it('is reproducible: pinning a snapshotId yields identical intelligence after mutation', async () => {
    const before = (
      await request(app.getHttpServer())
        .get(`/api/households/${h1}/intelligence/current`)
        .set('Authorization', `Bearer ${advisorAToken}`)
        .expect(200)
    ).body;
    const snapId = before.meta.snapshotId;

    // Mutate the household materially; the OLD snapshot is immutable.
    await addAccount({ name: 'New Gold', type: 'other_asset', assetClass: 'gold', currency: 'INR', balanceMinor: 500_000_00 });

    const afterSameSnap = (
      await request(app.getHttpServer())
        .get(`/api/households/${h1}/intelligence/current?snapshotId=${snapId}`)
        .set('Authorization', `Bearer ${advisorAToken}`)
        .expect(200)
    ).body;
    expect(afterSameSnap.netWorth).toEqual(before.netWorth);
    expect(afterSameSnap.wealthHealth).toEqual(before.wealthHealth);
    expect(afterSameSnap.meta.snapshotId).toBe(snapId);
  });

  it('enforces scope (outsider 404) and allows read for in-scope roles including ANALYST', async () => {
    await request(app.getHttpServer())
      .get(`/api/households/${h1}/intelligence/current`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(404);

    // ANALYST is read-only firm-wide; the intelligence layer is read-only, so it may read.
    await request(app.getHttpServer())
      .get(`/api/households/${h1}/intelligence/current`)
      .set('Authorization', `Bearer ${analystToken}`)
      .expect(200);
  });

  it('404s an unknown snapshotId', async () => {
    await request(app.getHttpServer())
      .get(`/api/households/${h1}/intelligence/current?snapshotId=does-not-exist`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(404);
  });
});
