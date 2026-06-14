import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/app.factory';

/**
 * Verifies the admin access boundary that gates the in-app admin panel. The frontend
 * only shows /admin to admin roles, but the real guarantee is server-side: admin
 * endpoints must reject non-admins (403) and accept admins. Needs the DB seeded so the
 * SUPERADMIN account exists.
 */
describe('Admin access e2e', () => {
  let app: INestApplication;
  const userEmail = `nonadmin_${Date.now()}@example.com`;
  let userToken: string;
  let adminToken: string;

  beforeAll(async () => {
    app = await createApp();
    await app.init();

    const reg = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: userEmail, password: 'Passw0rd1', fullName: 'Plain User' });
    userToken = reg.body.accessToken;

    const adminLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@lifecapitalos.dev', password: 'Admin@12345' });
    adminToken = adminLogin.body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('reports a normal user as role USER (so the Admin link stays hidden)', async () => {
    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    expect(me.body.role).toBe('USER');
  });

  it('blocks a non-admin from admin endpoints (403)', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/metrics')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/admin/flags')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('blocks admin endpoints without any token (401)', async () => {
    await request(app.getHttpServer()).get('/api/admin/metrics').expect(401);
  });

  it('reports the seeded admin as a privileged role and grants access', async () => {
    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(['ADMIN', 'SUPERADMIN', 'SUPPORT', 'ANALYST']).toContain(me.body.role);

    const metrics = await request(app.getHttpServer())
      .get('/api/admin/metrics')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(typeof metrics.body.totalUsers).toBe('number');

    const flags = await request(app.getHttpServer())
      .get('/api/admin/flags')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(Array.isArray(flags.body)).toBe(true);
  });
});
