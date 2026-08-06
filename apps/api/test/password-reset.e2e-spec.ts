import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
// Production applies this inside app.factory.ts, which Test.createTestingModule bypasses.
// Without it /auth/me 500s on the BigInt columns in Profile.
import '../src/common/bigint-json';

/**
 * End-to-end cover for self-serve password reset and email verification.
 *
 * Before this milestone the reset token was generated and thrown away — no provider was
 * wired up — so a user who forgot their password could not recover their account at all.
 * These tests exercise the whole loop, including the properties that keep it from becoming
 * an account-existence oracle.
 *
 * Relies on SANDBOX_RETURN_SECRETS=true (set in CI) to read back the one-time token that
 * production only ever puts in an email.
 */
describe('Password reset + email verification (e2e)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  const email = `reset_${Date.now()}@example.com`;
  const originalPassword = 'Original1pass';
  const newPassword = 'Brandnew2pass';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('registers the account used by the rest of this suite', async () => {
    const res = await http()
      .post('/api/auth/register')
      .send({ email, password: originalPassword, fullName: 'Reset Tester' });
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
  });

  it('does not reveal whether an address is registered', async () => {
    const known = await http().post('/api/auth/forgot-password').send({ email });
    const unknown = await http()
      .post('/api/auth/forgot-password')
      .send({ email: `nobody_${Date.now()}@example.com` });

    expect(known.status).toBe(unknown.status);
    expect(known.body.sent).toBe(true);
    expect(unknown.body.sent).toBe(true);
    // The unknown address must not get a token — only the shape of the response matches.
    expect(unknown.body.devToken).toBeUndefined();
  });

  it('rejects a wrong reset token without changing the password', async () => {
    const bad = await http()
      .post('/api/auth/reset-password')
      .send({ email, token: 'f'.repeat(64), newPassword });
    expect(bad.status).toBe(401);

    // The original password still works.
    const login = await http().post('/api/auth/login').send({ email, password: originalPassword });
    expect(login.status).toBe(201);
  });

  it('completes a reset with the emailed token and signs the user in with the new password', async () => {
    const sessionBefore = await http().post('/api/auth/login').send({ email, password: originalPassword });
    const staleRefresh = sessionBefore.body.refreshToken as string;

    const forgot = await http().post('/api/auth/forgot-password').send({ email });
    const token = forgot.body.devToken as string;
    expect(token).toBeTruthy();

    const reset = await http().post('/api/auth/reset-password').send({ email, token, newPassword });
    expect(reset.status).toBe(201);

    // New password works; old one does not.
    await expect(
      http().post('/api/auth/login').send({ email, password: newPassword }).then((r) => r.status),
    ).resolves.toBe(201);
    await expect(
      http().post('/api/auth/login').send({ email, password: originalPassword }).then((r) => r.status),
    ).resolves.toBe(401);

    // Every pre-existing session is revoked — the point of resetting a compromised password.
    const stale = await http().post('/api/auth/refresh').send({ refreshToken: staleRefresh });
    expect(stale.status).toBe(401);
  });

  it('will not let a reset token be replayed', async () => {
    const forgot = await http().post('/api/auth/forgot-password').send({ email });
    const token = forgot.body.devToken as string;

    const first = await http()
      .post('/api/auth/reset-password')
      .send({ email, token, newPassword: 'Replay3pass' });
    expect(first.status).toBe(201);

    const replay = await http()
      .post('/api/auth/reset-password')
      .send({ email, token, newPassword: 'Attacker4pass' });
    expect(replay.status).toBeGreaterThanOrEqual(400);

    // The replay changed nothing.
    const login = await http().post('/api/auth/login').send({ email, password: 'Replay3pass' });
    expect(login.status).toBe(201);
  });

  it('throttles repeated reset requests for one address', async () => {
    const target = `throttle_${Date.now()}@example.com`;
    await http().post('/api/auth/register').send({ email: target, password: 'Throttle1', fullName: 'T' });

    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await http().post('/api/auth/forgot-password').send({ email: target })).status);
    }
    expect(statuses).toContain(400); // send window exhausted
  });

  describe('email verification', () => {
    const verifyEmail = `verify_${Date.now()}@example.com`;

    it('starts unverified on registration', async () => {
      const reg = await http()
        .post('/api/auth/register')
        .send({ email: verifyEmail, password: 'Verify1pass', fullName: 'Verify Tester' });
      expect(reg.status).toBe(201);

      const me = await http()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${reg.body.accessToken}`);
      expect(me.body.emailVerified).toBe(false);
    });

    it('rejects a bad verification token', async () => {
      const res = await http()
        .post('/api/auth/verify-email')
        .send({ email: verifyEmail, token: 'a'.repeat(64) });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('verifies the address with the emailed token', async () => {
      const requested = await http().post('/api/auth/verify-email/request').send({ email: verifyEmail });
      expect(requested.body.sent).toBe(true);
      const token = requested.body.devToken as string;
      expect(token).toBeTruthy();

      const verified = await http().post('/api/auth/verify-email').send({ email: verifyEmail, token });
      expect(verified.status).toBe(201);

      const login = await http().post('/api/auth/login').send({ email: verifyEmail, password: 'Verify1pass' });
      const me = await http().get('/api/auth/me').set('Authorization', `Bearer ${login.body.accessToken}`);
      expect(me.body.emailVerified).toBe(true);
    });

    it('reports success for an unknown address without issuing a token', async () => {
      const res = await http()
        .post('/api/auth/verify-email/request')
        .send({ email: `ghost_${Date.now()}@example.com` });
      expect(res.body.sent).toBe(true);
      expect(res.body.devToken).toBeUndefined();
    });
  });
});
