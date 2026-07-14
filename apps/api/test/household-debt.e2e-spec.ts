import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { StaticFxRateProvider, convertMinor } from '@lcos/core';
import { createApp } from '../src/app.factory';

/**
 * M2-5 Household debt & payoff engine. Verifies household-scoped debt CRUD,
 * multi-currency summary/payoff (asserted against the same core FX), payments that
 * reduce outstanding (and foreclosure that closes a debt), immutable debt snapshots +
 * timeline, and scope/role gating (outsider 404, analyst read-only).
 */
describe('Household debt e2e', () => {
  let app: INestApplication;
  const fx = new StaticFxRateProvider(); // matches FxService defaults (no override in tests)

  let adminToken: string;
  let owner1Token: string;
  let owner1Id: string;
  let advisorAToken: string;
  let advisorAId: string;
  const advisorAEmail = `debt_advA_${Date.now()}@example.com`;
  let analystToken: string;
  const analystEmail = `debt_analyst_${Date.now()}@example.com`;
  let outsiderToken: string;

  let firmA: string;
  let h1: string; // INR base
  let homeLoanId: string;
  let usdLoanId: string;

  const ts = Date.now();

  // Native amounts (minor units).
  const HOME_PRINCIPAL = 5_000_000_00; // ₹50,00,000
  const HOME_EMI = 45_000_00; // ₹45,000
  const USD_PRINCIPAL = 100_000_00; // $100,000
  const USD_MIN = 1_000_00; // $1,000

  const usdOutstandingInr = convertMinor(USD_PRINCIPAL, 'USD', 'INR', fx);
  const expectedTotalOutstanding = HOME_PRINCIPAL + usdOutstandingInr;

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

  function addDebt(token: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`/api/households/${h1}/debts`)
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

    ({ token: owner1Token, id: owner1Id } = await registerUser(`debt_owner1_${ts}@example.com`));
    ({ token: advisorAToken, id: advisorAId } = await registerUser(advisorAEmail));
    ({ token: analystToken } = await registerUser(analystEmail));
    ({ token: outsiderToken } = await registerUser(`debt_outsider_${ts}@example.com`));

    firmA = (
      await request(app.getHttpServer())
        .post('/api/firms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Firm Debt ${ts}`, ownerUserId: owner1Id })
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
  });

  afterAll(async () => {
    await app?.close();
  });

  it('creates debts of different types and currencies', async () => {
    const home = await addDebt(advisorAToken, {
      name: 'HDFC Home Loan',
      type: 'home_loan',
      secured: true,
      lender: 'HDFC',
      currency: 'INR',
      principalMinor: HOME_PRINCIPAL,
      annualInterestRatePct: 8.5,
      minimumPaymentMinor: HOME_EMI,
      emiMinor: HOME_EMI,
      dueDayOfMonth: 5,
    }).expect(201);
    expect(home.body.type).toBe('home_loan');
    expect(home.body.secured).toBe(true);
    expect(home.body.outstandingMinor).toBe(HOME_PRINCIPAL); // seeded to principal
    expect(home.body.status).toBe('active');
    homeLoanId = home.body.id;

    const usd = await addDebt(advisorAToken, {
      name: 'US Student Loan',
      type: 'education_loan',
      currency: 'USD',
      principalMinor: USD_PRINCIPAL,
      annualInterestRatePct: 6,
      minimumPaymentMinor: USD_MIN,
    }).expect(201);
    usdLoanId = usd.body.id;

    const list = await request(app.getHttpServer())
      .get(`/api/households/${h1}/debts`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(list.body).toHaveLength(2);
  });

  it('rejects a debt whose entity is not in the household', async () => {
    await addDebt(advisorAToken, {
      name: 'Bad',
      type: 'other',
      principalMinor: 1000,
      annualInterestRatePct: 5,
      minimumPaymentMinor: 100,
      entityId: 'not-an-entity',
    }).expect(400);
  });

  it('summarises outstanding + weighted rate in the base currency', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/households/${h1}/debts/summary`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(res.body.currency).toBe('INR');
    expect(res.body.debtCount).toBe(2);
    expect(res.body.totalOutstandingMinor).toBe(expectedTotalOutstanding);
    // Weighted average of 8.5% (home) and 6% (usd) by converted outstanding.
    const expectedRate =
      (HOME_PRINCIPAL * 8.5 + usdOutstandingInr * 6) / expectedTotalOutstanding;
    expect(res.body.weightedAvgRatePct).toBeCloseTo(expectedRate, 4);
    // Largest-first: the USD education loan converts to ~₹83L, above the ₹50L home loan.
    expect(res.body.byType[0].type).toBe('education_loan');
    expect(res.body.byType[0].outstandingMinor).toBe(usdOutstandingInr);
  });

  it('projects payoff (avalanche targets the higher rate first)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/households/${h1}/debts/payoff?strategy=avalanche&extraMonthlyMinor=5000000`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(res.body.strategy).toBe('avalanche');
    expect(res.body.currency).toBe('INR');
    expect(res.body.months).toBeGreaterThan(0);
    // Home loan (8.5%) is targeted before the education loan (6%).
    expect(res.body.payoffOrder[0].id).toBe(homeLoanId);
  });

  it('records a payment that reduces outstanding', async () => {
    const pay = await request(app.getHttpServer())
      .post(`/api/households/${h1}/debts/${homeLoanId}/payments`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({
        type: 'emi',
        amountMinor: HOME_EMI,
        principalMinor: 20_000_00,
        interestMinor: 25_000_00,
        paidOn: '2026-03-05T00:00:00.000Z',
      })
      .expect(201);
    expect(pay.body.debt.outstandingMinor).toBe(HOME_PRINCIPAL - 20_000_00);

    const payments = await request(app.getHttpServer())
      .get(`/api/households/${h1}/debts/${homeLoanId}/payments`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(payments.body).toHaveLength(1);
    expect(payments.body[0].principalMinor).toBe(20_000_00);
  });

  it('forecloses a debt: balance cleared and status closed', async () => {
    const pay = await request(app.getHttpServer())
      .post(`/api/households/${h1}/debts/${usdLoanId}/payments`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({ type: 'foreclosure', amountMinor: USD_PRINCIPAL, paidOn: '2026-03-10T00:00:00.000Z' })
      .expect(201);
    expect(pay.body.debt.status).toBe('closed');
    expect(pay.body.debt.outstandingMinor).toBe(0);

    // Closed debt drops out of the active summary.
    const summary = await request(app.getHttpServer())
      .get(`/api/households/${h1}/debts/summary`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(summary.body.debtCount).toBe(1);
  });

  it('captures an immutable debt snapshot and returns it on the timeline', async () => {
    const snap = await request(app.getHttpServer())
      .post(`/api/households/${h1}/debts/snapshot`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(201);
    expect(snap.body.currency).toBe('INR');
    // Only the (reduced) home loan remains active.
    expect(snap.body.totalOutstandingMinor).toBe(HOME_PRINCIPAL - 20_000_00);
    expect(snap.body.debtCount).toBe(1);
    const snapId = snap.body.id;

    // Reduce the debt further — the past snapshot must not move (immutable).
    await request(app.getHttpServer())
      .post(`/api/households/${h1}/debts/${homeLoanId}/payments`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({ type: 'prepayment', amountMinor: 100_000_00, principalMinor: 100_000_00, paidOn: '2026-04-01T00:00:00.000Z' })
      .expect(201);

    const timeline = await request(app.getHttpServer())
      .get(`/api/households/${h1}/debts/timeline`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    const frozen = timeline.body.find((s: { id: string }) => s.id === snapId);
    expect(frozen.totalOutstandingMinor).toBe(HOME_PRINCIPAL - 20_000_00); // unchanged
  });

  it('filters by status and archives without deleting', async () => {
    await request(app.getHttpServer())
      .patch(`/api/households/${h1}/debts/${homeLoanId}`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({ status: 'archived' })
      .expect(200);
    const archived = await request(app.getHttpServer())
      .get(`/api/households/${h1}/debts?status=archived`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(archived.body.map((d: { id: string }) => d.id)).toContain(homeLoanId);
  });

  it('enforces scope and role', async () => {
    // outsider / non-member sees nothing
    await request(app.getHttpServer())
      .get(`/api/households/${h1}/debts`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(404);

    // analyst may read but not write
    await request(app.getHttpServer())
      .get(`/api/households/${h1}/debts`)
      .set('Authorization', `Bearer ${analystToken}`)
      .expect(200);
    await addDebt(analystToken, {
      name: 'Nope',
      type: 'other',
      principalMinor: 1000,
      annualInterestRatePct: 5,
      minimumPaymentMinor: 100,
    }).expect(403);
    await request(app.getHttpServer())
      .post(`/api/households/${h1}/debts/snapshot`)
      .set('Authorization', `Bearer ${analystToken}`)
      .expect(403);
  });
});
