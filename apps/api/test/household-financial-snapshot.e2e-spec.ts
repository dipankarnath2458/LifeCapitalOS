import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { StaticFxRateProvider, convertMinor } from '@lcos/core';
import { createApp } from '../src/app.factory';

/**
 * M2-6 Household Financial Snapshot seam (the financial kernel). Verifies that a
 * snapshot composes M2-2..M2-5 into the base currency (asserted against the same core
 * FX), that stored snapshots are IMMUTABLE (byte-identical after later mutations), that
 * `/current` is a live preview, versioning is stamped, householdEquity reconciles net
 * worth + debt, and scope/role gating holds.
 */
describe('Household financial snapshot e2e', () => {
  let app: INestApplication;
  const fx = new StaticFxRateProvider();

  let adminToken: string;
  let owner1Token: string;
  let owner1Id: string;
  let advisorAToken: string;
  let advisorAId: string;
  const advisorAEmail = `fs_advA_${Date.now()}@example.com`;
  let analystToken: string;
  const analystEmail = `fs_analyst_${Date.now()}@example.com`;
  let outsiderToken: string;

  let firmA: string;
  let h1: string; // INR base
  let inrAccount: string;
  let usdAccount: string;

  const ts = Date.now();
  const MONTH = '2026-03';
  const at = (d: number) => `${MONTH}-${String(d).padStart(2, '0')}T00:00:00.000Z`;

  const USD_ASSET = 1_000_000; // $10,000
  const INR_ASSET = 50_000_000; // ₹5,00,000
  const HOME_DEBT = 30_000_000; // ₹3,00,000 debt (ledger)

  const usdAssetInr = convertMinor(USD_ASSET, 'USD', 'INR', fx);
  const expectedAssets = usdAssetInr + INR_ASSET;

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

    ({ token: owner1Token, id: owner1Id } = await registerUser(`fs_owner1_${ts}@example.com`));
    ({ token: advisorAToken, id: advisorAId } = await registerUser(advisorAEmail));
    ({ token: analystToken } = await registerUser(analystEmail));
    ({ token: outsiderToken } = await registerUser(`fs_outsider_${ts}@example.com`));

    firmA = (
      await request(app.getHttpServer())
        .post('/api/firms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Firm FS ${ts}`, ownerUserId: owner1Id })
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

    usdAccount = await addAccount({
      name: 'US Brokerage',
      type: 'investment',
      assetClass: 'equity',
      currency: 'USD',
      balanceMinor: USD_ASSET,
    });
    inrAccount = await addAccount({
      name: 'HDFC Savings',
      type: 'bank',
      assetClass: 'cash',
      currency: 'INR',
      balanceMinor: INR_ASSET,
    });
    // A cashflow transaction + an active debt so the snapshot composes all engines.
    await request(app.getHttpServer())
      .post(`/api/households/${h1}/cashflow`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({ accountId: inrAccount, type: 'income', category: 'salary', amountMinor: 100_000_00, currency: 'INR', occurredAt: at(1) })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/households/${h1}/debts`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({ name: 'Home Loan', type: 'home_loan', secured: true, currency: 'INR', principalMinor: HOME_DEBT, annualInterestRatePct: 8, minimumPaymentMinor: 25_000_00 })
      .expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('previews the live composed position (base currency, not persisted)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/households/${h1}/financial-snapshot/current?period=${MONTH}`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(res.body.live).toBe(true);
    expect(res.body.id).toBeUndefined(); // not a stored snapshot
    expect(res.body.currency).toBe('INR');
    expect(res.body.schemaVersion).toBe(1);
    expect(res.body.payload.netWorth.assetsMinor).toBe(expectedAssets);
    expect(res.body.payload.debt.totalOutstandingMinor).toBe(HOME_DEBT);
    expect(res.body.payload.cashflowSummary.incomeMinor).toBe(100_000_00);
  });

  it('captures an immutable snapshot with versioning, checksum and reconciliation', async () => {
    const snap = await request(app.getHttpServer())
      .post(`/api/households/${h1}/financial-snapshot`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({ cashflowPeriod: MONTH })
      .expect(201);
    expect(snap.body.id).toBeDefined();
    expect(snap.body.snapshotVersion).toBe(1);
    expect(snap.body.schemaVersion).toBe(1);
    expect(snap.body.engineVersion).toMatch(/^m2-6\./);
    expect(snap.body.fxVersion).toBe('static-v1');
    expect(snap.body.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(snap.body.status).toBe('active');
    // householdEquity reconciles net worth and the debt ledger (ADR-012).
    const eq = snap.body.payload.householdEquity;
    expect(eq.netWorthMinor).toBe(expectedAssets); // no liability accounts here
    expect(eq.totalDebtMinor).toBe(HOME_DEBT);
    expect(eq.reconciledEquityMinor).toBe(expectedAssets - HOME_DEBT);
  });

  it('freezes stored snapshots: later mutations never rewrite a captured snapshot', async () => {
    const before = (
      await request(app.getHttpServer())
        .get(`/api/households/${h1}/financial-snapshot/latest`)
        .set('Authorization', `Bearer ${advisorAToken}`)
        .expect(200)
    ).body;
    const frozenChecksum = before.checksum;
    const frozenNetWorth = before.payload.netWorth.netWorthMinor;

    // Materially change the household: add a big asset.
    await addAccount({ name: 'Extra', type: 'cash', assetClass: 'cash', currency: 'INR', balanceMinor: 20_000_000 });

    // `/current` moves…
    const current = await request(app.getHttpServer())
      .get(`/api/households/${h1}/financial-snapshot/current?period=${MONTH}`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(current.body.payload.netWorth.netWorthMinor).toBe(frozenNetWorth + 20_000_000);

    // …but the stored snapshot is byte-identical (immutable).
    const after = await request(app.getHttpServer())
      .get(`/api/households/${h1}/financial-snapshot/${before.id}`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(after.body.checksum).toBe(frozenChecksum);
    expect(after.body.payload.netWorth.netWorthMinor).toBe(frozenNetWorth);
  });

  it('lists the snapshot timeline with headline figures', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/households/${h1}/financial-snapshot/timeline`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].totalDebtMinor).toBe(HOME_DEBT);
    expect(res.body[0].netWorthMinor).toBe(expectedAssets);
  });

  it('increments snapshotVersion per household', async () => {
    const snap = await request(app.getHttpServer())
      .post(`/api/households/${h1}/financial-snapshot`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({ cashflowPeriod: MONTH })
      .expect(201);
    expect(snap.body.snapshotVersion).toBe(2);
  });

  it('enforces scope and role', async () => {
    // outsider / non-member sees nothing
    await request(app.getHttpServer())
      .get(`/api/households/${h1}/financial-snapshot/latest`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(404);

    // analyst may read but not capture
    await request(app.getHttpServer())
      .get(`/api/households/${h1}/financial-snapshot/current`)
      .set('Authorization', `Bearer ${analystToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/households/${h1}/financial-snapshot`)
      .set('Authorization', `Bearer ${analystToken}`)
      .send({})
      .expect(403);
  });
});
