import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Client-IP resolution behind a reverse proxy.
 *
 * The API runs behind Railway's edge, so every request arrives from the proxy. Unless
 * Express is told how many hops to trust, `req.ip` is the PROXY's address — and two things
 * quietly depend on `req.ip` being the client:
 *
 *  - the rate limiter buckets by it, so ONE shared allowance covered every client on earth
 *    (an abuser exhausts it and everyone else is throttled)
 *  - the audit trail records it, so every firm/household mutation was attributed to the
 *    proxy rather than to whoever performed it
 *
 * These tests pin the fix from both sides: trusted proxy honours X-Forwarded-For, and an
 * untrusted one ignores it (so a directly-exposed deployment cannot be spoofed).
 */
describe('Trust proxy / client IP (e2e)', () => {
  const CLIENT_IP = '203.0.113.45'; // TEST-NET-3, never a real client
  const SPOOFED = '198.51.100.7';

  async function boot(trustProxyHops: number): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    if (trustProxyHops > 0) {
      app.getHttpAdapter().getInstance().set('trust proxy', trustProxyHops);
    }
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    return app;
  }

  /** Signs in as the seeded SUPERADMIN, whose audit entries we can read back. */
  async function adminToken(app: INestApplication): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: process.env.SEED_ADMIN_EMAIL ?? 'admin@lifecapitalos.dev',
        password: process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345',
      });
    expect(res.status).toBe(201);
    return res.body.accessToken as string;
  }

  it('records the CLIENT address in the audit trail when the proxy is trusted', async () => {
    const app = await boot(1);
    try {
      const token = await adminToken(app);

      // A firm creation is audited with @Ip(). Unique name so we can find our own row.
      const name = `Trust Proxy Test ${Date.now()}`;
      const me = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      const created = await request(app.getHttpServer())
        .post('/api/firms')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Forwarded-For', CLIENT_IP)
        .send({ name, ownerUserId: me.body.id });
      expect(created.status).toBe(201);

      const audit = await request(app.getHttpServer())
        .get('/api/admin/audit?action=firm.create&take=25')
        .set('Authorization', `Bearer ${token}`);
      expect(audit.status).toBe(200);

      const rows = audit.body.data as Array<{ entityId?: string; ip?: string | null }>;
      const row = rows.find((r) => r.entityId === created.body.id);
      expect(row).toBeDefined();
      // Before the fix this was the proxy's address (::ffff:127.0.0.1 under supertest).
      expect(row?.ip).toBe(CLIENT_IP);
    } finally {
      await app.close();
    }
  });

  it('IGNORES X-Forwarded-For when no proxy is trusted, so it cannot be spoofed', async () => {
    const app = await boot(0);
    try {
      const token = await adminToken(app);
      const name = `No Trust Proxy Test ${Date.now()}`;
      const me = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      const created = await request(app.getHttpServer())
        .post('/api/firms')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Forwarded-For', SPOOFED)
        .send({ name, ownerUserId: me.body.id });
      expect(created.status).toBe(201);

      const audit = await request(app.getHttpServer())
        .get('/api/admin/audit?action=firm.create&take=25')
        .set('Authorization', `Bearer ${token}`);

      const rows = audit.body.data as Array<{ entityId?: string; ip?: string | null }>;
      const row = rows.find((r) => r.entityId === created.body.id);
      expect(row).toBeDefined();
      expect(row?.ip).not.toBe(SPOOFED);
    } finally {
      await app.close();
    }
  });
});
