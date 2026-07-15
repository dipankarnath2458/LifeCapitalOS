import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/app.factory';

/**
 * Pre-Module-4 hardening. Verifies the additive, non-breaking hardening items end-to-end:
 * (1) AuditLog.firmId is populated on mutations; (2) responses carry a correlation id
 * header (baseline observability); (3) the Financial Snapshot payload includes the
 * additive, PII-light `members[]` demographics (schemaVersion still 1).
 */
describe('Pre-Module-4 hardening e2e', () => {
  let app: INestApplication;

  let adminToken: string;
  let owner1Token: string;
  let owner1Id: string;
  let advisorAToken: string;
  let advisorAId: string;
  const advisorAEmail = `hard_advA_${Date.now()}@example.com`;

  let firmA: string;
  let h1: string;

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

  async function addMember(email: string, inviteeToken: string, firmRole: string) {
    await request(app.getHttpServer())
      .post(`/api/firms/${firmA}/invitations`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({ email, firmRole })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/firms/${firmA}/accept`)
      .set('Authorization', `Bearer ${inviteeToken}`)
      .expect(201);
  }

  const asFirmA = (token: string) => ({ Authorization: `Bearer ${token}`, 'x-firm-id': firmA });

  beforeAll(async () => {
    app = await createApp();
    await app.init();

    adminToken = (
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@lifecapitalos.dev', password: 'Admin@12345' })
    ).body.accessToken;

    ({ token: owner1Token, id: owner1Id } = await registerUser(`hard_owner1_${ts}@example.com`));
    ({ token: advisorAToken, id: advisorAId } = await registerUser(advisorAEmail));

    firmA = (
      await request(app.getHttpServer())
        .post('/api/firms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Firm HARD ${ts}`, ownerUserId: owner1Id })
        .expect(201)
    ).body.id;
    await addMember(advisorAEmail, advisorAToken, 'ADVISOR');

    h1 = (
      await request(app.getHttpServer())
        .post('/api/households')
        .set(asFirmA(owner1Token))
        .send({ name: 'The Sharmas', advisorId: advisorAId, baseCurrency: 'INR' })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns a correlation id header on every response (and echoes an inbound one)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/households/${h1}`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(res.headers['x-request-id']).toBeTruthy();

    const echoed = await request(app.getHttpServer())
      .get(`/api/households/${h1}`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .set('x-request-id', 'trace-abc-123')
      .expect(200);
    expect(echoed.headers['x-request-id']).toBe('trace-abc-123');
  });

  it('populates AuditLog.firmId on a household mutation', async () => {
    const acct = await request(app.getHttpServer())
      .post(`/api/households/${h1}/accounts`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({ name: 'HDFC', type: 'bank', assetClass: 'cash', currency: 'INR', balanceMinor: 100_00 })
      .expect(201);
    expect(acct.body.id).toBeDefined();

    const audit = await request(app.getHttpServer())
      .get('/api/admin/audit?action=household.account.create&take=50')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const row = audit.body.data.find(
      (r: { entityId: string; firmId: string | null }) => r.entityId === acct.body.id,
    );
    expect(row).toBeDefined();
    expect(row.firmId).toBe(firmA); // written through to the indexed column, not just metadata
  });

  it('includes additive PII-light members[] in the snapshot payload (schemaVersion 1)', async () => {
    await request(app.getHttpServer())
      .post(`/api/households/${h1}/members`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({ name: 'Rahul Sharma', relation: 'self', dateOfBirth: '1985-06-15', isDependent: false })
      .expect(201);

    const snap = await request(app.getHttpServer())
      .post(`/api/households/${h1}/financial-snapshot`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({})
      .expect(201);

    expect(snap.body.schemaVersion).toBe(1); // additive — version unchanged
    const members = snap.body.payload.members;
    expect(Array.isArray(members)).toBe(true);
    expect(members.length).toBe(1);
    const m = members[0];
    expect(typeof m.ageYears).toBe('number');
    expect(m.ageYears).toBeGreaterThanOrEqual(40);
    expect(m.isDependent).toBe(false);
    expect(m.relation).toBe('self');
    // PII-light: no name / dateOfBirth in the payload member entry.
    expect(m.name).toBeUndefined();
    expect(m.dateOfBirth).toBeUndefined();
  });
});
