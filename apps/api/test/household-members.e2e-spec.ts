import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Household members — the V2 family store, and the figures that depend on it (M5.8 PR 1).
 *
 * See `docs/M5_8_FAMILY_ARCHITECTURE.md`.
 *
 * ## Why this store and not the other one
 *
 * V1's family page writes `FamilyMember`, keyed on `userId`. The Financial Snapshot reads
 * `HouseholdMember`, keyed on `householdId`. Adding family in V1 therefore changed no figure
 * anywhere. These tests assert the consequences that only follow from writing the read table:
 * a date of birth turns retirement on, and a dependant moves the recommended life cover.
 */
describe('Household members (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const PASSWORD = 'Family1pass';

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
  const rupees = (n: number) => n * 100;

  async function newConsumer(prefix: string) {
    const email = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`;
    const reg = await http()
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, fullName: 'Meera Bhuyan' });
    expect(reg.status).toBe(201);
    const token = reg.body.accessToken as string;
    const ws = await http()
      .post('/api/onboarding/household')
      .set(auth(token))
      .send({ familyName: 'The Bhuyans' });
    expect(ws.status).toBe(201);
    return { token, householdId: ws.body.householdId as string, email };
  }

  const members = (t: string, id: string) =>
    http().get(`/api/households/${id}/members`).set(auth(t));

  const addMember = (t: string, id: string, body: Record<string, unknown>) =>
    http().post(`/api/households/${id}/members`).set(auth(t)).send(body);

  /** Enough of a household for the snapshot to compose intelligence from. */
  async function seedFigures(token: string, householdId: string) {
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
      await http()
        .post(`/api/households/${householdId}/cashflow`)
        .set(auth(token))
        .send({ accountId: cash.body.id, currency: 'INR', occurredAt, ...f });
    }
  }

  const capture = (t: string, id: string) =>
    http().post(`/api/households/${id}/financial-snapshot`).set(auth(t)).send({});

  const intelligence = (t: string, id: string) =>
    http().get(`/api/households/${id}/intelligence/current`).set(auth(t));

  const dobYearsAgo = (years: number) => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - years);
    return d.toISOString().slice(0, 10);
  };

  it('creates, lists, edits and removes a member', async () => {
    const { token, householdId } = await newConsumer('fam_crud');

    const created = await addMember(token, householdId, {
      name: 'Arjun Bhuyan',
      relation: 'child',
      dateOfBirth: dobYearsAgo(8),
      isDependent: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Arjun Bhuyan');
    expect(created.body.isDependent).toBe(true);

    const listed = await members(token, householdId);
    expect(listed.body.map((m: { name: string }) => m.name)).toContain('Arjun Bhuyan');

    const edited = await http()
      .patch(`/api/households/${householdId}/members/${created.body.id}`)
      .set(auth(token))
      .send({ name: 'Arjun B', isDependent: false });
    expect(edited.status).toBe(200);
    expect(edited.body.name).toBe('Arjun B');
    expect(edited.body.isDependent).toBe(false);

    const removed = await http()
      .delete(`/api/households/${householdId}/members/${created.body.id}`)
      .set(auth(token));
    expect(removed.status).toBe(200);
    const after = await members(token, householdId);
    expect(after.body.find((m: { id: string }) => m.id === created.body.id)).toBeUndefined();
  });

  it('stores the name encrypted at rest', async () => {
    // The name is PII. It must be unreadable in the row and readable only through the guarded
    // read — otherwise this surface would be a new way to leak what the kernel protects.
    const { token, householdId } = await newConsumer('fam_crypto');
    const created = await addMember(token, householdId, {
      name: 'Lakshmi Bhuyan',
      relation: 'parent',
      isDependent: true,
    });

    const raw = await prisma.householdMember.findUnique({ where: { id: created.body.id } });
    expect(raw).not.toBeNull();
    expect(raw!.name).not.toContain('Lakshmi');
    // Stored format is iv:authTag:ciphertext.
    expect(raw!.name.split(':')).toHaveLength(3);
    // ...and the API returns the plaintext.
    expect(created.body.name).toBe('Lakshmi Bhuyan');
  });

  it('refuses to remove a member who has a sign-in for the household', async () => {
    // `HouseholdMember.userId` is the post-login routing signal. Delete that row and
    // `hasOwnHousehold` goes false while `firms.length > 0` stays true, so the consumer's next
    // sign-in lands them in the Advisor Workspace — exiled from their own product by pressing
    // a delete button on their own name.
    const { token, householdId } = await newConsumer('fam_selfguard');

    const listed = await members(token, householdId);
    const self = listed.body.find((m: { userId: string | null }) => m.userId !== null);
    expect(self).toBeDefined();

    const rejected = await http()
      .delete(`/api/households/${householdId}/members/${self.id}`)
      .set(auth(token));
    expect(rejected.status).toBe(400);

    // Still present, and the routing signal survives.
    const after = await members(token, householdId);
    expect(after.body.find((m: { id: string }) => m.id === self.id)).toBeDefined();
    const status = await http().get('/api/onboarding/status').set(auth(token));
    expect(status.body.hasOwnHousehold).toBe(true);
  });

  it('still removes ordinary members — the guard is narrow', async () => {
    // The other half. A guard that blocked every deletion would be a regression dressed as
    // safety: a family must be able to correct their own list.
    const { token, householdId } = await newConsumer('fam_narrow');
    const spouse = await addMember(token, householdId, {
      name: 'Rohan Bhuyan',
      relation: 'spouse',
      isDependent: false,
    });
    const removed = await http()
      .delete(`/api/households/${householdId}/members/${spouse.body.id}`)
      .set(auth(token));
    expect(removed.status).toBe(200);
  });

  it('is household-scoped — another household is a 404', async () => {
    const a = await newConsumer('fam_scope_a');
    const b = await newConsumer('fam_scope_b');
    const mine = await addMember(a.token, a.householdId, {
      name: 'Private Person',
      relation: 'spouse',
      isDependent: false,
    });

    // B cannot read A's members...
    expect((await members(b.token, a.householdId)).status).toBe(404);
    // ...nor reach one by id through their own household.
    const cross = await http()
      .patch(`/api/households/${b.householdId}/members/${mine.body.id}`)
      .set(auth(b.token))
      .send({ name: 'Renamed' });
    expect(cross.status).toBe(404);
  });

  it('requires authentication', async () => {
    const { householdId } = await newConsumer('fam_anon');
    expect((await http().get(`/api/households/${householdId}/members`)).status).toBe(401);
  });

  it('a date of birth reaches the snapshot as an age', async () => {
    const { token, householdId } = await newConsumer('fam_age');
    await addMember(token, householdId, {
      name: 'Meera Bhuyan',
      relation: 'spouse',
      dateOfBirth: dobYearsAgo(39),
      isDependent: false,
    });
    await seedFigures(token, householdId);
    const snap = await capture(token, householdId);

    const ages = (snap.body.payload.members as { ageYears: number | null }[]).map((m) => m.ageYears);
    expect(ages).toContain(39);
  });

  it('UNLOCKS retirement — the whole point of capturing a date of birth', async () => {
    // Before this milestone no consumer in the product could see a retirement projection: V1
    // never captured a date of birth and onboarding does not set one, so the section reported
    // "No member age available to project retirement" for everybody.
    const { token, householdId } = await newConsumer('fam_retire');
    await seedFigures(token, householdId);
    await capture(token, householdId);

    const before = await intelligence(token, householdId);
    expect(before.body.retirement.available).toBe(false);
    expect(before.body.retirement.reason).toMatch(/age/i);

    const listed = await members(token, householdId);
    const self = listed.body.find((m: { userId: string | null }) => m.userId !== null);
    await http()
      .patch(`/api/households/${householdId}/members/${self.id}`)
      .set(auth(token))
      .send({ dateOfBirth: dobYearsAgo(41) });
    await capture(token, householdId);

    const after = await intelligence(token, householdId);
    expect(after.body.retirement.available).toBe(true);
    expect(after.body.retirement.data.requiredCorpusMinor).toBeGreaterThan(0);
    // The corpus proxy is reconciled net worth — 9,00,000 of cash, no debt.
    expect(after.body.retirement.data.currentCorpusMinor).toBe(rupees(900000));
  });

  it('a dependant raises the recommended life cover', async () => {
    // Dependants are the reason the figure exists. If adding one moved nothing, this surface
    // would be decoration.
    const { token, householdId } = await newConsumer('fam_cover');
    await seedFigures(token, householdId);
    await capture(token, householdId);
    const before = await intelligence(token, householdId);
    expect(before.body.insurance.available).toBe(true);
    const coverBefore = before.body.insurance.data.recommendedCoverMinor;
    const dependantsBefore = before.body.insurance.data.dependents;

    await addMember(token, householdId, {
      name: 'Arjun Bhuyan',
      relation: 'child',
      dateOfBirth: dobYearsAgo(8),
      isDependent: true,
    });
    await capture(token, householdId);

    const after = await intelligence(token, householdId);
    expect(after.body.insurance.data.dependents).toBe(dependantsBefore + 1);
    expect(after.body.insurance.data.recommendedCoverMinor).toBeGreaterThan(coverBefore);
  });
});
