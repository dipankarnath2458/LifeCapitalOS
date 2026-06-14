import { createHmac } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/app.factory';

/**
 * End-to-end coverage for the features added in this branch, against a real database:
 * profile dateOfBirth persistence, family -> dependents sync, Early Warning assembly,
 * net-worth snapshot/timeline, the Razorpay webhook signature guard, and AA gating.
 * Requires a running PostgreSQL with migrations applied.
 */
describe('Feature e2e', () => {
  let app: INestApplication;
  let token: string;
  const email = `e2e_${Date.now()}@example.com`;

  beforeAll(async () => {
    // Build via the production factory so BigInt serialization and rawBody (for the
    // webhook HMAC) match the deployed app exactly.
    app = await createApp();
    await app.init();

    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'Passw0rd1', fullName: 'E2E Tester' });
    token = res.body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('persists dateOfBirth on the profile (powers age-based scoring)', async () => {
    await request(app.getHttpServer())
      .put('/api/profile')
      .set(auth())
      .send({
        fullName: 'E2E Tester',
        dateOfBirth: '1986-04-01',
        baseCurrency: 'INR',
        annualIncomeMinor: 24_00_000_00,
        monthlyExpensesMinor: 1_00_000_00,
        riskTolerance: 'moderate',
        hasTermCover: true,
        hasHealthInsurance: true,
        termLifeCoverMinor: 50_00_000_00,
      })
      .expect(200);

    const got = await request(app.getHttpServer()).get('/api/profile').set(auth()).expect(200);
    expect(got.body.dateOfBirth).toContain('1986-04-01');
    expect(Number(got.body.termLifeCoverMinor)).toBe(50_00_000_00);
  });

  it('syncs Profile.dependents from family members', async () => {
    await request(app.getHttpServer())
      .post('/api/family')
      .set(auth())
      .send({ name: 'Child One', relation: 'child', isDependent: true })
      .expect(201);

    const profile = await request(app.getHttpServer()).get('/api/profile').set(auth()).expect(200);
    expect(profile.body.dependents).toBe(1);
  });

  it('assembles an Early Warning report from real data', async () => {
    await request(app.getHttpServer())
      .post('/api/accounts')
      .set(auth())
      .send({ name: 'Savings', type: 'bank', assetClass: 'cash', currency: 'INR', balanceMinor: 5_00_000_00 })
      .expect(201);

    const ew = await request(app.getHttpServer()).get('/api/insights/early-warning').set(auth()).expect(200);
    expect(Array.isArray(ew.body.signals)).toBe(true);
    expect(['green', 'yellow', 'red']).toContain(ew.body.overall);
  });

  it('captures a net-worth snapshot and returns it on the timeline', async () => {
    await request(app.getHttpServer()).post('/api/net-worth/snapshot').set(auth()).expect(201);
    const timeline = await request(app.getHttpServer()).get('/api/net-worth/timeline').set(auth()).expect(200);
    expect(timeline.body.length).toBeGreaterThanOrEqual(1);
    expect(typeof timeline.body[0].netWorthMinor).toBe('number');
  });

  it('exposes plans publicly and rejects an unsigned Razorpay webhook', async () => {
    await request(app.getHttpServer()).get('/api/billing/plans').expect(200);

    await request(app.getHttpServer())
      .post('/api/billing/razorpay/webhook')
      .set('x-razorpay-signature', 'not-a-valid-signature')
      .send({ event: 'order.paid' })
      .expect(400);
  });

  it('accepts a correctly signed Razorpay webhook (no matching order is a safe no-op)', async () => {
    const body = JSON.stringify({ event: 'order.paid', payload: { order: { entity: { id: 'order_none' } } } });
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? 'dummy_webhook';
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    await request(app.getHttpServer())
      .post('/api/billing/razorpay/webhook')
      .set('x-razorpay-signature', signature)
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(201);
  });

  it('reports AA status as disabled when the feature flag is off', async () => {
    const res = await request(app.getHttpServer()).get('/api/aa/status').set(auth()).expect(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.consentGranted).toBe(false);
  });

  it('blocks AA sync when the feature is disabled', async () => {
    await request(app.getHttpServer()).post('/api/aa/sync').set(auth()).expect(403);
  });
});
