import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/app.factory';

/**
 * M1-3 Membership & advisor invitations. Verifies the invite -> accept -> manage
 * lifecycle and its access rules: only a firm OWNER can invite or change members;
 * an invited user activates their own membership; the roster is hidden from
 * non-members; the firm can never lose its last active owner. Needs the DB seeded
 * so the SUPERADMIN account exists.
 */
describe('Firm members e2e', () => {
  let app: INestApplication;

  let adminToken: string;
  let owner1Token: string;
  let owner1Id: string;
  let advisorToken: string;
  let advisorId: string;
  const advisorEmail = `mem_advisor_${Date.now()}@example.com`;
  let outsiderToken: string;

  let firmA: string;
  let owner1Mid: string;
  let advisorMid: string;

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

  beforeAll(async () => {
    app = await createApp();
    await app.init();

    adminToken = (
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@lifecapitalos.dev', password: 'Admin@12345' })
    ).body.accessToken;

    ({ token: owner1Token, id: owner1Id } = await registerUser(`mem_owner1_${ts}@example.com`));
    ({ token: advisorToken, id: advisorId } = await registerUser(advisorEmail));
    ({ token: outsiderToken } = await registerUser(`mem_outsider_${ts}@example.com`));

    firmA = (
      await request(app.getHttpServer())
        .post('/api/firms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Firm A ${ts}`, ownerUserId: owner1Id })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lets an owner invite an existing user as a pending member', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/firms/${firmA}/invitations`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({ email: advisorEmail, firmRole: 'ADVISOR' })
      .expect(201);
    expect(res.body.userId).toBe(advisorId);
    expect(res.body.firmRole).toBe('ADVISOR');
    expect(res.body.status).toBe('invited');
  });

  it('rejects inviting an unknown email (404) or an existing member (409)', async () => {
    await request(app.getHttpServer())
      .post(`/api/firms/${firmA}/invitations`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({ email: `nobody_${ts}@example.com`, firmRole: 'ADVISOR' })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/firms/${firmA}/invitations`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({ email: advisorEmail, firmRole: 'ANALYST' })
      .expect(409);
  });

  it('shows the roster to members and hides it from non-members', async () => {
    const roster = await request(app.getHttpServer())
      .get(`/api/firms/${firmA}/members`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .expect(200);
    const byUser = Object.fromEntries(roster.body.map((m: { userId: string }) => [m.userId, m]));
    expect(byUser[owner1Id].firmRole).toBe('OWNER');
    expect(byUser[owner1Id].status).toBe('active');
    expect(byUser[advisorId].status).toBe('invited');

    // An invited (not-yet-active) user cannot read the roster, nor can an outsider.
    await request(app.getHttpServer())
      .get(`/api/firms/${firmA}/members`)
      .set('Authorization', `Bearer ${advisorToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/firms/${firmA}/members`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(404);
  });

  it('lets the invitee accept and rejects accept without a pending invite', async () => {
    const accepted = await request(app.getHttpServer())
      .post(`/api/firms/${firmA}/accept`)
      .set('Authorization', `Bearer ${advisorToken}`)
      .expect(201);
    expect(accepted.body.status).toBe('active');

    await request(app.getHttpServer())
      .post(`/api/firms/${firmA}/accept`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(404);

    // Now an active member can read the roster; capture membership ids.
    const roster = await request(app.getHttpServer())
      .get(`/api/firms/${firmA}/members`)
      .set('Authorization', `Bearer ${advisorToken}`)
      .expect(200);
    owner1Mid = roster.body.find((m: { userId: string }) => m.userId === owner1Id).id;
    advisorMid = roster.body.find((m: { userId: string }) => m.userId === advisorId).id;
  });

  it('restricts invite and member management to owners', async () => {
    await request(app.getHttpServer())
      .post(`/api/firms/${firmA}/invitations`)
      .set('Authorization', `Bearer ${advisorToken}`)
      .send({ email: `someone_${ts}@example.com`, firmRole: 'SUPPORT' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/firms/${firmA}/members/${owner1Mid}`)
      .set('Authorization', `Bearer ${advisorToken}`)
      .send({ firmRole: 'SUPPORT' })
      .expect(403);
    // A non-member never learns the firm exists.
    await request(app.getHttpServer())
      .patch(`/api/firms/${firmA}/members/${advisorMid}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ status: 'disabled' })
      .expect(404);
  });

  it('lets an owner change a member role and disable them', async () => {
    await request(app.getHttpServer())
      .patch(`/api/firms/${firmA}/members/${advisorMid}`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({ firmRole: 'ANALYST' })
      .expect(200)
      .expect((res) => expect(res.body.firmRole).toBe('ANALYST'));

    await request(app.getHttpServer())
      .patch(`/api/firms/${firmA}/members/${advisorMid}`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({ status: 'disabled' })
      .expect(200)
      .expect((res) => expect(res.body.status).toBe('disabled'));
  });

  it('never lets the firm lose its last active owner', async () => {
    await request(app.getHttpServer())
      .patch(`/api/firms/${firmA}/members/${owner1Mid}`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({ status: 'disabled' })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/firms/${firmA}/members/${owner1Mid}`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({ firmRole: 'ADVISOR' })
      .expect(400);
  });
});
