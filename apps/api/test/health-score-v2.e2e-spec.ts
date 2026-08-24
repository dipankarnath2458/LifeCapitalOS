import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Wealth Health Score v2 (M5.12) — protection and retirement count.
 *
 * See `docs/M5_12_WEALTH_HEALTH_SCORE_V2_ARCHITECTURE.md`.
 *
 * The core tests prove the arithmetic. These prove the **wiring**, which is where the previous
 * two milestones actually broke: M5.9's defect was not a bad formula, it was a service that had
 * the data and a scorer that never received it. So each of these records something through the
 * real API and asserts the household's own score moves — or, just as deliberately, does not.
 */
describe('Wealth Health Score v2 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const PASSWORD = 'Scored1passw';
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

  /** A consumer with a household, cash, income/expenses, a dependant, and a snapshot. */
  async function consumer(prefix: string) {
    const email = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`;
    const reg = await http()
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, fullName: 'Scored Person' });
    expect(reg.status).toBe(201);
    const token = reg.body.accessToken as string;
    const ws = await http().post('/api/onboarding/household').set(auth(token)).send({});
    expect(ws.status).toBe(201);
    const householdId = ws.body.householdId as string;

    const cash = await http()
      .post(`/api/households/${householdId}/accounts`)
      .set(auth(token))
      .send({
        name: 'Cash & savings',
        type: 'bank',
        assetClass: 'cash',
        currency: 'INR',
        balanceMinor: rupees(900000),
        isLiability: false,
      });
    const occurredAt = new Date().toISOString();
    for (const f of [
      { type: 'income', category: 'salary', amountMinor: rupees(300000) },
      { type: 'expense', category: 'living', amountMinor: rupees(75000) },
    ]) {
      await http()
        .post(`/api/households/${householdId}/cashflow`)
        .set(auth(token))
        .send({ accountId: cash.body.id, currency: 'INR', occurredAt, ...f });
    }
    return { token, householdId };
  }

  /** The consumer's own member row, created by onboarding. */
  async function selfMember(householdId: string) {
    const rows = await prisma.householdMember.findMany({ where: { householdId } });
    expect(rows.length).toBeGreaterThan(0);
    return rows[0]!;
  }

  const snapshot = (t: string, id: string) =>
    http().post(`/api/households/${id}/financial-snapshot`).set(auth(t)).send({});

  const score = (t: string, id: string) =>
    http().get(`/api/households/${id}/health-score/current`).set(auth(t));

  const setDob = (t: string, id: string, memberId: string, ageYears: number) => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - ageYears);
    return http()
      .patch(`/api/households/${id}/members/${memberId}`)
      .set(auth(t))
      .send({ dateOfBirth: d.toISOString() });
  };

  it('a household that has recorded nothing is scored on five categories, not seven', async () => {
    // The promise of the milestone to every existing family: telling us nothing changes nothing.
    // Protection and retirement are absent from the breakdown rather than sitting at zero.
    const { token, householdId } = await consumer('hs2_silent');
    await snapshot(token, householdId);

    const res = await score(token, householdId);
    expect(res.status).toBe(200);
    const keys = (res.body.categories as { key: string }[]).map((c) => c.key);

    expect(keys).toEqual([
      'net_worth',
      'debt_burden',
      'savings',
      'liquidity',
      'diversification',
    ]);
    expect(res.body.scoreModelVersion).toBe('fhs-2.0.0');
    expect(res.body.overall).toBeGreaterThan(0);
  });

  it('recording that the family has NO cover lowers the score — the M5.9 measurement, inverted', async () => {
    // M5.9 recorded protection and watched the score go 90 → 90, which is how we learned the
    // score could not see it. This is that same journey with the fix in place.
    const { token, householdId } = await consumer('hs2_uninsured');
    await snapshot(token, householdId);
    const before = await score(token, householdId);

    const me = await selfMember(householdId);
    const recorded = await http()
      .patch(`/api/households/${householdId}/protection/members/${me.id}`)
      .set(auth(token))
      .send({ hasTermCover: false, termLifeCoverMinor: 0, hasHealthInsurance: false });
    expect(recorded.status).toBe(200);

    const after = await score(token, householdId);
    const protection = (after.body.categories as { key: string; score: number }[]).find(
      (c) => c.key === 'protection',
    );

    expect(protection).toBeDefined();
    expect(protection!.score).toBe(0);
    expect(after.body.overall).toBeLessThan(before.body.overall);
    // No new snapshot was captured: the kernel is untouched and the same immutable payload now
    // scores differently because the family told us something the payload never carried.
    expect(after.body.snapshotId).toBe(before.body.snapshotId);
  });

  it('being well covered does not drag the score down', async () => {
    const { token, householdId } = await consumer('hs2_covered');
    await snapshot(token, householdId);
    const before = await score(token, householdId);

    const me = await selfMember(householdId);
    // 15× annual income plus debt is the recommendation; state more than enough.
    await http()
      .patch(`/api/households/${householdId}/protection/members/${me.id}`)
      .set(auth(token))
      .send({
        hasTermCover: true,
        termLifeCoverMinor: rupees(300000 * 12 * 20),
        hasHealthInsurance: true,
      });

    const after = await score(token, householdId);
    const protection = (after.body.categories as { key: string; score: number }[]).find(
      (c) => c.key === 'protection',
    );

    expect(protection!.score).toBe(100);
    expect(after.body.overall).toBeGreaterThanOrEqual(before.body.overall);
  });

  it('a stated retirement plan is scored; no plan is not scored on our defaults', async () => {
    const { token, householdId } = await consumer('hs2_retire');
    const me = await selfMember(householdId);
    await setDob(token, householdId, me.id, 40);
    await snapshot(token, householdId);

    const before = await score(token, householdId);
    expect(
      (before.body.categories as { key: string }[]).some((c) => c.key === 'retirement'),
    ).toBe(false);

    // A deliberately unreachable target, so the direction of the effect is unambiguous.
    const saved = await http()
      .put(`/api/households/${householdId}/retirement`)
      .set(auth(token))
      .send({ retirementAge: 60, desiredAnnualIncomeMinor: rupees(6000000), monthlyContributionMinor: 0 });
    expect(saved.status).toBe(200);

    const after = await score(token, householdId);
    const retirement = (after.body.categories as { key: string; score: number }[]).find(
      (c) => c.key === 'retirement',
    );

    expect(retirement).toBeDefined();
    expect(retirement!.score).toBeLessThan(50);
    expect(after.body.overall).toBeLessThan(before.body.overall);
  });

  it('the score and the intelligence layer agree — one derivation, two consumers', async () => {
    // The reason `HouseholdAssumptionsService` was extracted. If these ever disagree, a family
    // is being shown two different headline numbers depending on which page they opened.
    const { token, householdId } = await consumer('hs2_agree');
    const me = await selfMember(householdId);
    await setDob(token, householdId, me.id, 45);
    await snapshot(token, householdId);

    await http()
      .patch(`/api/households/${householdId}/protection/members/${me.id}`)
      .set(auth(token))
      .send({ hasTermCover: false, termLifeCoverMinor: 0, hasHealthInsurance: true });
    await http()
      .put(`/api/households/${householdId}/retirement`)
      .set(auth(token))
      .send({ retirementAge: 60, monthlyContributionMinor: rupees(20000) });

    const [scored, intel] = await Promise.all([
      score(token, householdId),
      http().get(`/api/households/${householdId}/intelligence/current`).set(auth(token)),
    ]);

    expect(intel.body.wealthHealth.available).toBe(true);
    expect(intel.body.wealthHealth.data.overall).toBe(scored.body.overall);
    expect(intel.body.meta.scoreModelVersion).toBe(scored.body.scoreModelVersion);

    const keysOf = (cats: { key: string }[]) => cats.map((c) => c.key).sort();
    expect(keysOf(intel.body.wealthHealth.data.categories)).toEqual(
      keysOf(scored.body.categories),
    );
  });

  it('a persisted score keeps the model version it was computed under', async () => {
    // Stored scores are historical records. Nothing recomputes them, which is why the timeline
    // has to mark where the model changed rather than pretend one line means one thing.
    const { token, householdId } = await consumer('hs2_persist');
    await snapshot(token, householdId);

    const captured = await http()
      .post(`/api/households/${householdId}/health-score`)
      .set(auth(token))
      .send({});
    expect(captured.status).toBe(201);
    expect(captured.body.scoreModelVersion).toBe('fhs-2.0.0');

    const timeline = await http()
      .get(`/api/households/${householdId}/health-score/timeline`)
      .set(auth(token));
    expect(timeline.status).toBe(200);
    expect(timeline.body).toHaveLength(1);
    // The first point has nothing before it to differ from.
    expect(timeline.body[0].modelChanged).toBe(false);
    expect(timeline.body[0].scoreModelVersion).toBe('fhs-2.0.0');
  });

  it('marks the point where the scoring model changed', async () => {
    // Written against a hand-made history because the real boundary is behind us: every score
    // this build computes is fhs-2.0.0. A family whose history spans both must see the break.
    const { token, householdId } = await consumer('hs2_boundary');
    await snapshot(token, householdId);
    const captured = await http()
      .post(`/api/households/${householdId}/health-score`)
      .set(auth(token))
      .send({});

    const row = await prisma.financialHealthScore.findUnique({ where: { id: captured.body.id } });
    await prisma.financialHealthScore.create({
      data: {
        householdId,
        firmId: row!.firmId,
        snapshotId: row!.snapshotId,
        schemaVersion: row!.schemaVersion,
        scoreModelVersion: 'fhs-1.0.0',
        overall: row!.overall,
        band: row!.band,
        currency: row!.currency,
        categories: row!.categories as never,
        drivers: row!.drivers as never,
        computedAt: new Date(Date.now() - 60_000),
      },
    });

    const timeline = await http()
      .get(`/api/households/${householdId}/health-score/timeline`)
      .set(auth(token));
    const points = timeline.body as { scoreModelVersion: string; modelChanged: boolean }[];

    expect(points).toHaveLength(2);
    expect(points[0]!.scoreModelVersion).toBe('fhs-1.0.0');
    expect(points[0]!.modelChanged).toBe(false);
    expect(points[1]!.scoreModelVersion).toBe('fhs-2.0.0');
    expect(points[1]!.modelChanged).toBe(true);
  });
});
