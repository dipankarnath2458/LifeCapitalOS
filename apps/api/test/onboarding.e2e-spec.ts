import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Consumer onboarding — provisioning a personal household.
 *
 * The property under test is **idempotency**. A consumer double-clicking "Get started", or
 * a retry after a dropped response, must not end up with two households: their accounts
 * would land in one and their snapshot in the other, with no way to merge them and no
 * error to signal it. That is silent data corruption, so it is asserted directly rather
 * than assumed from the code reading correctly.
 */
describe('Consumer onboarding (e2e)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  const PASSWORD = 'Onboard1pass';

  async function newConsumer(prefix: string): Promise<string> {
    const email = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`;
    const res = await http()
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, fullName: 'Priya Sharma' });
    expect(res.status).toBe(201);
    return res.body.accessToken as string;
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

  it('reports no household for a brand-new consumer', async () => {
    const token = await newConsumer('onb_new');
    const res = await http().get('/api/onboarding/status').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.hasHousehold).toBe(false);
  });

  it('provisions a household, and status then reports it', async () => {
    const token = await newConsumer('onb_provision');

    const res = await http()
      .post('/api/onboarding/household')
      .set('Authorization', `Bearer ${token}`)
      .send({ familyName: 'The Sharmas' });
    expect(res.status).toBe(201);
    expect(res.body.provisioned).toBe(true);
    expect(res.body.householdId).toBeTruthy();
    expect(res.body.firmId).toBeTruthy();

    const status = await http().get('/api/onboarding/status').set('Authorization', `Bearer ${token}`);
    expect(status.body.hasHousehold).toBe(true);
    expect(status.body.householdId).toBe(res.body.householdId);
  });

  it('is IDEMPOTENT — a second call returns the same household, not a new one', async () => {
    const token = await newConsumer('onb_idem');

    const first = await http()
      .post('/api/onboarding/household')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    const second = await http()
      .post('/api/onboarding/household')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(first.body.provisioned).toBe(true);
    expect(second.body.provisioned).toBe(false);
    expect(second.body.householdId).toBe(first.body.householdId);
    expect(second.body.firmId).toBe(first.body.firmId);
  });

  it('survives concurrent double-submit without creating two households', async () => {
    // The realistic failure: an impatient consumer clicking twice before the first
    // response lands.
    const token = await newConsumer('onb_race');
    const results = await Promise.all([
      http().post('/api/onboarding/household').set('Authorization', `Bearer ${token}`).send({}),
      http().post('/api/onboarding/household').set('Authorization', `Bearer ${token}`).send({}),
    ]);

    const ids = new Set(results.map((r) => r.body.householdId));
    expect(ids.size).toBe(1);
  });

  it('gives the consumer a working firm context — households are immediately listable', async () => {
    // The point of provisioning: every household-scoped engine must now work unchanged.
    const token = await newConsumer('onb_context');
    const provisioned = await http()
      .post('/api/onboarding/household')
      .set('Authorization', `Bearer ${token}`)
      .send({ familyName: 'Verification Family' });

    const firms = await http().get('/api/firms/me').set('Authorization', `Bearer ${token}`);
    expect(firms.status).toBe(200);
    expect(firms.body.activeFirmId).toBe(provisioned.body.firmId);
    expect(firms.body.firms).toHaveLength(1);
    expect(firms.body.firms[0].firmRole).toBe('OWNER');

    const households = await http().get('/api/households').set('Authorization', `Bearer ${token}`);
    expect(households.status).toBe(200);
    const list = (households.body.data ?? households.body) as Array<{ id: string; name: string }>;
    const mine = list.find((h) => h.id === provisioned.body.householdId);
    expect(mine).toBeDefined();
    // Name round-trips through encryption at rest.
    expect(mine?.name).toBe('Verification Family');
  });

  it('can capture a Financial Snapshot — the capability consumers previously could not have', async () => {
    // This is the whole reason for the personal-firm approach: FinancialSnapshot is
    // household-only, so without a household a consumer gets no snapshot, and therefore no
    // health score and no AI insights.
    const token = await newConsumer('onb_snapshot');
    const { body } = await http()
      .post('/api/onboarding/household')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    const captured = await http()
      .post(`/api/households/${body.householdId}/financial-snapshot`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(captured.status).toBe(201);
  });

  it('normalises the currency code, so the kernel never sees a lower-case one', async () => {
    const token = await newConsumer('onb_currency');
    const { body } = await http()
      .post('/api/onboarding/household')
      .set('Authorization', `Bearer ${token}`)
      .send({ baseCurrency: 'usd' });

    const firms = await http().get('/api/firms/me').set('Authorization', `Bearer ${token}`);
    const firm = firms.body.firms.find((f: { id: string }) => f.id === body.firmId);
    expect(firm.baseCurrency).toBe('USD');
  });

  it('requires authentication', async () => {
    expect((await http().get('/api/onboarding/status')).status).toBe(401);
    expect((await http().post('/api/onboarding/household').send({})).status).toBe(401);
  });
});
