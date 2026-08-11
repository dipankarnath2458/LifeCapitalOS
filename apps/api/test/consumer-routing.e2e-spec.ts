import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Consumer routing — the signal that distinguishes a consumer from an advisor.
 *
 * ## The defect this guards
 *
 * Since M5.5 every consumer is given a personal firm at onboarding. Post-login routing
 * asked "do you belong to a firm?", which then became true for consumers too — so an
 * onboarded consumer was sent to the Advisor Workspace on their next login.
 *
 * The fix records the consumer as a member of their OWN household
 * (`HouseholdMember.userId`), which is the model's own user↔household link and means
 * something firm membership cannot: *this money is mine, not my client's*.
 */
describe('Consumer routing signal (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const PASSWORD = 'Routing1pass';

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

  async function newUser(prefix: string) {
    const email = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`;
    const reg = await http()
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, fullName: 'Routing Probe' });
    expect(reg.status).toBe(201);
    return { email, token: reg.body.accessToken as string, userId: reg.body.user?.id as string };
  }

  const status = (token: string) =>
    http().get('/api/onboarding/status').set('Authorization', `Bearer ${token}`);

  async function adminToken(): Promise<string> {
    const res = await http()
      .post('/api/auth/login')
      .send({ email: 'admin@lifecapitalos.dev', password: 'Admin@12345' });
    return res.body.accessToken as string;
  }

  /**
   * A FRESH user who is a genuine advisory-firm member.
   *
   * Deliberately not the seeded admin: that account is shared across suites, so whether it
   * owns a household depends on what ran before. These tests assert on ownership, so they
   * provision their own advisor rather than inheriting one.
   */
  async function newAdvisor(prefix: string) {
    const advisor = await newUser(prefix);
    const admin = await adminToken();
    const adminMe = await http().get('/api/auth/me').set('Authorization', `Bearer ${admin}`);

    const firm = await http()
      .post('/api/firms')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: `Advisory ${prefix} ${Date.now()}`, ownerUserId: adminMe.body.id });
    expect(firm.status).toBe(201);

    const invite = await http()
      .post(`/api/firms/${firm.body.id}/invitations`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ email: advisor.email, firmRole: 'ADVISOR' });
    expect([200, 201]).toContain(invite.status);

    const accept = await http()
      .post(`/api/firms/${firm.body.id}/accept`)
      .set('Authorization', `Bearer ${advisor.token}`)
      .send({});
    expect([200, 201]).toContain(accept.status);

    return { ...advisor, firmId: firm.body.id as string, admin };
  }

  it('a brand-new user owns no household — the intended fallback', async () => {
    const { token } = await newUser('route_new');
    const res = await status(token);
    expect(res.status).toBe(200);
    expect(res.body.hasHousehold).toBe(false);
    expect(res.body.hasOwnHousehold).toBe(false);
  });

  it('a personal advisor with a valid household OWNS it — routes to the consumer home', async () => {
    // The production defect, asserted at its source: after onboarding this user has a firm,
    // so firm membership alone would say "advisor". Own-household membership says consumer.
    const { token } = await newUser('route_consumer');
    const provisioned = await http()
      .post('/api/onboarding/household')
      .set('Authorization', `Bearer ${token}`)
      .send({ familyName: 'The Routers' });
    expect(provisioned.status).toBe(201);

    const firms = await http().get('/api/firms/me').set('Authorization', `Bearer ${token}`);
    expect(firms.body.firms).toHaveLength(1); // would have meant "advisor" before this fix

    const res = await status(token);
    expect(res.body.hasOwnHousehold).toBe(true);
    expect(res.body.ownHouseholdId).toBe(provisioned.body.householdId);
  });

  it('an advisory firm member does NOT own their client households', async () => {
    // An advisor is a household's advisorId, never one of its members — so they keep the
    // Advisor Workspace. This is the half of the fix that must not regress.
    const advisor = await newAdvisor('route_advisor');

    await http()
      .post(`/api/firms/${advisor.firmId}/switch`)
      .set('Authorization', `Bearer ${advisor.token}`)
      .send({});
    const client = await http()
      .post('/api/households')
      .set('Authorization', `Bearer ${advisor.token}`)
      .send({ name: 'Client Family', baseCurrency: 'INR' });
    expect(client.status).toBe(201);

    const owns = await prisma.householdMember.findFirst({
      where: { householdId: client.body.id, userId: advisor.userId },
    });
    expect(owns).toBeNull();

    const res = await status(advisor.token);
    expect(res.body.hasOwnHousehold).toBe(false);
  });

  it('never mutates the membership of a household it did not create', async () => {
    // Replaces an earlier test that asserted a self-membership BACKFILL. That backfill was
    // removed: its guard (`advisorId === caller`) is true for an advisor and their client's
    // household, so it wrote advisors into client records. See the note in
    // `onboarding.service.ts`.
    //
    // The property that replaces it is stronger and simpler: provisioning either creates a
    // complete workspace, or returns an existing one untouched. It never edits membership
    // it did not write.
    const { token } = await newUser('route_untouched');
    const provisioned = await http()
      .post('/api/onboarding/household')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    const householdId = provisioned.body.householdId as string;

    // A household whose membership has drifted for any reason.
    await prisma.householdMember.deleteMany({ where: { householdId } });

    const again = await http()
      .post('/api/onboarding/household')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(again.body.provisioned).toBe(false);
    expect(again.body.householdId).toBe(householdId);

    // Left exactly as found — no repair, no invention.
    expect(await prisma.householdMember.count({ where: { householdId } })).toBe(0);
  });

  it('creates the household and its self-member row atomically', async () => {
    // This is what makes the absence of a backfill safe: a new gap cannot appear, because
    // both rows are written in one transaction.
    const { token, email } = await newUser('route_atomic');
    const provisioned = await http()
      .post('/api/onboarding/household')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(provisioned.status).toBe(201);

    const user = await prisma.user.findUnique({ where: { email } });
    const member = await prisma.householdMember.findFirst({
      where: { householdId: provisioned.body.householdId, userId: user!.id },
    });
    expect(member).not.toBeNull();
    expect(member!.relation).toBe('self');
    expect((await status(token)).body.hasOwnHousehold).toBe(true);
  });

  it('never adds a synthetic member to a household that already has real members', async () => {
    // The backfill must not invent family data, and must never make an advisor a member of
    // a client household.
    const { token } = await newUser('route_nosynth');
    const provisioned = await http()
      .post('/api/onboarding/household')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    const householdId = provisioned.body.householdId as string;

    await prisma.householdMember.deleteMany({ where: { householdId } });
    await prisma.householdMember.create({
      data: { householdId, name: 'encrypted', relation: 'spouse', isDependent: false },
    });

    await http()
      .post('/api/onboarding/household')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    const members = await prisma.householdMember.findMany({ where: { householdId } });
    expect(members).toHaveLength(1);
    expect(members[0].relation).toBe('spouse');
  });

  it('stays idempotent when the caller already belongs to a household-less firm', async () => {
    // A user can belong to a firm that has no households yet — a seeded admin, or an
    // advisor whose firm has no clients. Resolving the workspace from only their FIRST
    // membership made them look workspace-less, and since provisioning reads that as
    // "create one", every call minted another firm. Measured before the fix: three calls,
    // three new firms, each reporting provisioned: true.
    const advisor = await newAdvisor('route_emptyfirm');

    const first = await http()
      .post('/api/onboarding/household')
      .set('Authorization', `Bearer ${advisor.token}`)
      .send({});
    expect(first.status).toBe(201);

    const afterFirst = await http()
      .get('/api/firms/me')
      .set('Authorization', `Bearer ${advisor.token}`);
    const firmCount = afterFirst.body.firms.length;

    for (let i = 0; i < 2; i += 1) {
      const again = await http()
        .post('/api/onboarding/household')
        .set('Authorization', `Bearer ${advisor.token}`)
        .send({});
      expect(again.body.provisioned).toBe(false);
      expect(again.body.householdId).toBe(first.body.householdId);
    }

    const atEnd = await http().get('/api/firms/me').set('Authorization', `Bearer ${advisor.token}`);
    expect(atEnd.body.firms).toHaveLength(firmCount);

    const st = await status(advisor.token);
    expect(st.body.hasHousehold).toBe(true);
    expect(st.body.householdId).toBeTruthy();
  });

  it('NEVER writes an advisor into a client household', async () => {
    // The hazard: `ensureSelfMembership` guarded on `advisorId === caller`, which is TRUE
    // for an advisor and their client's household — that is what "assigned advisor" means.
    // Combined with "no members yet" (normal for a new client), calling any surface that
    // provisions would write the advisor into the client's household as `self`.
    //
    // The consequence is worse than a stray row: `hasOwnHousehold` then flips true and the
    // advisor is routed to the CONSUMER dashboard showing their client's finances as their
    // own. Demonstrated against a running API before this fix.
    const advisor = await newAdvisor('guard_advisor');

    await http()
      .post(`/api/firms/${advisor.firmId}/switch`)
      .set('Authorization', `Bearer ${advisor.token}`)
      .send({});
    const client = await http()
      .post('/api/households')
      .set('Authorization', `Bearer ${advisor.token}`)
      .send({ name: 'Client Family', baseCurrency: 'INR' });
    expect(client.status).toBe(201);

    // Assign the advisor to the client household — the ordinary advisory arrangement, and
    // exactly the state that satisfied the old guard.
    await prisma.household.update({
      where: { id: client.body.id },
      data: { advisorId: advisor.userId },
    });
    expect(await prisma.householdMember.count({ where: { householdId: client.body.id } })).toBe(0);

    // Any surface that provisions: onboarding, the Wealth Health Check.
    await http()
      .post('/api/onboarding/household')
      .set('Authorization', `Bearer ${advisor.token}`)
      .send({});

    // The client household must be untouched...
    expect(await prisma.householdMember.count({ where: { householdId: client.body.id } })).toBe(0);
    // ...and the advisor must NOT be treated as a consumer who owns it.
    const st = await status(advisor.token);
    expect(st.body.hasOwnHousehold).toBe(false);
  });

  it('requires authentication', async () => {
    expect((await http().get('/api/onboarding/status')).status).toBe(401);
  });
});
