import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { StaticFxRateProvider, convertMinor } from '@lcos/core';
import { createApp } from '../src/app.factory';

/**
 * M2-4 Household cashflow & budget engine. Verifies household-scoped transaction CRUD,
 * multi-currency monthly summary/timeline (asserted against the same core FX),
 * budget-vs-actual, transfer/adjustment exclusion from income/expense, and
 * scope/role gating (outsider 404, analyst read-only).
 */
describe('Household cashflow & budget e2e', () => {
  let app: INestApplication;
  const fx = new StaticFxRateProvider(); // matches FxService defaults (no override in tests)

  let adminToken: string;
  let owner1Token: string;
  let owner1Id: string;
  let advisorAToken: string;
  let advisorAId: string;
  const advisorAEmail = `cf_advA_${Date.now()}@example.com`;
  let analystToken: string;
  const analystEmail = `cf_analyst_${Date.now()}@example.com`;
  let outsiderToken: string;

  let firmA: string;
  let h1: string; // INR base
  let inrAccount: string;
  let usdAccount: string;

  const ts = Date.now();
  const MONTH = '2026-03';
  const at = (day: number) => `${MONTH}-${String(day).padStart(2, '0')}T00:00:00.000Z`;

  // Amounts (native, minor units).
  const SALARY_INR = 100_000_00; // ₹100,000
  const HOUSING_INR = 40_000_00; // ₹40,000
  const LIFESTYLE_USD = 1_000_00; // $1,000
  const TRANSFER_INR = 25_000_00; // excluded
  const ADJUST_INR = 5_000_00; // excluded

  const lifestyleInr = convertMinor(LIFESTYLE_USD, 'USD', 'INR', fx);
  const expectedIncome = SALARY_INR;
  const expectedExpense = HOUSING_INR + lifestyleInr;
  const expectedNet = expectedIncome - expectedExpense;

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

  function addTx(token: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`/api/households/${h1}/cashflow`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
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

    ({ token: owner1Token, id: owner1Id } = await registerUser(`cf_owner1_${ts}@example.com`));
    ({ token: advisorAToken, id: advisorAId } = await registerUser(advisorAEmail));
    ({ token: analystToken } = await registerUser(analystEmail));
    ({ token: outsiderToken } = await registerUser(`cf_outsider_${ts}@example.com`));

    firmA = (
      await request(app.getHttpServer())
        .post('/api/firms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Firm CF ${ts}`, ownerUserId: owner1Id })
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

    inrAccount = await addAccount({
      name: 'HDFC Savings',
      type: 'bank',
      assetClass: 'cash',
      currency: 'INR',
      balanceMinor: 0,
    });
    usdAccount = await addAccount({
      name: 'US Brokerage',
      type: 'investment',
      assetClass: 'equity',
      currency: 'USD',
      balanceMinor: 0,
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('records transactions of every type in native currency', async () => {
    const income = await addTx(advisorAToken, {
      accountId: inrAccount,
      type: 'income',
      category: 'salary',
      amountMinor: SALARY_INR,
      currency: 'INR',
      occurredAt: at(1),
    }).expect(201);
    expect(income.body.type).toBe('income');
    expect(income.body.currency).toBe('INR');
    expect(income.body.baseCurrency).toBe('INR');
    expect(income.body.status).toBe('cleared');

    await addTx(advisorAToken, {
      accountId: inrAccount,
      type: 'expense',
      category: 'housing',
      amountMinor: HOUSING_INR,
      currency: 'INR',
      occurredAt: at(2),
    }).expect(201);

    await addTx(advisorAToken, {
      accountId: usdAccount,
      type: 'expense',
      category: 'lifestyle',
      amountMinor: LIFESTYLE_USD,
      currency: 'USD',
      occurredAt: at(3),
    }).expect(201);

    await addTx(advisorAToken, {
      accountId: inrAccount,
      type: 'transfer',
      category: 'savings',
      amountMinor: TRANSFER_INR,
      currency: 'INR',
      occurredAt: at(4),
    }).expect(201);

    await addTx(advisorAToken, {
      accountId: inrAccount,
      type: 'adjustment',
      category: 'correction',
      amountMinor: ADJUST_INR,
      currency: 'INR',
      occurredAt: at(5),
    }).expect(201);

    const list = await request(app.getHttpServer())
      .get(`/api/households/${h1}/cashflow?month=${MONTH}`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(list.body).toHaveLength(5);
  });

  it('rejects a transaction whose account is not in the household', async () => {
    await addTx(advisorAToken, {
      accountId: 'not-an-account',
      type: 'income',
      category: 'salary',
      amountMinor: 1000,
      occurredAt: at(1),
    }).expect(400);
  });

  it('summarises the month in the base currency, excluding transfers/adjustments', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/households/${h1}/cashflow/summary?month=${MONTH}`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(res.body.currency).toBe('INR');
    expect(res.body.income).toBe(expectedIncome);
    expect(res.body.expense).toBe(expectedExpense);
    expect(res.body.net).toBe(expectedNet);
    // Only expense categories appear in the breakdown (transfer/adjustment excluded).
    const cats = res.body.byCategory.map((c: { category: string }) => c.category).sort();
    expect(cats).toEqual(['housing', 'lifestyle']);
  });

  it('returns a base-currency monthly timeline', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/households/${h1}/cashflow/timeline`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    const march = res.body.find((m: { month: string }) => m.month === MONTH);
    expect(march).toBeDefined();
    expect(march.income).toBe(expectedIncome);
    expect(march.expense).toBe(expectedExpense);
    expect(march.currency).toBe('INR');
  });

  it('computes budget vs actual with overspend detection', async () => {
    await request(app.getHttpServer())
      .post(`/api/households/${h1}/budget`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({
        periodMonth: MONTH,
        totalAmountMinor: 100_000_00,
        lines: [
          { category: 'housing', amountMinor: 50_000_00 }, // under (spent 40k)
          { category: 'lifestyle', amountMinor: 100_00 }, // over (spent ~converted $1,000)
        ],
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/api/households/${h1}/budget?month=${MONTH}`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(res.body.exists).toBe(true);
    expect(res.body.currency).toBe('INR');
    expect(res.body.totalSpentMinor).toBe(expectedExpense);

    const housing = res.body.lines.find((l: { category: string }) => l.category === 'housing');
    expect(housing.spentMinor).toBe(HOUSING_INR);
    expect(housing.remainingMinor).toBe(50_000_00 - HOUSING_INR);
    expect(housing.overBudget).toBe(false);

    const lifestyle = res.body.lines.find((l: { category: string }) => l.category === 'lifestyle');
    expect(lifestyle.spentMinor).toBe(lifestyleInr);
    expect(lifestyle.overBudget).toBe(true);
  });

  it('upserts a budget in place (no duplicate for the same month)', async () => {
    await request(app.getHttpServer())
      .post(`/api/households/${h1}/budget`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({ periodMonth: MONTH, lines: [{ category: 'housing', amountMinor: 60_000_00 }] })
      .expect(201);
    const res = await request(app.getHttpServer())
      .get(`/api/households/${h1}/budget?month=${MONTH}`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    // Old 'lifestyle' envelope replaced; only 'housing' remains as a budgeted line.
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0].category).toBe('housing');
    expect(res.body.lines[0].limitMinor).toBe(60_000_00);
  });

  it('updates and deletes a transaction, scoped to the household', async () => {
    const created = await addTx(advisorAToken, {
      accountId: inrAccount,
      type: 'expense',
      category: 'groceries',
      amountMinor: 3_000_00,
      currency: 'INR',
      occurredAt: at(10),
    }).expect(201);
    const txId = created.body.id;

    const patched = await request(app.getHttpServer())
      .patch(`/api/households/${h1}/cashflow/${txId}`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({ amountMinor: 3_500_00, status: 'void' })
      .expect(200);
    expect(patched.body.amountMinor).toBe(3_500_00);
    expect(patched.body.status).toBe('void');

    await request(app.getHttpServer())
      .delete(`/api/households/${h1}/cashflow/${txId}`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/households/${h1}/cashflow/${txId}`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({ note: 'gone' })
      .expect(404);
  });

  it('enforces scope and role', async () => {
    // outsider / non-member sees nothing
    await request(app.getHttpServer())
      .get(`/api/households/${h1}/cashflow`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(404);

    // analyst may read but not write
    await request(app.getHttpServer())
      .get(`/api/households/${h1}/cashflow`)
      .set('Authorization', `Bearer ${analystToken}`)
      .expect(200);
    await addTx(analystToken, {
      accountId: inrAccount,
      type: 'income',
      category: 'salary',
      amountMinor: 1000,
      occurredAt: at(1),
    }).expect(403);
    await request(app.getHttpServer())
      .post(`/api/households/${h1}/budget`)
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ periodMonth: MONTH, lines: [] })
      .expect(403);
  });
});
