import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Household protection (M5.9).
 *
 * See `docs/M5_9_PROTECTION_ARCHITECTURE.md`.
 *
 * The milestone is a **data path**, not a form, so most of these tests assert what the
 * intelligence layer says once protection is recorded — not merely that a row was written.
 *
 * The distinction under test throughout: **not asked is not the same as no cover.**
 */
describe('Household protection (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const PASSWORD = 'Protect1pass';
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

  /** A consumer with a household, a cash account, income/expenses and a captured snapshot. */
  async function consumer(prefix: string) {
    const email = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`;
    const reg = await http()
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, fullName: 'Protected Person' });
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
    await http().post(`/api/households/${householdId}/financial-snapshot`).set(auth(token)).send({});
    return { token, householdId };
  }

  const overview = (t: string, id: string) =>
    http().get(`/api/households/${id}/protection`).set(auth(t));

  const record = (t: string, id: string, memberId: string, body: Record<string, unknown>) =>
    http()
      .patch(`/api/households/${id}/protection/members/${memberId}`)
      .set(auth(t))
      .send(body);

  const intelligence = (t: string, id: string) =>
    http().get(`/api/households/${id}/intelligence/current`).set(auth(t));

  /** The household's only member is the consumer themselves, created by onboarding. */
  async function selfMember(householdId: string) {
    const rows = await prisma.householdMember.findMany({ where: { householdId } });
    expect(rows.length).toBeGreaterThan(0);
    return rows[0]!;
  }

  it('starts with every answer null — not false', async () => {
    // The single most important row-level assertion in this milestone. A default of `false`
    // would record every household we have never asked as having told us it has no insurance.
    const { token, householdId } = await consumer('prot_null');
    const me = await selfMember(householdId);

    expect(me.hasTermCover).toBeNull();
    expect(me.hasHealthInsurance).toBeNull();
    expect(me.termLifeCoverMinor).toBeNull();

    const res = await overview(token, householdId);
    expect(res.status).toBe(200);
    expect(res.body.coverTracked).toBe(false);
    expect(res.body.summary).toBeNull();
    expect(res.body.unansweredMemberIds).toContain(me.id);
  });

  it('an unrecorded household is not assessed, and no protection claim reaches the coach', async () => {
    // Ties the #67 hotfix to the data path: with nothing recorded the layer must both decline
    // to report a gap AND emit no insurance risk signal.
    const { token, householdId } = await consumer('prot_unknown');
    const intel = await intelligence(token, householdId);

    expect(intel.body.insurance.available).toBe(false);
    expect(intel.body.insurance.reason).toMatch(/insurance details/i);
    expect(intel.body.meta.dataCompleteness.missing).toContain('insurancePolicies');

    expect((intel.body.risk.data.topRisks as { key: string }[]).map((r) => r.key)).not.toContain(
      'insurance',
    );
    // `risk` is on the AI coach's allow-list, so the claim must not survive anywhere in it.
    expect(JSON.stringify(intel.body.risk)).not.toMatch(/no term cover|no health cover/);
  });

  it('recording cover makes the layer assess protection — the data path end to end', async () => {
    // The milestone in one test. Before M5.9 this was impossible: the controller never passed
    // `assumptions`, so no answer a family gave could change a single figure.
    const { token, householdId } = await consumer('prot_path');
    const me = await selfMember(householdId);

    const before = await intelligence(token, householdId);
    expect(before.body.insurance.available).toBe(false);

    const saved = await record(token, householdId, me.id, {
      hasTermCover: true,
      hasHealthInsurance: true,
      termLifeCoverMinor: rupees(60000000),
    });
    expect(saved.status).toBe(200);

    const after = await intelligence(token, householdId);
    expect(after.body.insurance.available).toBe(true);
    expect(after.body.insurance.confidence).toBe('high');
    expect(after.body.insurance.data.existingCoverMinor).toBe(rupees(60000000));
    expect(after.body.insurance.data.status).toBe('green');
    expect(after.body.insurance.data.protectionGapMinor).toBe(0);
    expect(after.body.meta.dataCompleteness.missing).not.toContain('insurancePolicies');
  });

  it('an explicit "no cover" is a finding, not silence', async () => {
    // The other half of the distinction. A family who tells us they hold nothing must get a
    // real red — the answer is information, and swallowing it would be its own defect.
    const { token, householdId } = await consumer('prot_none');
    const me = await selfMember(householdId);

    await record(token, householdId, me.id, { hasTermCover: false, hasHealthInsurance: false });

    const intel = await intelligence(token, householdId);
    expect(intel.body.insurance.available).toBe(true);
    expect(intel.body.insurance.data.status).toBe('red');
    expect(intel.body.insurance.data.protectionGapMinor).toBe(
      intel.body.insurance.data.recommendedCoverMinor,
    );

    const signal = (intel.body.risk.data.topRisks as { key: string; detail: string }[]).find(
      (r) => r.key === 'insurance',
    );
    expect(signal).toBeDefined();
    expect(signal!.detail).toBe('no term cover, no health cover');
  });

  it('a partly-answered family is still not assessed', async () => {
    // A gap computed from half a household is the fabrication this milestone removes. Adding a
    // second member re-opens the question, and the layer must go quiet again until they answer.
    const { token, householdId } = await consumer('prot_partial');
    const me = await selfMember(householdId);
    await record(token, householdId, me.id, {
      hasTermCover: true,
      hasHealthInsurance: true,
      termLifeCoverMinor: rupees(60000000),
    });
    expect((await intelligence(token, householdId)).body.insurance.available).toBe(true);

    const spouse = await http()
      .post(`/api/households/${householdId}/members`)
      .set(auth(token))
      .send({ name: 'Meera Bhuyan', relation: 'spouse', isDependent: false });
    expect(spouse.status).toBe(201);

    const res = await overview(token, householdId);
    expect(res.body.coverTracked).toBe(false);
    expect(res.body.unansweredMemberIds).toEqual([spouse.body.id]);
    expect((await intelligence(token, householdId)).body.insurance.available).toBe(false);

    // Once they answer, the household is assessable again — and the spouse's cover is ADDED,
    // because life cover replaces the household's income, not one person's.
    await record(token, householdId, spouse.body.id, {
      hasTermCover: true,
      hasHealthInsurance: true,
      termLifeCoverMinor: rupees(20000000),
    });
    const after = await intelligence(token, householdId);
    expect(after.body.insurance.available).toBe(true);
    expect(after.body.insurance.data.existingCoverMinor).toBe(rupees(80000000));
  });

  it('one uninsured child leaves the family without health cover', async () => {
    // `hasHealthInsurance` is EVERY member, dependants included. An "any" rule would let a
    // household with an uninsured child read as covered — medical exposure is per person.
    const { token, householdId } = await consumer('prot_child');
    const me = await selfMember(householdId);
    await record(token, householdId, me.id, {
      hasTermCover: true,
      hasHealthInsurance: true,
      termLifeCoverMinor: rupees(60000000),
    });
    const child = await http()
      .post(`/api/households/${householdId}/members`)
      .set(auth(token))
      .send({ name: 'Arun Bhuyan', relation: 'child', isDependent: true });
    await record(token, householdId, child.body.id, { hasHealthInsurance: false });

    const res = await overview(token, householdId);
    expect(res.body.coverTracked).toBe(true);
    expect(res.body.summary.hasHealthInsurance).toBe(false);
    // A dependant is never asked about term cover, so an unanswered one must not block the
    // household — otherwise the family could never reach an assessment.
    expect(res.body.unansweredMemberIds).toHaveLength(0);

    const signal = (
      (await intelligence(token, householdId)).body.risk.data.topRisks as {
        key: string;
        detail: string;
      }[]
    ).find((r) => r.key === 'insurance');
    expect(signal!.detail).toBe('term cover ✓, no health cover');
  });

  it('omitting a field leaves the stored answer alone rather than un-answering it', async () => {
    const { token, householdId } = await consumer('prot_partialpatch');
    const me = await selfMember(householdId);
    await record(token, householdId, me.id, { hasTermCover: false, hasHealthInsurance: true });
    await record(token, householdId, me.id, { hasHealthInsurance: false });

    const row = await prisma.householdMember.findUnique({ where: { id: me.id } });
    expect(row!.hasTermCover).toBe(false);
    expect(row!.hasHealthInsurance).toBe(false);
  });

  it('is household-scoped, and refuses an actor who is not a member', async () => {
    const a = await consumer('prot_scope_a');
    const b = await consumer('prot_scope_b');
    const mine = await selfMember(a.householdId);

    expect((await overview(b.token, a.householdId)).status).toBe(404);
    expect(
      (await record(b.token, a.householdId, mine.id, { hasHealthInsurance: true })).status,
    ).toBe(404);

    // An advisor can reach a client household in their firm, but must not record an answer they
    // cannot have given. Same boundary as household goals (M5.8 PR 2).
    const client = await http()
      .post('/api/households')
      .set(auth(a.token))
      .send({ name: 'Client Family', baseCurrency: 'INR' });
    expect(client.status).toBe(201);
    expect((await overview(a.token, client.body.id)).status).toBe(200);
    const clientMember = await http()
      .post(`/api/households/${client.body.id}/members`)
      .set(auth(a.token))
      .send({ name: 'Client Person', relation: 'self', isDependent: false });
    const rejected = await record(a.token, client.body.id, clientMember.body.id, {
      hasHealthInsurance: true,
    });
    expect(rejected.status).toBe(403);
  });

  it('requires authentication', async () => {
    const { householdId } = await consumer('prot_anon');
    expect((await http().get(`/api/households/${householdId}/protection`)).status).toBe(401);
  });

  it('leaves the V1 retail protection path untouched', async () => {
    // V1's Protection component writes `Profile`, and `/dashboard` still renders it. Recording
    // household protection must not write there, and must not read from there either.
    const { token, householdId } = await consumer('prot_v1');
    const me = await selfMember(householdId);
    await record(token, householdId, me.id, {
      hasTermCover: true,
      hasHealthInsurance: true,
      termLifeCoverMinor: rupees(60000000),
    });

    const profile = await http().get('/api/profile').set(auth(token));
    expect(profile.status).toBe(200);
    expect(profile.body.hasTermCover).toBeFalsy();
    expect(Number(profile.body.termLifeCoverMinor ?? 0)).toBe(0);
  });
});
