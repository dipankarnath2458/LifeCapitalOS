import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/app.factory';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * M1-4 Households CRUD + HouseholdScopeGuard. Verifies the book boundary: an
 * advisor sees/edits only their assigned households, an owner sees the whole
 * firm, non-members and other firms see nothing (404), the family name is
 * encrypted at rest, reassignment moves the book, and delete is a soft-delete.
 * Needs the DB seeded so the SUPERADMIN account exists.
 */
describe('Households e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let adminToken: string;
  let owner1Token: string;
  let owner1Id: string;
  let owner2Token: string;
  let owner2Id: string;
  let advisorAToken: string;
  let advisorAId: string;
  const advisorAEmail = `hh_advA_${Date.now()}@example.com`;
  let advisorBToken: string;
  let advisorBId: string;
  const advisorBEmail = `hh_advB_${Date.now()}@example.com`;
  let outsiderToken: string;
  let outsiderId: string;

  let firmA: string;
  let firmB: string;
  let h1: string; // assigned to advisor A
  let h2: string; // assigned to advisor B
  let h3: string; // unassigned

  const ts = Date.now();

  async function registerUser(email: string): Promise<{ token: string; id: string }> {
    const reg = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'Passw0rd1', fullName: 'Test User' });
    const token = reg.body.accessToken as string;
    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    return { token, id: me.body.id as string };
  }

  async function addAdvisor(firmId: string, ownerToken: string, email: string, inviteeToken: string) {
    await request(app.getHttpServer())
      .post(`/api/firms/${firmId}/invitations`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email, firmRole: 'ADVISOR' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/firms/${firmId}/accept`)
      .set('Authorization', `Bearer ${inviteeToken}`)
      .expect(201);
  }

  // Collection routes resolve the firm from the x-firm-id header.
  const asFirmA = (token: string) => ({ Authorization: `Bearer ${token}`, 'x-firm-id': firmA });

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);

    adminToken = (
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@lifecapitalos.dev', password: 'Admin@12345' })
    ).body.accessToken;

    ({ token: owner1Token, id: owner1Id } = await registerUser(`hh_owner1_${ts}@example.com`));
    ({ token: owner2Token, id: owner2Id } = await registerUser(`hh_owner2_${ts}@example.com`));
    ({ token: advisorAToken, id: advisorAId } = await registerUser(advisorAEmail));
    ({ token: advisorBToken, id: advisorBId } = await registerUser(advisorBEmail));
    ({ token: outsiderToken, id: outsiderId } = await registerUser(`hh_outsider_${ts}@example.com`));

    firmA = (
      await request(app.getHttpServer())
        .post('/api/firms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Firm A ${ts}`, ownerUserId: owner1Id })
        .expect(201)
    ).body.id;
    firmB = (
      await request(app.getHttpServer())
        .post('/api/firms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Firm B ${ts}`, ownerUserId: owner2Id })
        .expect(201)
    ).body.id;

    await addAdvisor(firmA, owner1Token, advisorAEmail, advisorAToken);
    await addAdvisor(firmA, owner1Token, advisorBEmail, advisorBToken);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('creates households (owner assigns; name round-trips decrypted)', async () => {
    const r1 = await request(app.getHttpServer())
      .post('/api/households')
      .set(asFirmA(owner1Token))
      .send({ name: 'The Sharmas', advisorId: advisorAId })
      .expect(201);
    expect(r1.body.name).toBe('The Sharmas');
    expect(r1.body.advisorId).toBe(advisorAId);
    h1 = r1.body.id;

    h2 = (
      await request(app.getHttpServer())
        .post('/api/households')
        .set(asFirmA(owner1Token))
        .send({ name: 'The Iyers', advisorId: advisorBId })
        .expect(201)
    ).body.id;

    const r3 = await request(app.getHttpServer())
      .post('/api/households')
      .set(asFirmA(owner1Token))
      .send({ name: 'The Khans' })
      .expect(201);
    expect(r3.body.advisorId).toBeNull();
    h3 = r3.body.id;
  });

  it('stores the family name encrypted at rest', async () => {
    const row = await prisma.household.findUnique({ where: { id: h1 } });
    expect(row!.name).not.toBe('The Sharmas');
    expect(row!.name).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/); // iv:tag:ciphertext
  });

  it('rejects creation by a non-member of the firm (404)', async () => {
    await request(app.getHttpServer())
      .post('/api/households')
      .set(asFirmA(outsiderToken))
      .send({ name: 'Nope' })
      .expect(404);
  });

  it('scopes the book: owner sees all, an advisor sees only their assignments', async () => {
    const ownerList = await request(app.getHttpServer())
      .get('/api/households')
      .set(asFirmA(owner1Token))
      .expect(200);
    expect(ownerList.body.total).toBe(3);

    const advAList = await request(app.getHttpServer())
      .get('/api/households')
      .set(asFirmA(advisorAToken))
      .expect(200);
    expect(advAList.body.total).toBe(1);
    expect(advAList.body.data[0].id).toBe(h1);

    const advBList = await request(app.getHttpServer())
      .get('/api/households')
      .set(asFirmA(advisorBToken))
      .expect(200);
    expect(advBList.body.data.map((h: { id: string }) => h.id)).toEqual([h2]);
  });

  it('hides an unassigned or cross-firm household from an advisor / non-member', async () => {
    await request(app.getHttpServer())
      .get(`/api/households/${h1}`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    // advisor A is not assigned h2 -> 404 (not 403), so the book stays private.
    await request(app.getHttpServer())
      .get(`/api/households/${h2}`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(404);
    // owner sees any household in the firm.
    await request(app.getHttpServer())
      .get(`/api/households/${h2}`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .expect(200);
    // an outsider and another firm's owner see nothing.
    await request(app.getHttpServer())
      .get(`/api/households/${h1}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/households/${h1}`)
      .set('Authorization', `Bearer ${owner2Token}`)
      .expect(404);
  });

  it('lets the assigned advisor edit, but not others', async () => {
    await request(app.getHttpServer())
      .patch(`/api/households/${h1}`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({ name: 'The Sharma Family' })
      .expect(200)
      .expect((res) => expect(res.body.name).toBe('The Sharma Family'));

    await request(app.getHttpServer())
      .patch(`/api/households/${h2}`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({ name: 'hijack' })
      .expect(404);
  });

  it('reassigns the book (owner-only) and moves visibility with it', async () => {
    // an advisor cannot reassign
    await request(app.getHttpServer())
      .post(`/api/households/${h1}/assign`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({ advisorId: advisorBId })
      .expect(403);
    // assigning to a non-member is rejected
    await request(app.getHttpServer())
      .post(`/api/households/${h2}/assign`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({ advisorId: outsiderId })
      .expect(400);
    // owner reassigns h1 from advisor A to advisor B
    await request(app.getHttpServer())
      .post(`/api/households/${h1}/assign`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({ advisorId: advisorBId })
      .expect(201)
      .expect((res) => expect(res.body.advisorId).toBe(advisorBId));

    await request(app.getHttpServer())
      .get(`/api/households/${h1}`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/households/${h1}`)
      .set('Authorization', `Bearer ${advisorBToken}`)
      .expect(200);
  });

  it('soft-deletes (owner-only) and hides the household afterwards', async () => {
    // advisor cannot delete
    await request(app.getHttpServer())
      .delete(`/api/households/${h1}`)
      .set('Authorization', `Bearer ${advisorBToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/api/households/${h3}`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/households/${h3}`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .expect(404);
    const ownerList = await request(app.getHttpServer())
      .get('/api/households')
      .set(asFirmA(owner1Token))
      .expect(200);
    expect(ownerList.body.total).toBe(2);
    // the row is retained (soft delete), just hidden.
    expect(await prisma.household.findUnique({ where: { id: h3 } })).not.toBeNull();
  });

  it('lets an advisor create a household, auto-assigned to themselves', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/households')
      .set(asFirmA(advisorAToken))
      .send({ name: 'The Boses' })
      .expect(201);
    expect(res.body.advisorId).toBe(advisorAId);
  });
});
