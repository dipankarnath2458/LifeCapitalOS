import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/app.factory';

/**
 * End-to-end coverage for the account/password flows against a real database:
 * registration, login, change-password (authenticated), and forgot/reset-password.
 * Built via the production app factory so behaviour matches the deployed app.
 */
describe('Auth flows e2e', () => {
  let app: INestApplication;
  const email = `auth_${Date.now()}@example.com`;
  const pw1 = 'Passw0rd1';
  const pw2 = 'Passw0rd2';
  const pw3 = 'Passw0rd3';

  beforeAll(async () => {
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const http = () => request(app.getHttpServer());

  it('registers a new user and returns tokens', async () => {
    const res = await http()
      .post('/api/auth/register')
      .send({ email, password: pw1, fullName: 'Auth Tester' })
      .expect(201);
    expect(typeof res.body.accessToken).toBe('string');
    expect(typeof res.body.refreshToken).toBe('string');
  });

  it('rejects a duplicate registration', async () => {
    await http()
      .post('/api/auth/register')
      .send({ email, password: pw1, fullName: 'Auth Tester' })
      .expect(400);
  });

  it('logs in with the registered credentials', async () => {
    const res = await http().post('/api/auth/login').send({ email, password: pw1 }).expect(201);
    expect(typeof res.body.accessToken).toBe('string');
  });

  it('rejects login with a wrong password', async () => {
    await http().post('/api/auth/login').send({ email, password: 'WrongPass9' }).expect(401);
  });

  it('change-password requires authentication', async () => {
    await http()
      .post('/api/auth/change-password')
      .send({ currentPassword: pw1, newPassword: pw2 })
      .expect(401);
  });

  it('changes the password when the current one is correct, and updates login', async () => {
    const login = await http().post('/api/auth/login').send({ email, password: pw1 }).expect(201);
    const token = login.body.accessToken as string;

    // Wrong current password is rejected.
    await http()
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'NotMyPass9', newPassword: pw2 })
      .expect(401);

    // Correct current password succeeds.
    await http()
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: pw1, newPassword: pw2 })
      .expect(201);

    // Old password no longer works; new one does.
    await http().post('/api/auth/login').send({ email, password: pw1 }).expect(401);
    await http().post('/api/auth/login').send({ email, password: pw2 }).expect(201);
  });

  it('forgot-password returns a dev token (sandbox) and reset-password sets a new password', async () => {
    const forgot = await http().post('/api/auth/forgot-password').send({ email }).expect(201);
    expect(forgot.body.sent).toBe(true);
    const token = forgot.body.devToken as string;
    expect(typeof token).toBe('string');

    // A wrong token is rejected.
    await http()
      .post('/api/auth/reset-password')
      .send({ email, token: 'deadbeef', newPassword: pw3 })
      .expect(401);

    // The real token resets the password.
    await http().post('/api/auth/reset-password').send({ email, token, newPassword: pw3 }).expect(201);

    // The previous password no longer works; the reset one does.
    await http().post('/api/auth/login').send({ email, password: pw2 }).expect(401);
    await http().post('/api/auth/login').send({ email, password: pw3 }).expect(201);
  });

  it('does not reveal whether an unknown email exists (no dev token, still 201)', async () => {
    const res = await http()
      .post('/api/auth/forgot-password')
      .send({ email: `missing_${Date.now()}@example.com` })
      .expect(201);
    expect(res.body.sent).toBe(true);
    expect(res.body.devToken).toBeUndefined();
  });
});
