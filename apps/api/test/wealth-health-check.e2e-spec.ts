import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Wealth Health Check — the pipeline a consumer's figures travel through.
 *
 * See `docs/M5_5_WEALTH_HEALTH_CHECK_ARCHITECTURE.md`.
 *
 * The property under test is **that the score reflects what the user entered**. Two silent
 * failure modes make that worth asserting directly rather than inferring:
 *
 *  1. Writing accounts to the retail (`userId`) path instead of the household path — the
 *     snapshot would be empty and the score computed on nothing.
 *  2. Collecting income/expenses without creating transactions, or dating them outside the
 *     current month — cashflow would be zero and Savings would score 0 of its 20 points.
 *
 * Neither throws. Both render a plausible number. So these tests assert on the *values*,
 * not on a 200.
 */
describe('Wealth Health Check pipeline (e2e)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  const PASSWORD = 'Wealth1pass';
  const rupees = (n: number) => n * 100;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  /** Mirrors exactly what `apps/web/src/lib/wealthHealth.ts` does, in the same order. */
  async function runCheck(token: string, householdId: string) {
    const cash = await http()
      .post(`/api/households/${householdId}/accounts`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Cash & savings',
        type: 'bank',
        assetClass: 'cash',
        currency: 'INR',
        balanceMinor: rupees(600000),
        isLiability: false,
      });
    expect(cash.status).toBe(201);

    const investments = await http()
      .post(`/api/households/${householdId}/accounts`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Investments',
        type: 'investment',
        assetClass: 'equity',
        currency: 'INR',
        balanceMinor: rupees(1400000),
        isLiability: false,
      });
    expect(investments.status).toBe(201);

    const debt = await http()
      .post(`/api/households/${householdId}/debts`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Loan',
        type: 'other',
        currency: 'INR',
        principalMinor: rupees(500000),
        outstandingMinor: rupees(500000),
        annualInterestRatePct: 9,
        minimumPaymentMinor: rupees(15000),
      });
    expect(debt.status).toBe(201);

    // Dated now, because the snapshot composes cashflow for the CURRENT month.
    const occurredAt = new Date().toISOString();
    for (const flow of [
      { type: 'income', category: 'salary', amountMinor: rupees(200000) },
      { type: 'expense', category: 'living', amountMinor: rupees(100000) },
    ]) {
      const res = await http()
        .post(`/api/households/${householdId}/cashflow`)
        .set('Authorization', `Bearer ${token}`)
        .send({ accountId: cash.body.id, currency: 'INR', occurredAt, ...flow });
      expect(res.status).toBe(201);
    }

    const snapshot = await http()
      .post(`/api/households/${householdId}/financial-snapshot`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(snapshot.status).toBe(201);
    return snapshot.body;
  }

  async function newConsumer(prefix: string) {
    const email = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`;
    const reg = await http()
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, fullName: 'Anita Rao' });
    expect(reg.status).toBe(201);
    const token = reg.body.accessToken as string;

    const workspace = await http()
      .post('/api/onboarding/household')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(workspace.status).toBe(201);
    return { token, householdId: workspace.body.householdId as string };
  }

  it('scores the figures the consumer entered, not an empty snapshot', async () => {
    const { token, householdId } = await newConsumer('whc_score');
    await runCheck(token, householdId);

    const res = await http()
      .get(`/api/households/${householdId}/health-score/current`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);

    // 20L of assets against 5L of debt is a healthy position. An empty snapshot would
    // score near zero, so this range is what distinguishes "scored the data" from
    // "scored nothing" — the exact defect the wizard could silently ship.
    expect(res.body.overall).toBeGreaterThan(50);
    expect(res.body.categories.length).toBeGreaterThan(0);
  });

  it('registers the cashflow — Savings is scored, not silently zero', async () => {
    // The regression: collecting income/expenses without writing transactions, or dating
    // them outside the current month. Savings is 20% of the score, so a family saving
    // half their income would be shown a materially lower number with no error anywhere.
    const { token, householdId } = await newConsumer('whc_cashflow');
    await runCheck(token, householdId);

    const res = await http()
      .get(`/api/households/${householdId}/health-score/current`)
      .set('Authorization', `Bearer ${token}`);
    const savings = res.body.categories.find((c: { key: string }) => c.key === 'savings');
    expect(savings).toBeDefined();
    // Income 2L, expenses 1L → a 50% savings rate, which the model scores at its ceiling.
    expect(savings.score).toBeGreaterThan(0);
    expect(savings.reason).not.toMatch(/No income recorded/i);
  });

  it('counts the assets — net worth and liquidity reflect the balances entered', async () => {
    const { token, householdId } = await newConsumer('whc_assets');
    const snapshot = await runCheck(token, householdId);

    // The snapshot is the contract every downstream consumer reads, so assert on it
    // directly rather than only on the score derived from it.
    expect(snapshot.payload.netWorth.assetsMinor).toBe(rupees(2000000));
    expect(snapshot.payload.cashflowSummary.incomeMinor).toBe(rupees(200000));
    expect(snapshot.payload.cashflowSummary.expenseMinor).toBe(rupees(100000));
    expect(snapshot.payload.debt.totalOutstandingMinor).toBe(rupees(500000));

    const res = await http()
      .get(`/api/households/${householdId}/health-score/current`)
      .set('Authorization', `Bearer ${token}`);
    const liquidity = res.body.categories.find((c: { key: string }) => c.key === 'liquidity');
    // 6L cash against 1L monthly expenses is six months of runway — the model's ceiling.
    expect(liquidity.score).toBeGreaterThan(0);
  });

  it('leaves an immutable trail — re-running adds a snapshot rather than overwriting', async () => {
    const { token, householdId } = await newConsumer('whc_immutable');
    const first = await runCheck(token, householdId);
    const second = await runCheck(token, householdId);
    expect(second.id).not.toBe(first.id);

    const timeline = await http()
      .get(`/api/households/${householdId}/financial-snapshot/timeline`)
      .set('Authorization', `Bearer ${token}`);
    expect(timeline.status).toBe(200);
    const rows = (timeline.body.data ?? timeline.body) as unknown[];
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('requires authentication', async () => {
    const res = await http().get('/api/households/whatever/health-score/current');
    expect(res.status).toBe(401);
  });
});
