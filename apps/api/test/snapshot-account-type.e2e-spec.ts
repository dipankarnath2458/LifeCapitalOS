import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { canonicalStringify, type FinancialSnapshotPayload } from '@lcos/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Account type in the snapshot (M5.15, Gap 6; ADR-014).
 *
 * See `docs/architecture/GAP_6_ACCOUNT_TYPE_REVIEW.md`.
 *
 * `Account.type` has been NOT NULL since the first migration and `accounts.list()` already
 * returned it — the composer's row interface simply did not declare it, so the projection
 * dropped it. This suite proves the four properties the milestone rests on:
 *
 *  1. A NEW snapshot carries `accountType`, at `schemaVersion` 1.
 *  2. An OLD snapshot without it stays valid, and is never rewritten.
 *  3. Absent stays absent — never `false`, never a default. (#67, four times over.)
 *  4. Capturing a new snapshot leaves every stored snapshot byte-identical, checksum included.
 *
 * Nothing reads `accountType` yet, deliberately, so there is no behaviour to assert beyond
 * capture and preservation — which is precisely why (4) matters most.
 */
describe('Snapshot account type (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const PASSWORD = 'AccountType1pw';
  const rupees = (n: number) => n * 100;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  /** A household holding one account of each type the payload should now distinguish. */
  async function household(prefix: string) {
    const email = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`;
    const reg = await http()
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, fullName: 'Typed Accounts' });
    expect(reg.status).toBe(201);
    const token = reg.body.accessToken as string;
    const ws = await http().post('/api/onboarding/household').set(auth(token)).send({});
    expect(ws.status).toBe(201);
    const householdId = ws.body.householdId as string;

    // A retirement account and a taxable investment holding the SAME asset class. Before Gap 6
    // these were indistinguishable in the payload; that is the whole point of the milestone.
    const accounts = [
      { name: 'PPF', type: 'retirement', assetClass: 'debt', amount: 500000 },
      { name: 'Debt fund', type: 'investment', assetClass: 'debt', amount: 300000 },
      { name: 'Cash & savings', type: 'bank', assetClass: 'cash', amount: 200000 },
    ];
    for (const a of accounts) {
      const res = await http()
        .post(`/api/households/${householdId}/accounts`)
        .set(auth(token))
        .send({
          name: a.name,
          type: a.type,
          assetClass: a.assetClass,
          currency: 'INR',
          balanceMinor: rupees(a.amount),
          isLiability: false,
        });
      expect(res.status).toBe(201);
    }
    return { token, householdId };
  }

  const capture = (t: string, id: string) =>
    http().post(`/api/households/${id}/financial-snapshot`).set(auth(t)).send({});

  const assetsOf = (payload: unknown) =>
    (payload as FinancialSnapshotPayload).assets as {
      name: string;
      assetClass: string | null;
      accountType?: string;
    }[];

  it('1 — a NEW snapshot carries accountType, and schemaVersion stays 1', async () => {
    const { token, householdId } = await household('at_new');

    const snap = await capture(token, householdId);
    expect(snap.status).toBe(201);

    const row = await prisma.financialSnapshot.findUnique({ where: { id: snap.body.id } });
    expect(row).not.toBeNull();
    expect(row!.schemaVersion).toBe(1); // additive — no bump

    const assets = assetsOf(row!.payload);
    const byName = (n: string) => assets.find((a) => a.name === n)!;

    expect(byName('PPF').accountType).toBe('retirement');
    expect(byName('Debt fund').accountType).toBe('investment');
    expect(byName('Cash & savings').accountType).toBe('bank');
  });

  it('1b — it distinguishes accounts that assetClass alone cannot', async () => {
    // Teeth. Two accounts, identical assetClass, different kind of account. Without the field
    // the payload could not tell a PPF balance from a taxable debt fund.
    const { token, householdId } = await household('at_teeth');
    const snap = await capture(token, householdId);

    const assets = assetsOf(
      (await prisma.financialSnapshot.findUnique({ where: { id: snap.body.id } }))!.payload,
    );
    const ppf = assets.find((a) => a.name === 'PPF')!;
    const fund = assets.find((a) => a.name === 'Debt fund')!;

    expect(ppf.assetClass).toBe(fund.assetClass); // same asset class …
    expect(ppf.accountType).not.toBe(fund.accountType); // … different account type
  });

  it('2 — an OLD snapshot with no accountType stays valid and is never rewritten', async () => {
    const { token, householdId } = await household('at_legacy');

    // A snapshot as it would have been captured before M5.15: assets carry no accountType.
    const real = await capture(token, householdId);
    const template = await prisma.financialSnapshot.findUnique({ where: { id: real.body.id } });

    const legacyPayload = {
      ...(template!.payload as object),
      assets: assetsOf(template!.payload).map((a) => {
        const { accountType: _drop, ...rest } = a;
        void _drop;
        return rest;
      }),
    } as unknown as FinancialSnapshotPayload;

    const legacyChecksum = createHash('sha256')
      .update(canonicalStringify(legacyPayload))
      .digest('hex');

    const legacy = await prisma.financialSnapshot.create({
      data: {
        householdId,
        firmId: template!.firmId,
        capturedAt: new Date(Date.now() - 86_400_000),
        snapshotVersion: 0,
        schemaVersion: 1,
        engineVersion: template!.engineVersion,
        fxVersion: template!.fxVersion,
        currency: template!.currency,
        checksum: legacyChecksum,
        payload: legacyPayload as never,
      },
    });

    // Readable through the real API, and still a valid v1 payload.
    const read = await http()
      .get(`/api/households/${householdId}/financial-snapshot/${legacy.id}`)
      .set(auth(token));
    expect(read.status).toBe(200);
    expect(read.body.schemaVersion).toBe(1);
    for (const a of assetsOf(read.body.payload)) {
      expect(a.accountType).toBeUndefined();
      expect(a.assetClass).toBeDefined(); // the rest of the contract is intact
    }
  });

  it('3 — an absent accountType stays undefined, and is never defaulted', async () => {
    const { token, householdId } = await household('at_absent');
    const real = await capture(token, householdId);
    const template = await prisma.financialSnapshot.findUnique({ where: { id: real.body.id } });

    const stripped = assetsOf(template!.payload).map((a) => {
      const { accountType: _drop, ...rest } = a;
      void _drop;
      return rest;
    });
    const legacy = await prisma.financialSnapshot.create({
      data: {
        householdId,
        firmId: template!.firmId,
        capturedAt: new Date(Date.now() - 86_400_000),
        snapshotVersion: 0,
        schemaVersion: 1,
        engineVersion: template!.engineVersion,
        fxVersion: template!.fxVersion,
        currency: template!.currency,
        checksum: 'legacy-checksum-not-recomputed',
        payload: { ...(template!.payload as object), assets: stripped } as never,
      },
    });

    const read = await http()
      .get(`/api/households/${householdId}/financial-snapshot/${legacy.id}`)
      .set(auth(token));

    for (const a of assetsOf(read.body.payload)) {
      expect(a.accountType).toBeUndefined();
      expect(a.accountType).not.toBe(false);
      expect(a.accountType).not.toBeNull();
      expect(a.accountType).not.toBe('');
      expect(a.accountType).not.toBe('other_asset');
      // Not even present as an explicit undefined — that would still change serialization.
      expect(Object.prototype.hasOwnProperty.call(a, 'accountType')).toBe(false);
    }
  });

  it('4 — capturing a new snapshot leaves stored snapshots byte-identical, checksum included', async () => {
    // Immutability is the property the whole kernel rests on (ADR-004/012). A new field in the
    // payload shape must not disturb a single stored row.
    const { token, householdId } = await household('at_immutable');

    const first = await capture(token, householdId);
    const before = await prisma.financialSnapshot.findUnique({ where: { id: first.body.id } });
    const beforeJson = canonicalStringify(before!.payload as never);
    const beforeChecksum = before!.checksum;

    // Change the household, then capture again — a genuinely different second snapshot.
    await http()
      .post(`/api/households/${householdId}/accounts`)
      .set(auth(token))
      .send({
        name: 'NPS',
        type: 'retirement',
        assetClass: 'equity',
        currency: 'INR',
        balanceMinor: rupees(100000),
        isLiability: false,
      });
    const second = await capture(token, householdId);
    expect(second.status).toBe(201);
    expect(second.body.id).not.toBe(first.body.id);

    const after = await prisma.financialSnapshot.findUnique({ where: { id: first.body.id } });
    expect(canonicalStringify(after!.payload as never)).toBe(beforeJson);
    expect(after!.checksum).toBe(beforeChecksum);
    expect(after!.capturedAt.toISOString()).toBe(before!.capturedAt.toISOString());

    // And the checksum genuinely still describes the payload it was computed over.
    expect(createHash('sha256').update(beforeJson).digest('hex')).toBe(beforeChecksum);
  });

  it('4b — the preview path carries accountType too, and persists nothing', async () => {
    // `compose()` serves both preview and capture; a divergence would mean the "what would a
    // snapshot look like now" view disagreed with the snapshot it previews.
    const { token, householdId } = await household('at_preview');

    const beforeCount = await prisma.financialSnapshot.count({ where: { householdId } });
    const preview = await http()
      .get(`/api/households/${householdId}/financial-snapshot/current`)
      .set(auth(token));
    expect(preview.status).toBe(200);

    expect(assetsOf(preview.body.payload).find((a) => a.name === 'PPF')!.accountType).toBe(
      'retirement',
    );
    expect(await prisma.financialSnapshot.count({ where: { householdId } })).toBe(beforeCount);
  });
});
