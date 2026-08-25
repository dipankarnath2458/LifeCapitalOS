import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * What-if and the Wealth Health Score must report the same "before" (M5.13).
 *
 * See `docs/M5_13_WHATIF_AND_BUDGET_ARCHITECTURE.md`.
 *
 * M5.12 made protection and retirement scored categories and taught the *engine* to accept them,
 * but `HouseholdSimulationService` never passed them. Every simulation therefore scored a
 * five-category baseline while the family's dashboard scored six or seven. Nothing failed: both
 * numbers were internally consistent, and the family was simply shown two different Wealth Health
 * Scores depending on which page they opened.
 *
 * That is why this suite asserts an **equality between two endpoints** rather than a property of
 * one. A test of the simulation alone would have passed throughout the defect.
 */
describe('What-if agrees with the Wealth Health Score (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const PASSWORD = 'Simulate1pass';
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

  async function consumer(prefix: string) {
    const email = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`;
    const reg = await http()
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, fullName: 'Simulating Person' });
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
    expect(cash.status).toBe(201);
    const occurredAt = new Date().toISOString();
    for (const f of [
      { type: 'income', category: 'salary', amountMinor: rupees(300000) },
      { type: 'expense', category: 'living', amountMinor: rupees(75000) },
    ]) {
      const tx = await http()
        .post(`/api/households/${householdId}/cashflow`)
        .set(auth(token))
        .send({ accountId: cash.body.id, currency: 'INR', occurredAt, ...f });
      expect(tx.status).toBe(201);
    }
    return { token, householdId };
  }

  async function selfMember(householdId: string) {
    const rows = await prisma.householdMember.findMany({ where: { householdId } });
    expect(rows.length).toBeGreaterThan(0);
    return rows[0]!;
  }

  const snapshot = (t: string, id: string) =>
    http().post(`/api/households/${id}/financial-snapshot`).set(auth(t)).send({});

  const score = (t: string, id: string) =>
    http().get(`/api/households/${id}/health-score/current`).set(auth(t));

  /** A scenario every household can run, chosen because it never fails on an empty position. */
  const simulate = (t: string, id: string) =>
    http()
      .post(`/api/households/${id}/simulation`)
      .set(auth(t))
      .send({
        scenarios: [{ type: 'reduce_expenses', params: { monthlyAmountMinor: rupees(1000) } }],
      });

  const setDob = (t: string, id: string, memberId: string, ageYears: number) => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - ageYears);
    return http()
      .patch(`/api/households/${id}/members/${memberId}`)
      .set(auth(t))
      .send({ dateOfBirth: d.toISOString() });
  };

  /** The assertion the milestone rests on, used by every case below. */
  async function expectAgreement(token: string, householdId: string) {
    const [scored, sim] = await Promise.all([score(token, householdId), simulate(token, householdId)]);
    expect(scored.status).toBe(200);
    expect(sim.status).toBe(201);
    expect(sim.body.available).toBe(true);

    expect(sim.body.result.summary.overallBefore).toBe(scored.body.overall);
    expect(sim.body.result.summary.bandBefore).toBe(scored.body.band);
    expect(sim.body.result.metadata.scoreModelVersion).toBe(scored.body.scoreModelVersion);

    const keys = (cats: { key: string }[]) => cats.map((c) => c.key).sort();
    expect(keys(sim.body.result.categoryImpacts)).toEqual(keys(scored.body.categories));
    return { scored, sim };
  }

  it('agrees for a family that has stated nothing', async () => {
    // The control. This case passed throughout the defect — both sides scored five categories —
    // which is precisely why it is not sufficient on its own.
    const { token, householdId } = await consumer('sim_silent');
    await snapshot(token, householdId);

    const { sim } = await expectAgreement(token, householdId);
    expect(sim.body.result.categoryImpacts).toHaveLength(5);
  });

  it('agrees for a family that has stated it holds NO cover', async () => {
    // The case that diverged by 16 points before the fix: the dashboard scored protection at 0,
    // the simulation did not score protection at all and reported a materially higher "before".
    const { token, householdId } = await consumer('sim_uninsured');
    await snapshot(token, householdId);

    const me = await selfMember(householdId);
    const recorded = await http()
      .patch(`/api/households/${householdId}/protection/members/${me.id}`)
      .set(auth(token))
      .send({ hasTermCover: false, termLifeCoverMinor: 0, hasHealthInsurance: false });
    expect(recorded.status).toBe(200);

    const { sim } = await expectAgreement(token, householdId);
    // Teeth: prove the household really is one the defect would have split, rather than a
    // household where protection happens to be absent and the equality is trivially true.
    expect(
      (sim.body.result.categoryImpacts as { key: string }[]).some((c) => c.key === 'protection'),
    ).toBe(true);
  });

  it('agrees for a family that has stated a retirement plan', async () => {
    const { token, householdId } = await consumer('sim_retire');
    const me = await selfMember(householdId);
    await setDob(token, householdId, me.id, 40);
    await snapshot(token, householdId);

    const saved = await http()
      .put(`/api/households/${householdId}/retirement`)
      .set(auth(token))
      .send({ retirementAge: 60, desiredAnnualIncomeMinor: rupees(600000), monthlyContributionMinor: rupees(20000) });
    expect(saved.status).toBe(200);

    const { sim } = await expectAgreement(token, householdId);
    expect(
      (sim.body.result.categoryImpacts as { key: string }[]).some((c) => c.key === 'retirement'),
    ).toBe(true);
  });

  it('agrees for a family that has stated both, and scores all seven categories', async () => {
    const { token, householdId } = await consumer('sim_both');
    const me = await selfMember(householdId);
    await setDob(token, householdId, me.id, 45);
    await snapshot(token, householdId);

    await http()
      .patch(`/api/households/${householdId}/protection/members/${me.id}`)
      .set(auth(token))
      .send({ hasTermCover: true, termLifeCoverMinor: rupees(10000000), hasHealthInsurance: true });
    await http()
      .put(`/api/households/${householdId}/retirement`)
      .set(auth(token))
      .send({ retirementAge: 60, monthlyContributionMinor: rupees(30000) });

    const { sim } = await expectAgreement(token, householdId);
    expect(sim.body.result.categoryImpacts).toHaveLength(7);
  });

  it('reports a scenario delta that is the scenario\'s own effect, not a model difference', async () => {
    // The subtler half of the defect. Even where "before" happened to round to the same integer,
    // the delta was computed between a five-category baseline and a five-category virtual while
    // the family's real model had seven — so the number a family was invited to act on was not
    // the change they would actually see.
    const { token, householdId } = await consumer('sim_delta');
    const me = await selfMember(householdId);
    await setDob(token, householdId, me.id, 45);
    await snapshot(token, householdId);
    await http()
      .patch(`/api/households/${householdId}/protection/members/${me.id}`)
      .set(auth(token))
      .send({ hasTermCover: false, termLifeCoverMinor: 0, hasHealthInsurance: false });

    const sim = await simulate(token, householdId);
    const { overallBefore, overallAfter, overallDelta } = sim.body.result.summary;
    expect(overallAfter - overallBefore).toBe(overallDelta);

    // Protection is unchanged by an expenses scenario, so it must show a zero impact rather than
    // being absent from one side of the comparison.
    const protection = (sim.body.result.categoryImpacts as { key: string; delta: number; direction: string }[]).find(
      (c) => c.key === 'protection',
    );
    expect(protection).toBeDefined();
    expect(protection!.delta).toBe(0);
    expect(protection!.direction).toBe('unchanged');
  });
});
