import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Failed-login lockout.
 *
 * `/auth/login` previously had no account-scoped control at all: the only limit was a
 * per-IP request throttle, so a distributed attempt against one known address was slowed by
 * nothing. Five failures now lock an address for fifteen minutes.
 *
 * The property that shapes the design is tested here explicitly: the counter is keyed on the
 * **submitted address**, not on a user, so an address that does not exist locks exactly like
 * one that does. Without that, the lock message itself would reveal which addresses are
 * registered — undoing the enumeration resistance the rest of the auth surface maintains.
 */
describe('Login lockout (e2e)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  const PASSWORD = 'Lockout1pass';

  const login = (email: string, password: string) =>
    http().post('/api/auth/login').send({ email, password });

  async function registerFresh(prefix: string): Promise<string> {
    const email = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`;
    const res = await http()
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, fullName: 'Lockout Tester' });
    expect(res.status).toBe(201);
    return email;
  }

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

  it('locks an address after five failed attempts', async () => {
    const email = await registerFresh('lock');

    for (let i = 0; i < 4; i++) {
      const res = await login(email, 'wrong-password');
      expect(res.status).toBe(401);
      // Still a plain credential rejection — no lock yet, and no hint of the counter.
      expect(res.body.message).toBe('Invalid credentials');
    }

    // The fifth failure trips the lock.
    const fifth = await login(email, 'wrong-password');
    expect(fifth.status).toBe(401);

    const locked = await login(email, 'wrong-password');
    expect(locked.status).toBe(401);
    expect(locked.body.message).toMatch(/Too many failed sign-in attempts/i);
    expect(locked.body.message).toMatch(/minute/i);
  });

  it('rejects the CORRECT password while the lock is in force', async () => {
    // Otherwise the lock is theatre: an attacker who guesses right during the window wins.
    const email = await registerFresh('lock_correct');
    for (let i = 0; i < 5; i++) await login(email, 'wrong-password');

    const res = await login(email, PASSWORD);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Too many failed sign-in attempts/i);
  });

  it('does not lock a legitimate user who mistypes a few times', async () => {
    const email = await registerFresh('lock_typo');
    for (let i = 0; i < 4; i++) expect((await login(email, 'oops')).status).toBe(401);

    const ok = await login(email, PASSWORD);
    expect(ok.status).toBe(201);
    expect(ok.body.accessToken).toBeTruthy();
  });

  it('resets the counter after a successful sign-in', async () => {
    const email = await registerFresh('lock_reset');
    for (let i = 0; i < 4; i++) await login(email, 'oops');
    expect((await login(email, PASSWORD)).status).toBe(201);

    // The four earlier failures must not carry over — four more should still not lock.
    for (let i = 0; i < 4; i++) expect((await login(email, 'oops')).status).toBe(401);
    expect((await login(email, PASSWORD)).status).toBe(201);
  });

  it('treats an UNREGISTERED address exactly like a registered one', async () => {
    // The enumeration property. A lock message that appeared only for real accounts would
    // turn this endpoint into an account-existence oracle.
    const ghost = `ghost_${Date.now()}@example.com`;
    const real = await registerFresh('lock_compare');

    for (let i = 0; i < 5; i++) await login(ghost, 'whatever');
    for (let i = 0; i < 5; i++) await login(real, 'whatever');

    const ghostLocked = await login(ghost, 'whatever');
    const realLocked = await login(real, 'whatever');

    expect(ghostLocked.status).toBe(realLocked.status);
    expect(ghostLocked.body.message).toMatch(/Too many failed sign-in attempts/i);
    expect(realLocked.body.message).toMatch(/Too many failed sign-in attempts/i);
  });

  it('counts attempts case-insensitively, so changing capitalisation does not reset it', async () => {
    const email = await registerFresh('lock_case');
    for (let i = 0; i < 3; i++) await login(email.toUpperCase(), 'oops');
    for (let i = 0; i < 2; i++) await login(email, 'oops');

    const locked = await login(email, PASSWORD);
    expect(locked.body.message).toMatch(/Too many failed sign-in attempts/i);
  });
});
