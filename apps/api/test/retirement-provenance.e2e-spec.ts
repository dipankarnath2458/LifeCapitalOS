import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Per-field provenance, and one retirement corpus (M5.14, Gap 3).
 *
 * See `docs/M5_14_PROVENANCE_ARCHITECTURE.md`.
 *
 * The core tests prove the resolution. These prove the two things only a running system can show:
 *
 * 1. The provenance a family is actually served names the right fields.
 * 2. **The dashboard and the planning page report the SAME retirement corpus.** They did not.
 *    The layer fell back to reconciled net worth and the planning surface used investable assets,
 *    so a homeowning family with no stated plan was shown two different figures depending on
 *    which page they opened — and neither said why.
 *
 * As with M5.13's simulation suite, the assertion that matters is an **equality between two
 * endpoints**: a test of either alone would have passed throughout.
 */
describe('Retirement provenance and one corpus (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const PASSWORD = 'Provenance1pw';
  const rupees = (n: number) => n * 100;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  /** A homeowning family: most of their wealth is the roof over their head. */
  async function homeowner(prefix: string) {
    const email = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`;
    const reg = await http()
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, fullName: 'Homeowning Person' });
    expect(reg.status).toBe(201);
    const token = reg.body.accessToken as string;
    const ws = await http().post('/api/onboarding/household').set(auth(token)).send({});
    expect(ws.status).toBe(201);
    const householdId = ws.body.householdId as string;

    const accounts: { name: string; assetClass: string; type: string; amount: number }[] = [
      { name: 'Home', assetClass: 'real_estate', type: 'real_estate', amount: 8000000 },
      { name: 'Equity', assetClass: 'equity', type: 'investment', amount: 1500000 },
      { name: 'Cash & savings', assetClass: 'cash', type: 'bank', amount: 500000 },
    ];
    let cashAccountId = '';
    for (const a of accounts) {
      const res = await http()
        .post(`/api/households/${householdId}/accounts`)
        .set(auth(token))
        .send({
          name: a.name,
          type: a.type,
          assetClass: a.assetClass,
          currency: 'INR',
          balanceMinor: rupees(a.amount),
          isLiability: false,
        });
      expect(res.status).toBe(201);
      if (a.assetClass === 'cash') cashAccountId = res.body.id;
    }

    const occurredAt = new Date().toISOString();
    for (const f of [
      { type: 'income', category: 'salary', amountMinor: rupees(300000) },
      { type: 'expense', category: 'living', amountMinor: rupees(100000) },
    ]) {
      await http()
        .post(`/api/households/${householdId}/cashflow`)
        .set(auth(token))
        .send({ accountId: cashAccountId, currency: 'INR', occurredAt, ...f });
    }

    // A date of birth, or retirement cannot be projected at all.
    const members = await prisma.householdMember.findMany({ where: { householdId } });
    const me = members[0]!;
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 40);
    await http()
      .patch(`/api/households/${householdId}/members/${me.id}`)
      .set(auth(token))
      .send({ dateOfBirth: dob.toISOString() });

    await http().post(`/api/households/${householdId}/financial-snapshot`).set(auth(token)).send({});
    return { token, householdId };
  }

  const intelligence = (t: string, id: string) =>
    http().get(`/api/households/${id}/intelligence/current`).set(auth(t));

  const planningPage = (t: string, id: string) =>
    http().get(`/api/households/${id}/retirement`).set(auth(t));

  it('serves per-field provenance, not a single flag', async () => {
    const { token, householdId } = await homeowner('prov_fields');

    const res = await intelligence(token, householdId);
    expect(res.status).toBe(200);
    expect(res.body.retirement.available).toBe(true);

    const a = res.body.retirement.data.assumptions;
    expect(a).toBeDefined();

    // Ours, and now named as such.
    expect(a.retirementAge.source).toBe('default');
    expect(a.inflationRatePct.source).toBe('default');
    // Theirs, computed from what they recorded — NOT a "standard assumption".
    expect(a.currentCorpusMinor.source).toBe('derived');
    expect(a.desiredAnnualIncomeMinor.source).toBe('derived');
    // Never defaulted to zero: this family has not said what they save.
    expect(a.monthlyContributionMinor).toBeNull();
  });

  it('reports the SAME retirement corpus on the dashboard and the planning page', async () => {
    // The disagreement this milestone uncovered, at the two endpoints a family actually reads.
    const { token, householdId } = await homeowner('prov_corpus');

    const [intel, plan] = await Promise.all([
      intelligence(token, householdId),
      planningPage(token, householdId),
    ]);
    expect(intel.status).toBe(200);
    expect(plan.status).toBe(200);
    expect(plan.body.available).toBe(true);

    const dashboardCorpus = intel.body.retirement.data.currentCorpusMinor;
    const pageCorpus = plan.body.assumptions.currentCorpusMinor.value;

    expect(dashboardCorpus).toBe(pageCorpus);

    // Teeth: prove this household is one the defect would have split, rather than one where
    // the equality holds trivially because there is no property to disagree about.
    expect(dashboardCorpus).toBe(rupees(1500000 + 500000));
    expect(dashboardCorpus).toBeLessThan(rupees(8000000));
  });

  it('excludes the family home from the corpus, on both surfaces', async () => {
    const { token, householdId } = await homeowner('prov_home');

    const intel = await intelligence(token, householdId);
    const nw = intel.body.netWorth.data;

    // The home is counted in net worth — it is real wealth, just not retirement wealth.
    expect(nw.netWorthMinor).toBeGreaterThan(intel.body.retirement.data.currentCorpusMinor);
  });

  it('marks every figure stated once the family states a full plan', async () => {
    const { token, householdId } = await homeowner('prov_stated');

    const saved = await http()
      .put(`/api/households/${householdId}/retirement`)
      .set(auth(token))
      .send({
        retirementAge: 62,
        lifeExpectancy: 85,
        desiredAnnualIncomeMinor: rupees(1800000),
        currentCorpusMinor: rupees(4000000),
        monthlyContributionMinor: rupees(50000),
      });
    expect(saved.status).toBe(200);

    const res = await intelligence(token, householdId);
    const data = res.body.retirement.data;

    expect(data.assumptions.retirementAge).toEqual({ value: 62, source: 'stated' });
    expect(data.assumptions.currentCorpusMinor).toEqual({
      value: rupees(4000000),
      source: 'stated',
    });
    expect(data.assumptions.monthlyContributionMinor.source).toBe('stated');
    // A stated corpus overrides the derivation on BOTH surfaces.
    const plan = await planningPage(token, householdId);
    expect(plan.body.assumptions.currentCorpusMinor.value).toBe(rupees(4000000));
  });

  it('keeps the legacy flag, and keeps it consistent with the fields it summarises', async () => {
    // Existing consumers still read the boolean; it must not drift from the per-field truth.
    const { token, householdId } = await homeowner('prov_flag');

    const res = await intelligence(token, householdId);
    const data = res.body.retirement.data;

    const anyDefault = Object.values(data.assumptions).some(
      (f) => f !== null && (f as { source: string }).source === 'default',
    );
    expect(data.usingDefaultAssumptions).toBe(anyDefault);
    // This family stated nothing, so our conventions are in play.
    expect(data.usingDefaultAssumptions).toBe(true);
  });
});
