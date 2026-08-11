import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Household Dashboard (M5.6) — the data contract the dashboard renders.
 *
 * See `docs/M5_6_HOUSEHOLD_DASHBOARD_ARCHITECTURE.md`.
 *
 * The dashboard makes exactly one call and renders whatever it returns, computing nothing
 * itself. That makes the response the single point where a wrong number could originate,
 * so these tests assert on **values and section states** rather than on a 200:
 *
 *  - the figures a consumer entered come back as those figures, not zeros;
 *  - every section the dashboard renders is present;
 *  - a household with no snapshot reports `available: false` rather than an empty shell,
 *    because a zero net worth and an unknown net worth look identical once rendered;
 *  - everything traces to one `snapshotId`, so no two panels can disagree.
 */
describe('Household dashboard data (e2e)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  const PASSWORD = 'Dashb1passw';
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

  async function newConsumer(prefix: string) {
    const email = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`;
    const reg = await http()
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, fullName: 'Ravi Menon' });
    expect(reg.status).toBe(201);
    const token = reg.body.accessToken as string;
    const workspace = await http()
      .post('/api/onboarding/household')
      .set('Authorization', `Bearer ${token}`)
      .send({ familyName: 'The Menons' });
    expect(workspace.status).toBe(201);
    return { token, householdId: workspace.body.householdId as string };
  }

  /** The same sequence the Wealth Health Check performs. */
  async function completeCheck(token: string, householdId: string, loanOutstanding = 0) {
    const cash = await http()
      .post(`/api/households/${householdId}/accounts`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Cash & savings',
        type: 'bank',
        assetClass: 'cash',
        currency: 'INR',
        balanceMinor: rupees(900000),
        isLiability: false,
      });
    expect(cash.status).toBe(201);

    await http()
      .post(`/api/households/${householdId}/accounts`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Investments',
        type: 'investment',
        assetClass: 'equity',
        currency: 'INR',
        balanceMinor: rupees(1100000),
        isLiability: false,
      });

    const occurredAt = new Date().toISOString();
    for (const flow of [
      { type: 'income', category: 'salary', amountMinor: rupees(300000) },
      { type: 'expense', category: 'living', amountMinor: rupees(150000) },
    ]) {
      await http()
        .post(`/api/households/${householdId}/cashflow`)
        .set('Authorization', `Bearer ${token}`)
        .send({ accountId: cash.body.id, currency: 'INR', occurredAt, ...flow });
    }

    // The wizard writes a loan only when the family enters one, and always to the debt
    // ledger — never as a liability account. That asymmetry is what made the reconciliation
    // defect invisible for as long as every test here ran debt-free.
    if (loanOutstanding > 0) {
      const debt = await http()
        .post(`/api/households/${householdId}/debts`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Loan',
          type: 'other',
          currency: 'INR',
          principalMinor: loanOutstanding,
          outstandingMinor: loanOutstanding,
          annualInterestRatePct: 9,
          minimumPaymentMinor: rupees(12000),
        });
      expect(debt.status).toBe(201);
    }

    const snap = await http()
      .post(`/api/households/${householdId}/financial-snapshot`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(snap.status).toBe(201);
    return snap.body;
  }

  const intelligence = (token: string, householdId: string) =>
    http()
      .get(`/api/households/${householdId}/intelligence/current`)
      .set('Authorization', `Bearer ${token}`);

  it('reports "no snapshot" before a check is run, so the dashboard prompts instead of showing zeros', async () => {
    const { token, householdId } = await newConsumer('dash_empty');
    const res = await intelligence(token, householdId);
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.reason).toBeTruthy();
  });

  it('returns the consumer’s actual figures, not an empty shell', async () => {
    const { token, householdId } = await newConsumer('dash_values');
    await completeCheck(token, householdId);

    const { body } = await intelligence(token, householdId);
    expect(body.available).toBe(true);

    // 20L of assets, no debt.
    expect(body.netWorth.available).toBe(true);
    expect(body.netWorth.data.assetsMinor).toBe(rupees(2000000));
    expect(body.netWorth.data.netWorthMinor).toBe(rupees(2000000));

    // Income 3L, expenses 1.5L → the engine's own savings rate, not one we computed.
    expect(body.cashflow.available).toBe(true);
    expect(body.cashflow.data.incomeMinor).toBe(rupees(300000));
    expect(body.cashflow.data.expenseMinor).toBe(rupees(150000));
  });

  it('subtracts the family’s loan from the net worth it reports', async () => {
    // The defect: the snapshot carries two figures — assets minus liability *accounts*
    // (gross), and that minus the debt ledger (reconciled, ADR-012). The layer reported the
    // gross one, while the wizard writes every loan to the ledger. A family who entered a
    // ₹4,00,000 loan was shown ₹0 liabilities and a net worth ₹4,00,000 too high, with the
    // loan appearing nowhere on the page.
    const { token, householdId } = await newConsumer('dash_debt');
    await completeCheck(token, householdId, rupees(400000));

    const { body } = await intelligence(token, householdId);
    expect(body.netWorth.available).toBe(true);
    const n = body.netWorth.data;

    expect(n.assetsMinor).toBe(rupees(2000000));
    // Still zero — the loan is not an account, and pretending otherwise would double-count.
    expect(n.liabilitiesMinor).toBe(0);
    // ...so the loan must be reported in its own right, or it is invisible.
    expect(n.totalDebtMinor).toBe(rupees(400000));
    expect(n.netWorthMinor).toBe(rupees(1600000));
    expect(n.grossNetWorthMinor).toBe(rupees(2000000));
    // The ratio has to agree with the net worth beside it: 16L / 20L.
    expect(n.solvencyRatio).toBeCloseTo(0.8, 5);
  });

  it('provides every section the dashboard renders', async () => {
    // If the engine stopped returning one of these, the dashboard would silently drop a
    // panel rather than fail — so the contract is asserted explicitly.
    const { token, householdId } = await newConsumer('dash_sections');
    await completeCheck(token, householdId);
    const { body } = await intelligence(token, householdId);

    for (const key of [
      'netWorth',
      'emergencyFund',
      'assetAllocation',
      'retirement',
      'insurance',
      'cashflow',
      'risk',
      'opportunity',
      'wealthHealth',
    ]) {
      expect(body[key]).toBeDefined();
      // Either available with data, or unavailable WITH A REASON — never silently empty.
      if (body[key].available) expect(body[key].data).toBeDefined();
      else expect(body[key].reason).toBeTruthy();
    }

    expect(body.executiveSummary?.headline).toBeTruthy();
    expect(Array.isArray(body.recommendedActions)).toBe(true);
  });

  it('carries the provenance the dashboard displays', async () => {
    const { token, householdId } = await newConsumer('dash_meta');
    const snapshot = await completeCheck(token, householdId);
    const { body } = await intelligence(token, householdId);

    // Every figure on the page traces to this snapshot and these engine versions.
    expect(body.meta.snapshotId).toBe(snapshot.id);
    expect(body.meta.engineVersion).toBeTruthy();
    expect(body.meta.scoreModelVersion).toBeTruthy();
    expect(body.meta.currency).toBeTruthy();
    expect(body.meta.dataCompleteness).toBeDefined();
  });

  it('scores Wealth Health from the same snapshot the rest of the page reads', async () => {
    // The reason the dashboard makes ONE call: assembling it from several endpoints would
    // let net worth come from one moment and the score from another, with nothing on
    // screen to show the disagreement.
    const { token, householdId } = await newConsumer('dash_consistency');
    await completeCheck(token, householdId);
    const { body } = await intelligence(token, householdId);

    expect(body.wealthHealth.available).toBe(true);
    expect(body.wealthHealth.data.overall).toBeGreaterThan(0);

    const score = await http()
      .get(`/api/households/${householdId}/health-score/current`)
      .set('Authorization', `Bearer ${token}`);
    expect(score.body.snapshotId).toBe(body.meta.snapshotId);
    expect(score.body.overall).toBe(body.wealthHealth.data.overall);
  });

  it('is read-only — viewing the dashboard captures no snapshot', async () => {
    // The dashboard must be safe to open and refresh. If viewing it captured snapshots,
    // the immutable history would fill with duplicates nobody asked for.
    const { token, householdId } = await newConsumer('dash_readonly');
    await completeCheck(token, householdId);

    const before = await http()
      .get(`/api/households/${householdId}/financial-snapshot/timeline`)
      .set('Authorization', `Bearer ${token}`);
    const countBefore = ((before.body.data ?? before.body) as unknown[]).length;

    await intelligence(token, householdId);
    await intelligence(token, householdId);

    const after = await http()
      .get(`/api/households/${householdId}/financial-snapshot/timeline`)
      .set('Authorization', `Bearer ${token}`);
    expect(((after.body.data ?? after.body) as unknown[]).length).toBe(countBefore);
  });

  it('requires authentication', async () => {
    expect((await http().get('/api/households/anything/intelligence/current')).status).toBe(401);
  });
});
