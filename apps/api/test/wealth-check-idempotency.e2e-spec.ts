import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Wealth Health Check — re-running must correct a family's figures, not add to them.
 *
 * See `docs/WEALTH_CHECK_IDEMPOTENCY_DESIGN.md`.
 *
 * ## The defect these pin
 *
 * The check appended on every run. A family who revisited "Update my figures" doubled their
 * assets and their income, and the dashboard reported the inflated figures with full
 * confidence. Leaving a field blank on a later run skewed the ratio further — a blank wrote
 * nothing while the rest kept accumulating, which is where a 96% savings rate came from.
 *
 * ## Why these live at the API and not in a browser test
 *
 * The corruption is in the stored ledger, not on a screen. Asserting the rendered figures
 * would pass just as happily against two accounts summing to the right total as against one
 * account holding it — and the difference between those is the entire defect. So these
 * assert **row counts and balances**, and drive the same request sequence the browser makes.
 */
describe('Wealth Health Check idempotency (e2e)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  const PASSWORD = 'Idemp1passw';
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
      .send({ email, password: PASSWORD, fullName: 'Anita Bhuyan' });
    expect(reg.status).toBe(201);
    const token = reg.body.accessToken as string;
    const ws = await http()
      .post('/api/onboarding/household')
      .set('Authorization', `Bearer ${token}`)
      .send({ familyName: 'The Bhuyans' });
    expect(ws.status).toBe(201);
    return { token, householdId: ws.body.householdId as string };
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const period = () => new Date().toISOString().slice(0, 7);

  const OWNED = { cash: 'Cash & savings', investments: 'Investments', property: 'Property', loan: 'Loan' };
  const FLOW = {
    income: { type: 'income', category: 'salary' },
    expense: { type: 'expense', category: 'living' },
  };

  interface Figures {
    cash?: number;
    investments?: number;
    property?: number;
    loanOutstanding?: number;
    loanMonthlyPayment?: number;
    monthlyIncome?: number;
    monthlyExpenses?: number;
  }

  const state = async (token: string, id: string) => {
    const [accounts, debts, transactions] = await Promise.all([
      http().get(`/api/households/${id}/accounts`).set(auth(token)),
      http().get(`/api/households/${id}/debts`).set(auth(token)),
      http().get(`/api/households/${id}/cashflow?month=${period()}`).set(auth(token)),
    ]);
    return {
      accounts: accounts.body as { id: string; name: string; balanceMinor: string | number }[],
      debts: debts.body as {
        id: string;
        name: string;
        status: string;
        outstandingMinor: string | number | null;
        minimumPaymentMinor: string | number;
      }[],
      transactions: transactions.body as {
        id: string;
        type: string;
        category: string;
        status: string;
        amountMinor: string | number;
      }[],
    };
  };

  /**
   * The exact sequence `apps/web/src/lib/wealthHealth.ts` performs — read current state,
   * then update what exists and create only what does not. Kept in step with that file
   * deliberately: it is the behaviour under test, and a divergence here would make these
   * tests assert something the product does not do.
   */
  async function runCheck(token: string, householdId: string, input: Figures) {
    const f = {
      cash: 0,
      investments: 0,
      property: 0,
      loanOutstanding: 0,
      loanMonthlyPayment: 0,
      monthlyIncome: 0,
      monthlyExpenses: 0,
      ...input,
    };
    const existing = await state(token, householdId);
    const owned = (name: string) => existing.accounts.filter((a) => a.name === name);

    let anchor: string | null = null;
    for (const asset of [
      { amount: f.cash, name: OWNED.cash, type: 'bank', assetClass: 'cash' },
      { amount: f.investments, name: OWNED.investments, type: 'investment', assetClass: 'equity' },
      { amount: f.property, name: OWNED.property, type: 'real_estate', assetClass: 'real_estate' },
    ]) {
      const current = owned(asset.name)[0];
      if (current) {
        await http()
          .patch(`/api/households/${householdId}/accounts/${current.id}`)
          .set(auth(token))
          .send({ balanceMinor: rupees(asset.amount) });
        if (!anchor || asset.assetClass === 'cash') anchor = current.id;
        continue;
      }
      if (asset.amount <= 0) continue;
      const created = await http()
        .post(`/api/households/${householdId}/accounts`)
        .set(auth(token))
        .send({
          name: asset.name,
          type: asset.type,
          assetClass: asset.assetClass,
          currency: 'INR',
          balanceMinor: rupees(asset.amount),
          isLiability: false,
        });
      expect(created.status).toBe(201);
      if (!anchor || asset.assetClass === 'cash') anchor = created.body.id;
    }

    const loan = existing.debts.filter((d) => d.name === OWNED.loan && d.status === 'active')[0];
    if (loan) {
      await http()
        .patch(`/api/households/${householdId}/debts/${loan.id}`)
        .set(auth(token))
        .send({
          outstandingMinor: rupees(f.loanOutstanding),
          minimumPaymentMinor: rupees(f.loanMonthlyPayment),
          annualInterestRatePct: 9,
        });
    } else if (f.loanOutstanding > 0) {
      const created = await http()
        .post(`/api/households/${householdId}/debts`)
        .set(auth(token))
        .send({
          name: OWNED.loan,
          type: 'other',
          currency: 'INR',
          principalMinor: rupees(f.loanOutstanding),
          outstandingMinor: rupees(f.loanOutstanding),
          annualInterestRatePct: 9,
          minimumPaymentMinor: rupees(f.loanMonthlyPayment),
        });
      expect(created.status).toBe(201);
    }

    if (!anchor) anchor = owned(OWNED.cash)[0]?.id ?? existing.accounts[0]?.id ?? null;

    const occurredAt = new Date().toISOString();
    for (const flow of [
      { amount: f.monthlyIncome, ...FLOW.income },
      { amount: f.monthlyExpenses, ...FLOW.expense },
    ]) {
      const current = existing.transactions.filter(
        (t) => t.type === flow.type && t.category === flow.category && t.status !== 'void',
      )[0];
      if (current) {
        await http()
          .patch(`/api/households/${householdId}/cashflow/${current.id}`)
          .set(auth(token))
          .send(flow.amount > 0 ? { amountMinor: rupees(flow.amount) } : { status: 'void' });
        continue;
      }
      if (flow.amount <= 0 || !anchor) continue;
      const created = await http()
        .post(`/api/households/${householdId}/cashflow`)
        .set(auth(token))
        .send({
          accountId: anchor,
          type: flow.type,
          category: flow.category,
          amountMinor: rupees(flow.amount),
          currency: 'INR',
          occurredAt,
        });
      expect(created.status).toBe(201);
    }

    const snap = await http()
      .post(`/api/households/${householdId}/financial-snapshot`)
      .set(auth(token))
      .send({});
    expect(snap.status).toBe(201);
    return snap.body;
  }

  const intelligence = (token: string, id: string) =>
    http().get(`/api/households/${id}/intelligence/current`).set(auth(token));

  const FULL: Figures = {
    cash: 500000,
    investments: 1000000,
    property: 300000,
    loanOutstanding: 350000,
    loanMonthlyPayment: 12000,
    monthlyIncome: 300000,
    monthlyExpenses: 75000,
  };

  const num = (v: string | number | null) => Number(v ?? 0);
  const named = (rows: { name: string }[], name: string) => rows.filter((r) => r.name === name);
  const live = (
    rows: { type: string; category: string; status: string }[],
    f: { type: string; category: string },
  ) => rows.filter((t) => t.type === f.type && t.category === f.category && t.status !== 'void');

  it('1 — a first submission creates the expected records', async () => {
    const { token, householdId } = await newConsumer('idem_first');
    await runCheck(token, householdId, FULL);
    const s = await state(token, householdId);

    expect(named(s.accounts, OWNED.cash)).toHaveLength(1);
    expect(named(s.accounts, OWNED.investments)).toHaveLength(1);
    expect(named(s.accounts, OWNED.property)).toHaveLength(1);
    expect(num(named(s.accounts, OWNED.cash)[0].balanceMinor)).toBe(rupees(500000));
    expect(named(s.debts, OWNED.loan)).toHaveLength(1);
    expect(live(s.transactions, FLOW.income)).toHaveLength(1);
    expect(live(s.transactions, FLOW.expense)).toHaveLength(1);
  });

  it('2 — the figures a family already has are readable, so the form can prefill', async () => {
    // Prefill is half the fix: a blank form is what made someone re-enter one number and
    // leave the rest empty. This asserts the read the form depends on.
    const { token, householdId } = await newConsumer('idem_prefill');
    await runCheck(token, householdId, FULL);
    const s = await state(token, householdId);

    expect(num(named(s.accounts, OWNED.cash)[0].balanceMinor)).toBe(rupees(500000));
    expect(num(named(s.accounts, OWNED.investments)[0].balanceMinor)).toBe(rupees(1000000));
    expect(num(named(s.accounts, OWNED.property)[0].balanceMinor)).toBe(rupees(300000));
    expect(num(named(s.debts, OWNED.loan)[0].outstandingMinor)).toBe(rupees(350000));
    expect(num(named(s.debts, OWNED.loan)[0].minimumPaymentMinor)).toBe(rupees(12000));
    expect(num(live(s.transactions, FLOW.income)[0].amountMinor)).toBe(rupees(300000));
    expect(num(live(s.transactions, FLOW.expense)[0].amountMinor)).toBe(rupees(75000));
  });

  it('3, 8, 9, 10, 11 — submitting the same figures twice changes nothing', async () => {
    // The headline defect. Before this, the second run doubled every figure.
    const { token, householdId } = await newConsumer('idem_twice');
    await runCheck(token, householdId, FULL);
    const first = await intelligence(token, householdId);
    await runCheck(token, householdId, FULL);
    const s = await state(token, householdId);
    const second = await intelligence(token, householdId);

    // 3 — no duplicate rows
    expect(named(s.accounts, OWNED.cash)).toHaveLength(1);
    expect(named(s.accounts, OWNED.investments)).toHaveLength(1);
    expect(named(s.accounts, OWNED.property)).toHaveLength(1);
    expect(named(s.debts, OWNED.loan)).toHaveLength(1);
    expect(live(s.transactions, FLOW.income)).toHaveLength(1);
    expect(live(s.transactions, FLOW.expense)).toHaveLength(1);

    // 10, 11 — assets and debts did not accumulate
    expect(second.body.netWorth.data.assetsMinor).toBe(first.body.netWorth.data.assetsMinor);
    expect(second.body.netWorth.data.totalDebtMinor).toBe(first.body.netWorth.data.totalDebtMinor);
    expect(second.body.netWorth.data.assetsMinor).toBe(rupees(1800000));

    // 8, 9 — income and expenses did not accumulate
    expect(second.body.cashflow.data.incomeMinor).toBe(rupees(300000));
    expect(second.body.cashflow.data.expenseMinor).toBe(rupees(75000));
    expect(second.body.cashflow.data.savingsRate).toBeCloseTo(
      first.body.cashflow.data.savingsRate,
      10,
    );
  });

  it('4 — changing one value updates the existing record and leaves the rest alone', async () => {
    const { token, householdId } = await newConsumer('idem_change');
    await runCheck(token, householdId, FULL);
    await runCheck(token, householdId, { ...FULL, cash: 650000 });
    const s = await state(token, householdId);

    expect(named(s.accounts, OWNED.cash)).toHaveLength(1);
    expect(num(named(s.accounts, OWNED.cash)[0].balanceMinor)).toBe(rupees(650000));
    expect(num(named(s.accounts, OWNED.investments)[0].balanceMinor)).toBe(rupees(1000000));
    expect(live(s.transactions, FLOW.income)).toHaveLength(1);
  });

  it('5 — clearing a prefilled figure zeroes it and keeps the record', async () => {
    // "I have none of this" is a figure, not an event. Deleting would discard the record's
    // history and assert something the family never said.
    const { token, householdId } = await newConsumer('idem_clear');
    await runCheck(token, householdId, FULL);
    const before = await state(token, householdId);
    const propertyId = named(before.accounts, OWNED.property)[0].id;
    const loanId = named(before.debts, OWNED.loan)[0].id;
    const incomeId = live(before.transactions, FLOW.income)[0].id;

    await runCheck(token, householdId, {
      ...FULL,
      property: 0,
      loanOutstanding: 0,
      loanMonthlyPayment: 0,
      monthlyIncome: 0,
    });
    const s = await state(token, householdId);

    // The account still exists, at zero — same row, not a replacement.
    const property = named(s.accounts, OWNED.property);
    expect(property).toHaveLength(1);
    expect(property[0].id).toBe(propertyId);
    expect(num(property[0].balanceMinor)).toBe(0);

    // The debt still exists, at zero, and is NOT closed — a blank field is not evidence
    // that a loan was settled.
    const loan = named(s.debts, OWNED.loan);
    expect(loan).toHaveLength(1);
    expect(loan[0].id).toBe(loanId);
    expect(num(loan[0].outstandingMinor)).toBe(0);
    expect(loan[0].status).toBe('active');

    // A transaction's amount must be positive, so the row is voided rather than deleted:
    // the kernel's own way of saying "this no longer counts", and cashflow already
    // excludes it.
    const income = s.transactions.filter((t) => t.id === incomeId);
    expect(income).toHaveLength(1);
    expect(income[0].status).toBe('void');
    expect(live(s.transactions, FLOW.income)).toHaveLength(0);

    const intel = await intelligence(token, householdId);
    expect(intel.body.cashflow.data.incomeMinor).toBe(0);
    expect(intel.body.netWorth.data.totalDebtMinor).toBe(0);
  });

  it('6 — historical transactions survive a re-run', async () => {
    // Anything the family recorded outside the check is theirs, and the check must not
    // touch it. A previous month's transaction is the clearest case: it is outside the
    // period this run writes to, and must still be there afterwards.
    const { token, householdId } = await newConsumer('idem_history');
    await runCheck(token, householdId, FULL);
    const s0 = await state(token, householdId);
    const anchor = named(s0.accounts, OWNED.cash)[0].id;

    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const older = await http()
      .post(`/api/households/${householdId}/cashflow`)
      .set(auth(token))
      .send({
        accountId: anchor,
        type: 'expense',
        category: 'school_fees',
        amountMinor: rupees(40000),
        currency: 'INR',
        occurredAt: lastMonth.toISOString(),
      });
    expect(older.status).toBe(201);

    await runCheck(token, householdId, FULL);

    const kept = await http()
      .get(`/api/households/${householdId}/cashflow?month=${lastMonth.toISOString().slice(0, 7)}`)
      .set(auth(token));
    const match = (kept.body as { id: string; status: string; amountMinor: string | number }[]).filter(
      (t) => t.id === older.body.id,
    );
    expect(match).toHaveLength(1);
    expect(match[0].status).not.toBe('void');
    expect(num(match[0].amountMinor)).toBe(rupees(40000));
  });

  it('7 — historical snapshots are immutable across a re-run', async () => {
    // Snapshots record what the ledger said when they were captured. Correcting today's
    // figures must not rewrite yesterday's record of them.
    const { token, householdId } = await newConsumer('idem_snapshots');
    const first = await runCheck(token, householdId, FULL);
    await runCheck(token, householdId, { ...FULL, cash: 900000 });

    const original = await http()
      .get(`/api/households/${householdId}/financial-snapshot/${first.id}`)
      .set(auth(token));
    expect(original.status).toBe(200);
    expect(original.body.payload.netWorth.assetsMinor).toBe(rupees(1800000));
    expect(original.body.checksum).toBe(first.checksum);

    const timeline = await http()
      .get(`/api/households/${householdId}/financial-snapshot/timeline`)
      .set(auth(token));
    expect(timeline.body.length).toBe(2);
  });

  it('12 — the Wealth Health Score is computed from the corrected figures', async () => {
    const { token, householdId } = await newConsumer('idem_score');
    await runCheck(token, householdId, FULL);
    await runCheck(token, householdId, FULL);

    const intel = await intelligence(token, householdId);
    const score = await http()
      .get(`/api/households/${householdId}/health-score/current`)
      .set(auth(token));

    expect(score.body.snapshotId).toBe(intel.body.meta.snapshotId);
    expect(score.body.overall).toBe(intel.body.wealthHealth.data.overall);
    // Savings is scored from cashflow: doubled income with unchanged expenses would have
    // flattered it. 300000 in, 75000 out — the figures entered, not a multiple of them.
    expect(intel.body.cashflow.data.incomeMinor).toBe(rupees(300000));
  });

  it('13 — retirement is projected from the corrected figures', async () => {
    const { token, householdId } = await newConsumer('idem_retire');

    // Retirement needs an age to project from, and a household provisioned at onboarding has
    // no date of birth — the section reports `available: false` until one exists. Setting it
    // is what makes this test exercise the projection rather than assert on an absent panel.
    const members = await http().get(`/api/households/${householdId}/members`).set(auth(token));
    const self = (members.body as { id: string; relation: string }[]).find(
      (m) => m.relation === 'self',
    );
    expect(self).toBeDefined();
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 41);
    await http()
      .patch(`/api/households/${householdId}/members/${self!.id}`)
      .set(auth(token))
      .send({ dateOfBirth: dob.toISOString().slice(0, 10) });

    await runCheck(token, householdId, FULL);
    const once = await intelligence(token, householdId);
    await runCheck(token, householdId, FULL);
    const twice = await intelligence(token, householdId);

    // The property under test is idempotency: doubling assets doubled the corpus before, and
    // this asserts a second run changes nothing. That is unaffected by M5.14 and still holds.
    expect(twice.body.retirement.data.currentCorpusMinor).toBe(
      once.body.retirement.data.currentCorpusMinor,
    );
    // The figure itself changed deliberately in M5.14: the corpus is now investable assets
    // (cash + investments), not reconciled net worth. The home is not retirement money, and a
    // mortgage is a claim on income rather than on the retirement pot — so ₹3L of property is
    // excluded and the ₹3.5L loan is no longer netted off.
    expect(twice.body.retirement.data.currentCorpusMinor).toBe(rupees(500000 + 1000000));
  });

  it('14 — AI grounding still receives the reconciled net worth', async () => {
    // Guards PR #59 from being undone underneath this change: the figure the model reads
    // must be after the debt ledger, and must equal what the dashboard shows.
    const { token, householdId } = await newConsumer('idem_ground');
    await runCheck(token, householdId, FULL);
    await runCheck(token, householdId, FULL);

    const intel = await intelligence(token, householdId);
    expect(intel.body.netWorth.data.netWorthMinor).toBe(rupees(1800000 - 350000));
    expect(intel.body.netWorth.data.grossNetWorthMinor).toBe(rupees(1800000));

    const ai = await http()
      .post(`/api/households/${householdId}/ai/insights`)
      .set(auth(token))
      .send({});
    expect(ai.body.available).toBe(true);
    expect(ai.body.answer).toContain('₹14,50,000');
    expect(ai.body.answer).not.toContain('₹18,00,000');
  });

  it('15 — a repeated submission cannot duplicate the current records', async () => {
    // Retry semantics: three runs, the shape a dropped response or an impatient click
    // produces. Every figure must read as though the check ran once.
    const { token, householdId } = await newConsumer('idem_retry');
    for (let i = 0; i < 3; i += 1) await runCheck(token, householdId, FULL);

    const s = await state(token, householdId);
    expect(named(s.accounts, OWNED.cash)).toHaveLength(1);
    expect(named(s.accounts, OWNED.investments)).toHaveLength(1);
    expect(named(s.accounts, OWNED.property)).toHaveLength(1);
    expect(named(s.debts, OWNED.loan)).toHaveLength(1);
    expect(live(s.transactions, FLOW.income)).toHaveLength(1);
    expect(live(s.transactions, FLOW.expense)).toHaveLength(1);

    const intel = await intelligence(token, householdId);
    expect(intel.body.netWorth.data.assetsMinor).toBe(rupees(1800000));
    expect(intel.body.cashflow.data.incomeMinor).toBe(rupees(300000));
  });

  it('a partial update writes the figures it was given, and does not accumulate', async () => {
    // The 96% case: assets and income re-entered, expenses left blank. Before this the
    // income stacked while the expense did not, and the savings rate ran away.
    const { token, householdId } = await newConsumer('idem_partial');
    await runCheck(token, householdId, { ...FULL, monthlyIncome: 300000, monthlyExpenses: 75000 });
    await runCheck(token, householdId, { ...FULL, monthlyIncome: 1575000, monthlyExpenses: 0 });

    const intel = await intelligence(token, householdId);
    expect(intel.body.cashflow.data.incomeMinor).toBe(rupees(1575000));
    expect(intel.body.cashflow.data.expenseMinor).toBe(0);
    // Not 18,75,000 — the figure entered, not the sum of both runs.
    expect(intel.body.cashflow.data.incomeMinor).not.toBe(rupees(1875000));
  });
});
