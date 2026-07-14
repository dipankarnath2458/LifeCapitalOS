import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/app.factory';

/**
 * M2-2 Household accounts (MOD-4.1). Verifies household-scoped account CRUD:
 * accounts belong to a household (optionally a legal entity in it), native
 * currency is stored per account, only in-scope data-entry roles may write
 * (analyst read-only), and accounts can't be reached across households/firms.
 */
describe('Household accounts e2e', () => {
  let app: INestApplication;

  let adminToken: string;
  let owner1Token: string;
  let owner1Id: string;
  let advisorAToken: string;
  let advisorAId: string;
  const advisorAEmail = `acct_advA_${Date.now()}@example.com`;
  let analystToken: string;
  const analystEmail = `acct_analyst_${Date.now()}@example.com`;
  let outsiderToken: string;

  let firmA: string;
  let h1: string; // advisor A
  let h2: string; // firm-wide (owner) only
  let h1Entity: string;
  let h2Entity: string;
  let h1AccountId: string;
  let h2AccountId: string;

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

  async function createEntity(householdId: string, token: string): Promise<string> {
    return (
      await request(app.getHttpServer())
        .post(`/api/households/${householdId}/entities`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `Entity ${ts}`, type: 'individual' })
        .expect(201)
    ).body.id;
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

    ({ token: owner1Token, id: owner1Id } = await registerUser(`acct_owner1_${ts}@example.com`));
    ({ token: advisorAToken, id: advisorAId } = await registerUser(advisorAEmail));
    ({ token: analystToken } = await registerUser(analystEmail));
    ({ token: outsiderToken } = await registerUser(`acct_outsider_${ts}@example.com`));

    firmA = (
      await request(app.getHttpServer())
        .post('/api/firms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Firm A ${ts}`, ownerUserId: owner1Id })
        .expect(201)
    ).body.id;
    await addMember(advisorAEmail, advisorAToken, 'ADVISOR');
    await addMember(analystEmail, analystToken, 'ANALYST');

    h1 = (
      await request(app.getHttpServer())
        .post('/api/households')
        .set(asFirmA(owner1Token))
        .send({ name: 'The Sharmas', advisorId: advisorAId })
        .expect(201)
    ).body.id;
    h2 = (
      await request(app.getHttpServer())
        .post('/api/households')
        .set(asFirmA(owner1Token))
        .send({ name: 'The Iyers' })
        .expect(201)
    ).body.id;
    h1Entity = await createEntity(h1, advisorAToken);
    h2Entity = await createEntity(h2, owner1Token);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('creates an entity-owned account with native currency (balance round-trips)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/households/${h1}/accounts`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({
        name: 'US Brokerage',
        type: 'investment',
        assetClass: 'equity',
        currency: 'USD',
        balanceMinor: 5000000,
        entityId: h1Entity,
      })
      .expect(201);
    expect(res.body.currency).toBe('USD');
    expect(res.body.balanceMinor).toBe(5000000);
    expect(res.body.entityId).toBe(h1Entity);
    expect(res.body.householdId).toBe(h1);
    h1AccountId = res.body.id;
  });

  it('rejects an entity from a different household (400)', async () => {
    await request(app.getHttpServer())
      .post(`/api/households/${h1}/accounts`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({ name: 'x', type: 'bank', balanceMinor: 1000, entityId: h2Entity })
      .expect(400);
  });

  it('stores each account in its native currency and lists them', async () => {
    await request(app.getHttpServer())
      .post(`/api/households/${h1}/accounts`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({
        name: 'HDFC Savings',
        type: 'bank',
        assetClass: 'cash',
        currency: 'INR',
        balanceMinor: 80000000,
      })
      .expect(201);
    const list = await request(app.getHttpServer())
      .get(`/api/households/${h1}/accounts`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    const currencies = list.body.map((a: { currency: string }) => a.currency).sort();
    expect(currencies).toEqual(['INR', 'USD']);
  });

  it('enforces household scope and role on account writes', async () => {
    // owner (firm-wide) can create in H2
    h2AccountId = (
      await request(app.getHttpServer())
        .post(`/api/households/${h2}/accounts`)
        .set('Authorization', `Bearer ${owner1Token}`)
        .send({ name: 'Iyer Bank', type: 'bank', balanceMinor: 1000000 })
        .expect(201)
    ).body.id;

    // advisor A is not assigned H2 -> 404; outsider sees nothing
    await request(app.getHttpServer())
      .get(`/api/households/${h2}/accounts`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/households/${h1}/accounts`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(404);

    // analyst reads across the firm but cannot write
    await request(app.getHttpServer())
      .get(`/api/households/${h1}/accounts`)
      .set('Authorization', `Bearer ${analystToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/households/${h1}/accounts`)
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ name: 'x', type: 'bank', balanceMinor: 1 })
      .expect(403);
  });

  it('cannot reach an account through the wrong household', async () => {
    await request(app.getHttpServer())
      .patch(`/api/households/${h1}/accounts/${h2AccountId}`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({ balanceMinor: 999 })
      .expect(404);
  });

  it('updates and deletes an in-scope account', async () => {
    await request(app.getHttpServer())
      .patch(`/api/households/${h1}/accounts/${h1AccountId}`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .send({ balanceMinor: 5250000 })
      .expect(200)
      .expect((res) => expect(res.body.balanceMinor).toBe(5250000));

    await request(app.getHttpServer())
      .delete(`/api/households/${h1}/accounts/${h1AccountId}`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);

    const list = await request(app.getHttpServer())
      .get(`/api/households/${h1}/accounts`)
      .set('Authorization', `Bearer ${advisorAToken}`)
      .expect(200);
    expect(list.body.find((a: { id: string }) => a.id === h1AccountId)).toBeUndefined();
  });
});
