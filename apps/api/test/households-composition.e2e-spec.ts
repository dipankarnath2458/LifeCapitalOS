import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/app.factory';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * M1-5 Household members & entities (MOD-3.2/3.3). Verifies scoped CRUD on a
 * household's people and legal entities: only in-scope firm users can read/write
 * them, writes need a data-entry role (analyst is read-only), a resource can't be
 * reached through the wrong household, and names/taxId are encrypted at rest.
 */
describe('Household members & entities e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let adminToken: string;
  let owner1Token: string;
  let owner1Id: string;
  let advisorAToken: string;
  let advisorAId: string;
  const advisorAEmail = `comp_advA_${Date.now()}@example.com`;
  let advisorBToken: string;
  const advisorBEmail = `comp_advB_${Date.now()}@example.com`;
  let advisorBId: string;
  let analystToken: string;
  const analystEmail = `comp_analyst_${Date.now()}@example.com`;
  let outsiderToken: string;

  let firmA: string;
  let h1: string; // advisor A
  let h2: string; // advisor B
  let h1MemberId: string;
  let h2MemberId: string;
  let h1EntityId: string;

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

  async function addMember(firmId: string, email: string, inviteeToken: string, firmRole: string) {
    await request(app.getHttpServer())
      .post(`/api/firms/${firmId}/invitations`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({ email, firmRole })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/firms/${firmId}/accept`)
      .set('Authorization', `Bearer ${inviteeToken}`)
      .expect(201);
  }

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

    ({ token: owner1Token, id: owner1Id } = await registerUser(`comp_owner1_${ts}@example.com`));
    ({ token: advisorAToken, id: advisorAId } = await registerUser(advisorAEmail));
    ({ token: advisorBToken, id: advisorBId } = await registerUser(advisorBEmail));
    ({ token: analystToken } = await registerUser(analystEmail));
    ({ token: outsiderToken } = await registerUser(`comp_outsider_${ts}@example.com`));

    firmA = (
      await request(app.getHttpServer())
        .post('/api/firms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Firm A ${ts}`, ownerUserId: owner1Id })
        .expect(201)
    ).body.id;
    await addMember(firmA, advisorAEmail, advisorAToken, 'ADVISOR');
    await addMember(firmA, advisorBEmail, advisorBToken, 'ADVISOR');
    await addMember(firmA, analystEmail, analystToken, 'ANALYST');

    h1 = (
      await request(app.getHttpServer())
        .post('/api/households')
        .set(asFirmA(owner1Token))
        .send({ name: 'The Sharmas', advisorId: advisorAId })
        .expect(201)
    ).body.id;
    h2 = (
      await request(app.getHttpServer())
        .post('/api/households')
        .set(asFirmA(owner1Token))
        .send({ name: 'The Iyers', advisorId: advisorBId })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  // ---- Members (MOD-3.2) ----

  it('lets the assigned advisor add a member (name round-trips, encrypted at rest)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/households/${h1}/members`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({ name: 'Priya Sharma', relation: 'spouse', isDependent: false })
      .expect(201);
    expect(res.body.name).toBe('Priya Sharma');
    expect(res.body.relation).toBe('spouse');
    expect(res.body.isDependent).toBe(false);
    h1MemberId = res.body.id;

    const raw = await prisma.householdMember.findUnique({ where: { id: h1MemberId } });
    expect(raw!.name).not.toBe('Priya Sharma');
    expect(raw!.name).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  });

  it('enforces household scope and role on member writes', async () => {
    // owner (firm-wide) can add a member to H2
    h2MemberId = (
      await request(app.getHttpServer())
        .post(`/api/households/${h2}/members`)
        .set('Authorization', `Bearer ${owner1Token}`)
        .send({ name: 'Meera Iyer', relation: 'spouse' })
        .expect(201)
    ).body.id;

    // advisor A is not assigned H2 -> 404; an outsider sees nothing
    await request(app.getHttpServer())
      .post(`/api/households/${h2}/members`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({ name: 'x', relation: 'child' })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/households/${h1}/members`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ name: 'x', relation: 'child' })
      .expect(404);

    // an analyst may read across the firm but not write
    await request(app.getHttpServer())
      .get(`/api/households/${h1}/members`)
      .set('Authorization', `Bearer ${analystToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/households/${h1}/members`)
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ name: 'x', relation: 'child' })
      .expect(403);
  });

  it('cannot reach a member through the wrong household', async () => {
    // advisor A is scoped to H1, but H2's member does not belong to H1 -> 404
    await request(app.getHttpServer())
      .patch(`/api/households/${h1}/members/${h2MemberId}`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({ relation: 'hijacked' })
      .expect(404);
  });

  it('lets the assigned advisor edit and delete a member', async () => {
    await request(app.getHttpServer())
      .patch(`/api/households/${h1}/members/${h1MemberId}`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({ relation: 'partner', isDependent: true })
      .expect(200)
      .expect((res) => {
        expect(res.body.relation).toBe('partner');
        expect(res.body.isDependent).toBe(true);
      });

    const list = await request(app.getHttpServer())
      .get(`/api/households/${h1}/members`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(list.body).toHaveLength(1);

    await request(app.getHttpServer())
      .delete(`/api/households/${h1}/members/${h1MemberId}`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/households/${h1}/members`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200)
      .expect((res) => expect(res.body).toHaveLength(0));
  });

  // ---- Entities (MOD-3.3) ----

  it('creates a legal entity with encrypted name + taxId and its firm scope', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/households/${h1}/entities`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({ name: 'Sharma HUF', type: 'huf', taxId: 'AAAAA1234A' })
      .expect(201);
    expect(res.body.name).toBe('Sharma HUF');
    expect(res.body.type).toBe('huf');
    expect(res.body.taxId).toBe('AAAAA1234A');
    expect(res.body.firmId).toBe(firmA);
    h1EntityId = res.body.id;

    const raw = await prisma.entity.findUnique({ where: { id: h1EntityId } });
    expect(raw!.name).not.toBe('Sharma HUF');
    expect(raw!.taxId).not.toBe('AAAAA1234A');
    expect(raw!.taxId).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  });

  it('scopes entity reads/writes to the household and role', async () => {
    await request(app.getHttpServer())
      .get(`/api/households/${h1}/entities`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200)
      .expect((res) => expect(res.body).toHaveLength(1));

    await request(app.getHttpServer())
      .get(`/api/households/${h1}/entities`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/households/${h1}/entities`)
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ name: 'x' })
      .expect(403);
  });

  it('edits and deletes an entity in scope', async () => {
    await request(app.getHttpServer())
      .patch(`/api/households/${h1}/entities/${h1EntityId}`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({ type: 'trust' })
      .expect(200)
      .expect((res) => expect(res.body.type).toBe('trust'));

    await request(app.getHttpServer())
      .delete(`/api/households/${h1}/entities/${h1EntityId}`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/households/${h1}/entities`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200)
      .expect((res) => expect(res.body).toHaveLength(0));
  });
});
