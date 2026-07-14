import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { StaticFxRateProvider, convertMinor } from '@lcos/core';
import { createApp } from '../src/app.factory';

/**
 * M2-3 Household net worth & snapshots (MOD-4.2). Verifies multi-currency
 * consolidation to the household base currency (asserted against the same core FX),
 * immutable snapshot capture + timeline, and scope/role gating.
 */
describe('Household net worth e2e', () => {
  let app: INestApplication;
  const fx = new StaticFxRateProvider(); // matches FxService defaults (no override in tests)

  let adminToken: string;
  let owner1Token: string;
  let owner1Id: string;
  let advisorAToken: string;
  let advisorAId: string;
  const advisorAEmail = `nw_advA_${Date.now()}@example.com`;
  let analystToken: string;
  const analystEmail = `nw_analyst_${Date.now()}@example.com`;
  let outsiderToken: string;

  let firmA: string;
  let h1: string; // INR base, advisor A

  const ts = Date.now();

  // Balances used to build the household (native currency, minor units).
  const USD_ASSET = 1_000_000; // $10,000.00
  const INR_ASSET = 50_000_000; // ₹500,000.00
  const INR_LIABILITY = 20_000_000; // ₹200,000.00

  const expectedAssets = convertMinor(USD_ASSET, 'USD', 'INR', fx) + INR_ASSET;
  const expectedLiabilities = INR_LIABILITY;
  const expectedNetWorth = expectedAssets - expectedLiabilities;

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

  async function addAccount(body: Record<string, unknown>) {
    await request(app.getHttpServer())
      .post(`/api/households/${h1}/accounts`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send(body)
      .expect(201);
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

    ({ token: owner1Token, id: owner1Id } = await registerUser(`nw_owner1_${ts}@example.com`));
    ({ token: advisorAToken, id: advisorAId } = await registerUser(advisorAEmail));
    ({ token: analystToken } = await registerUser(analystEmail));
    ({ token: outsiderToken } = await registerUser(`nw_outsider_${ts}@example.com`));

    firmA = (
      await request(app.getHttpServer())
        .post('/api/firms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Firm A ${ts}`, ownerUserId: owner1Id })
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

    await addAccount({
      name: 'US Brokerage',
      type: 'investment',
      assetClass: 'equity',
      currency: 'USD',
      balanceMinor: USD_ASSET,
    });
    await addAccount({
      name: 'HDFC Savings',
      type: 'bank',
      assetClass: 'cash',
      currency: 'INR',
      balanceMinor: INR_ASSET,
    });
    await addAccount({
      name: 'Home Loan',
      type: 'loan',
      currency: 'INR',
      balanceMinor: INR_LIABILITY,
      isLiability: true,
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('consolidates multi-currency accounts to the household base currency', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/households/${h1}/net-worth/current`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(res.body.currency).toBe('INR');
    expect(res.body.assetsMinor).toBe(expectedAssets);
    expect(res.body.liabilitiesMinor).toBe(expectedLiabilities);
    expect(res.body.netWorthMinor).toBe(expectedNetWorth);
    expect(res.body.accountCount).toBe(3);
  });

  it('captures an immutable snapshot and returns it on the timeline', async () => {
    const snap = await request(app.getHttpServer())
      .post(`/api/households/${h1}/net-worth/snapshot`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(201);
    expect(snap.body.netWorthMinor).toBe(expectedNetWorth);
    expect(snap.body.currency).toBe('INR');
    const snapId = snap.body.id;

    const timeline = await request(app.getHttpServer())
      .get(`/api/households/${h1}/net-worth/timeline`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(timeline.body.map((s: { id: string }) => s.id)).toContain(snapId);
    expect(timeline.body.at(-1).netWorthMinor).toBe(expectedNetWorth);
  });

  it('freezes snapshots: a later account change does not rewrite a past snapshot', async () => {
    const before = (
      await request(app.getHttpServer())
        .get(`/api/households/${h1}/net-worth/timeline`)
        .set('Authorization', `Bearer ${advisorAToken}`)
    ).body;
    const frozen = before.at(-1).netWorthMinor;

    // Add a new asset — `current` moves, but the existing snapshot must not.
    await addAccount({
      name: 'Extra Cash',
      type: 'cash',
      assetClass: 'cash',
      currency: 'INR',
      balanceMinor: 10_000_000,
    });
    const current = await request(app.getHttpServer())
      .get(`/api/households/${h1}/net-worth/current`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(current.body.netWorthMinor).toBe(expectedNetWorth + 10_000_000);

    const after = (
      await request(app.getHttpServer())
        .get(`/api/households/${h1}/net-worth/timeline`)
        .set('Authorization', `Bearer ${advisorAToken}`)
    ).body;
    expect(after.at(0).netWorthMinor).toBe(frozen); // earlier snapshot unchanged
  });

  it('enforces scope and role', async () => {
    // out-of-scope / non-member see nothing
    await request(app.getHttpServer())
      .get(`/api/households/${h1}/net-worth/current`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(404);

    // analyst may read but not capture a snapshot
    await request(app.getHttpServer())
      .get(`/api/households/${h1}/net-worth/current`)
      .set('Authorization', `Bearer ${analystToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/households/${h1}/net-worth/snapshot`)
      .set('Authorization', `Bearer ${analystToken}`)
      .expect(403);
  });
});
