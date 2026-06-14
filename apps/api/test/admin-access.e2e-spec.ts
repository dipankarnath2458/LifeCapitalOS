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

  it('lists users with a paginated shape and respects take', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/users?take=1')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(typeof res.body.total).toBe('number');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeLessThanOrEqual(1);
  });

  it('lets a superadmin change a user role (powering the role dropdown)', async () => {
    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    const id = me.body.id as string;

    await request(app.getHttpServer())
      .patch(`/api/admin/users/${id}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'ANALYST' })
      .expect(200);

    const after = await request(app.getHttpServer())
      .get(`/api/admin/users?search=${encodeURIComponent(userEmail)}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(after.body.data[0].role).toBe('ANALYST');
  });

  it('manages per-user feature overrides (grant, list, clear)', async () => {
    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    const id = me.body.id as string;

    await request(app.getHttpServer())
      .post(`/api/admin/users/${id}/feature-override`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ feature: 'ai_recommendations', enabled: true })
      .expect(201);

    const listed = await request(app.getHttpServer())
      .get(`/api/admin/users/${id}/feature-overrides`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(listed.body).toEqual([{ feature: 'ai_recommendations', enabled: true }]);

    await request(app.getHttpServer())
      .delete(`/api/admin/users/${id}/feature-override/ai_recommendations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const cleared = await request(app.getHttpServer())
      .get(`/api/admin/users/${id}/feature-overrides`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(cleared.body).toEqual([]);
  });

  it('lets an admin set a user plan tier (comp) and revert it', async () => {
    const id = (
      await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`)
    ).body.id as string;

    await request(app.getHttpServer())
      .put(`/api/admin/users/${id}/subscription`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tier: 'premium' })
      .expect(200);
    let row = await request(app.getHttpServer())
      .get(`/api/admin/users?search=${encodeURIComponent(userEmail)}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(row.body.data[0].tier).toBe('premium');

    await request(app.getHttpServer())
      .put(`/api/admin/users/${id}/subscription`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tier: 'free' })
      .expect(200);
    row = await request(app.getHttpServer())
      .get(`/api/admin/users?search=${encodeURIComponent(userEmail)}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(row.body.data[0].tier).toBe('free');
  });

  it('lets an admin create a flag and edit its description and payload', async () => {
    const key = `test_flag_${Date.now()}`;
    await request(app.getHttpServer())
      .put(`/api/admin/flags/${key}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: false, description: 'created in test' })
      .expect(200);
    await request(app.getHttpServer())
      .put(`/api/admin/flags/${key}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ payload: { rolloutPct: 25 } })
      .expect(200);

    const flags = await request(app.getHttpServer())
      .get('/api/admin/flags')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const created = (flags.body as any[]).find((f) => f.key === key);
    expect(created).toBeTruthy();
    expect(created.description).toBe('created in test');
    expect(created.payload).toEqual({ rolloutPct: 25 });
  });

  it('lets an admin rename a plan', async () => {
    const plans = await request(app.getHttpServer())
      .get('/api/admin/plans')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const plan = plans.body[0];
    const newName = `Renamed ${Date.now()}`;
    await request(app.getHttpServer())
      .put(`/api/admin/plans/${plan.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: newName })
      .expect(200);
    const after = await request(app.getHttpServer())
      .get('/api/admin/plans')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect((after.body as any[]).find((p) => p.id === plan.id).name).toBe(newName);
  });

  it('lets a superadmin erase a user', async () => {
    const email = `erase_${Date.now()}@example.com`;
    const reg = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'Passw0rd1', fullName: 'Throwaway' });
    const id = (
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${reg.body.accessToken}`)
    ).body.id as string;

    await request(app.getHttpServer())
      .delete(`/api/admin/users/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const search = await request(app.getHttpServer())
      .get(`/api/admin/users?search=${encodeURIComponent(email)}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(search.body.data).toHaveLength(0);
  });
});
