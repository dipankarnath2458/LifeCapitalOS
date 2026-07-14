import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/app.factory';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * M1-2 Firm context + Firms read/switch. Verifies the tenancy boundary: only a
 * platform admin can provision a firm; membership is required to see a firm (a
 * non-member gets 404 so existence never leaks across tenants); only a firm
 * OWNER can edit settings; switching sets the caller's active firm context.
 * Needs the DB seeded so the SUPERADMIN account exists.
 */
describe('Firms e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let adminToken: string;
  let owner1Token: string;
  let owner1Id: string;
  let owner2Token: string;
  let owner2Id: string;
  let advisorToken: string;
  let advisorId: string;
  let outsiderToken: string;

  let firmA: string;
  let firmB: string;

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
    prisma = app.get(PrismaService);

    adminToken = (
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@lifecapitalos.dev', password: 'Admin@12345' })
    ).body.accessToken;

    ({ token: owner1Token, id: owner1Id } = await registerUser(`firm_owner1_${ts}@example.com`));
    ({ token: owner2Token, id: owner2Id } = await registerUser(`firm_owner2_${ts}@example.com`));
    ({ token: advisorToken, id: advisorId } = await registerUser(`firm_advisor_${ts}@example.com`));
    ({ token: outsiderToken } = await registerUser(`firm_outsider_${ts}@example.com`));

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

    // Seat the advisor as a non-owner member of Firm A (advisor-invite lands in M1-3).
    await prisma.membership.create({
      data: { firmId: firmA, userId: advisorId, firmRole: 'ADVISOR', status: 'active' },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('rejects firm creation without a token (401) and by non-admins (403)', async () => {
    await request(app.getHttpServer()).post('/api/firms').send({ name: 'x', ownerUserId: owner1Id }).expect(401);
    await request(app.getHttpServer())
      .post('/api/firms')
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({ name: 'x', ownerUserId: owner1Id })
      .expect(403);
  });

  it('lists only the firms the caller belongs to, with their firm role', async () => {
    const mine = await request(app.getHttpServer())
      .get('/api/firms/me')
      .set('Authorization', `Bearer ${owner1Token}`)
      .expect(200);
    expect(mine.body.activeFirmId).toBeNull();
    expect(mine.body.firms).toHaveLength(1);
    expect(mine.body.firms[0].id).toBe(firmA);
    expect(mine.body.firms[0].firmRole).toBe('OWNER');

    const other = await request(app.getHttpServer())
      .get('/api/firms/me')
      .set('Authorization', `Bearer ${owner2Token}`)
      .expect(200);
    expect(other.body.firms.map((f: { id: string }) => f.id)).toEqual([firmB]);
  });

  it('lets a member read a firm but hides it from non-members (404, no leak)', async () => {
    await request(app.getHttpServer())
      .get(`/api/firms/${firmA}`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/firms/${firmA}`)
      .set('Authorization', `Bearer ${advisorToken}`)
      .expect(200);
    // A member of a different firm must not even learn Firm A exists.
    await request(app.getHttpServer())
      .get(`/api/firms/${firmA}`)
      .set('Authorization', `Bearer ${owner2Token}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/firms/${firmA}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(404);
  });

  it('lets only an OWNER edit firm settings', async () => {
    const newName = `Firm A Renamed ${ts}`;
    await request(app.getHttpServer())
      .patch(`/api/firms/${firmA}`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({ name: newName, reviewCadence: 'annual' })
      .expect(200)
      .expect((res) => {
        expect(res.body.name).toBe(newName);
        expect(res.body.reviewCadence).toBe('annual');
      });

    // A non-owner member is forbidden; a non-member gets 404.
    await request(app.getHttpServer())
      .patch(`/api/firms/${firmA}`)
      .set('Authorization', `Bearer ${advisorToken}`)
      .send({ name: 'hijack' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/firms/${firmA}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ name: 'hijack' })
      .expect(404);
  });

  it('switches the active firm for a member and rejects non-members', async () => {
    await request(app.getHttpServer())
      .post(`/api/firms/${firmA}/switch`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .expect(201)
      .expect((res) => expect(res.body.activeFirmId).toBe(firmA));

    const mine = await request(app.getHttpServer())
      .get('/api/firms/me')
      .set('Authorization', `Bearer ${owner1Token}`)
      .expect(200);
    expect(mine.body.activeFirmId).toBe(firmA);

    await request(app.getHttpServer())
      .post(`/api/firms/${firmA}/switch`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(404);
  });
});
