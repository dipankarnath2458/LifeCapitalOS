import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Family CFO (M5.7) — the V2 consumer AI surface.
 *
 * See `docs/M5_7_AI_INSIGHTS_ARCHITECTURE.md`.
 *
 * **Model output is never asserted.** An LLM reply is not deterministic, and a test that pinned
 * its wording would either be meaningless or permanently flaky. What must hold is everything
 * around it: that the answer is grounded on the same snapshot the dashboard reads, that absence
 * is reported rather than narrated, that nothing is fabricated when no model is configured, and
 * that the surface is scoped and read-only.
 *
 * CI runs with no `ANTHROPIC_API_KEY`, so these exercise the deterministic path — which is
 * exactly the path a production outage or a missing key would take, and therefore the one that
 * most needs to be correct.
 */
describe('Family CFO (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const PASSWORD = 'Cfo1password';
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

  /** The same sequence the Wealth Health Check performs, with a loan. */
  async function completeCheck(token: string, householdId: string) {
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

    await http()
      .post(`/api/households/${householdId}/debts`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Loan',
        type: 'other',
        currency: 'INR',
        principalMinor: rupees(400000),
        outstandingMinor: rupees(400000),
        annualInterestRatePct: 9,
        minimumPaymentMinor: rupees(12000),
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

    const snap = await http()
      .post(`/api/households/${householdId}/financial-snapshot`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(snap.status).toBe(201);
    return snap.body;
  }

  const insights = (token: string, householdId: string) =>
    http()
      .post(`/api/households/${householdId}/ai/insights`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

  it('reports "no snapshot" instead of narrating an empty balance sheet', async () => {
    // The failure this guards is the worst one available to an AI surface: fluent, confident
    // advice for a family whose figures it never actually had.
    const { token, householdId } = await newConsumer('cfo_empty');
    const res = await insights(token, householdId);
    expect(res.status).toBe(201);
    expect(res.body.available).toBe(false);
    expect(res.body.reason).toBeTruthy();
    expect(res.body.answer).toBeUndefined();
  });

  it('answers from the same snapshot the dashboard reads', async () => {
    // The M5.6 property, extended to the AI: one snapshot, one set of numbers. If the coach
    // could ground on a different snapshot than the dashboard, the two would quietly disagree
    // about the same family with nothing on screen to say so.
    const { token, householdId } = await newConsumer('cfo_parity');
    const snapshot = await completeCheck(token, householdId);

    const res = await insights(token, householdId);
    expect(res.status).toBe(201);
    expect(res.body.available).toBe(true);
    expect(res.body.snapshotId).toBe(snapshot.id);

    const dash = await http()
      .get(`/api/households/${householdId}/intelligence/current`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.snapshotId).toBe(dash.body.meta.snapshotId);
  });

  it('falls back to the layer’s own narrative, labelled as such, and fabricates nothing', async () => {
    // No ANTHROPIC_API_KEY in CI. The answer must still be real analysis — and must not claim to
    // be an AI reply, because telling a user a template was personalised advice is a lie about
    // provenance.
    const { token, householdId } = await newConsumer('cfo_fallback');
    await completeCheck(token, householdId);

    const res = await insights(token, householdId);
    expect(res.body.ai).toBe(false);
    expect(typeof res.body.answer).toBe('string');
    expect(res.body.answer.length).toBeGreaterThan(0);

    // Every sentence traces to the engine: the headline it returns IS the engine's headline.
    const dash = await http()
      .get(`/api/households/${householdId}/intelligence/current`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.answer).toContain(dash.body.executiveSummary.headline);
    expect(res.body.actions).toEqual(dash.body.recommendedActions);
  });

  it('never states a net worth that ignores the family’s loan', async () => {
    // Guards the hotfix that preceded this milestone from being undone underneath the AI. The
    // executive summary is the text the model repeats verbatim, so a gross figure here would be
    // narrated with confidence.
    const { token, householdId } = await newConsumer('cfo_debt');
    await completeCheck(token, householdId);

    const dash = await http()
      .get(`/api/households/${householdId}/intelligence/current`)
      .set('Authorization', `Bearer ${token}`);
    // 20L of assets less a 4L loan.
    expect(dash.body.netWorth.data.netWorthMinor).toBe(rupees(1600000));

    const res = await insights(token, householdId);
    // Asserted as the family reads it. The summary is prose shown to a consumer, so it states
    // ₹16,00,000 — not the raw minor-unit integer, which is what shipped first and put
    // "Net worth is 782000000 (base INR, minor units)" in front of a real user.
    expect(res.body.answer).toContain('₹16,00,000');
    expect(res.body.answer).not.toContain('minor units');
    expect(res.body.answer).not.toContain(String(rupees(1600000)));
    // The gross figure must not appear in any form.
    expect(res.body.answer).not.toContain('₹20,00,000');
    expect(res.body.answer).not.toContain(String(rupees(2000000)));
  });

  it('gates the conversation on the premium entitlement, but never the summary', async () => {
    // The product split recorded in §6 of the architecture doc: a consumer should not hit a
    // paywall to read a sentence about figures already on their own dashboard.
    const { token, householdId } = await newConsumer('cfo_gate');
    await completeCheck(token, householdId);

    const summary = await insights(token, householdId);
    expect(summary.status).toBe(201);
    expect(summary.body.available).toBe(true);

    const chat = await http()
      .post(`/api/households/${householdId}/ai/coach`)
      .set('Authorization', `Bearer ${token}`)
      .send({ messages: [{ role: 'user', content: 'How am I doing?' }] });
    expect(chat.status).toBe(403);
  });

  it('is read-only — asking captures no snapshot and writes no financial row', async () => {
    const { token, householdId } = await newConsumer('cfo_readonly');
    await completeCheck(token, householdId);

    const before = await prisma.financialSnapshot.count({ where: { householdId } });
    const accountsBefore = await prisma.account.count({ where: { householdId } });

    await insights(token, householdId);
    await insights(token, householdId);

    expect(await prisma.financialSnapshot.count({ where: { householdId } })).toBe(before);
    expect(await prisma.account.count({ where: { householdId } })).toBe(accountsBefore);
  });

  it('is household-scoped — another family’s household is a 404', async () => {
    const mine = await newConsumer('cfo_mine');
    const theirs = await newConsumer('cfo_theirs');
    await completeCheck(theirs.token, theirs.householdId);

    const res = await http()
      .post(`/api/households/${theirs.householdId}/ai/insights`)
      .set('Authorization', `Bearer ${mine.token}`)
      .send({});
    expect(res.status).toBe(404);
  });

  it('requires authentication', async () => {
    const res = await http().post('/api/households/whatever/ai/insights').send({});
    expect(res.status).toBe(401);
  });
});
