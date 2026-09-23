import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { canonicalStringify, type FinancialSnapshotPayload } from '@lcos/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * A family can record retirement savings (M5.16), and say how it is invested (M5.18).
 *
 * See `docs/M5_16_RETIREMENT_CAPTURE_ARCHITECTURE.md` and
 * `docs/M5_18_RETIREMENT_CLASSIFICATION_ARCHITECTURE.md`.
 *
 * M5.15 taught the payload to carry `assets[].accountType`; nothing could produce a value for
 * it from a consumer surface, because the Wealth Health Check wrote exactly three account types
 * and no other V2 page creates an account at all. This suite covers the capture path that
 * closes that, and the four properties it must not break:
 *
 *  1. The wizard writes a `retirement` account, with **no** `assetClass`.
 *  2. That type reaches the next snapshot — the first end-to-end exercise of M5.15's field
 *     with consumer-created data.
 *  3. Absent stays absent: the balance lands in the `unclassified` allocation bucket, is
 *     excluded from Emergency Liquidity, and is included in the investable corpus — all from
 *     existing logic, with no branch anywhere on `accountType`.
 *  4. Recording it rewrites no stored snapshot, checksum included.
 *
 * M5.18 adds the answer to the question M5.17 put on the dashboard, and with it the first case
 * in this suite where naming something is *supposed* to move a number:
 *
 *  5. A family can state the asset class of their retirement money; the next snapshot buckets it
 *     accordingly, silence still means unclassified, an answer already given survives a run that
 *     omits it, no answer can reach Emergency Liquidity, and nothing outside the allocation moves.
 *
 * The `runCheck` helper mirrors `apps/web/src/lib/wealthHealth.ts`, for the same reason the
 * idempotency suite does: it is the behaviour under test, and a divergence here would make
 * these tests assert something the product does not do.
 */
describe('Retirement capture (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const PASSWORD = 'RetireCapture1pw';
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

  const OWNED = {
    cash: 'Cash & savings',
    investments: 'Investments',
    retirement: 'Retirement savings',
    property: 'Property',
  };

  interface Figures {
    cash?: number;
    investments?: number;
    retirement?: number;
    /**
     * M5.18 — how the family says their retirement money is invested. Absent = not answered.
     *
     * Mirrors `RetirementAssetClass` in `apps/web/src/lib/wealthHealth.ts`, `cash` included in
     * its absence: classing retirement money as cash would put it in the emergency fund. Case 10
     * is the assertion that keeps this list and that one in step.
     */
    retirementAssetClass?: 'equity' | 'debt' | 'other';
    property?: number;
    monthlyIncome?: number;
    monthlyExpenses?: number;
  }

  const FLOW = {
    income: { type: 'income', category: 'salary' },
    expense: { type: 'expense', category: 'living' },
  };

  interface AccountRow {
    id: string;
    name: string;
    type: string;
    assetClass: string | null;
    balanceMinor: string | number;
  }

  async function newConsumer(prefix: string) {
    const email = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`;
    const reg = await http()
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, fullName: 'Anita Bhuyan' });
    expect(reg.status).toBe(201);
    const token = reg.body.accessToken as string;
    const ws = await http()
      .post('/api/onboarding/household')
      .set(auth(token))
      .send({ familyName: 'The Bhuyans' });
    expect(ws.status).toBe(201);
    return { token, householdId: ws.body.householdId as string };
  }

  const accountsOf = async (token: string, id: string) =>
    (await http().get(`/api/households/${id}/accounts`).set(auth(token))).body as AccountRow[];

  const named = (rows: AccountRow[], name: string) => rows.filter((r) => r.name === name);

  /** The exact sequence `wealthHealth.ts` performs — assets, then cashflow, then capture. */
  async function runCheck(token: string, householdId: string, input: Figures) {
    const f = {
      cash: 0,
      investments: 0,
      retirement: 0,
      property: 0,
      monthlyIncome: 0,
      monthlyExpenses: 0,
      ...input,
    };
    const existing = await accountsOf(token, householdId);
    let anchor: string | null = null;

    for (const asset of [
      { amount: f.cash, name: OWNED.cash, type: 'bank', assetClass: 'cash' },
      { amount: f.investments, name: OWNED.investments, type: 'investment', assetClass: 'equity' },
      { amount: f.property, name: OWNED.property, type: 'real_estate', assetClass: 'real_estate' },
      // Appended last. No asset class unless the family gave one (M5.16 capture, M5.18 answer).
      {
        amount: f.retirement,
        name: OWNED.retirement,
        type: 'retirement',
        ...(input.retirementAssetClass !== undefined
          ? { assetClass: input.retirementAssetClass, stated: true }
          : {}),
      },
    ] as { amount: number; name: string; type: string; assetClass?: string; stated?: boolean }[]) {
      const current = named(existing, asset.name)[0];
      if (current) {
        await http()
          .patch(`/api/households/${householdId}/accounts/${current.id}`)
          .set(auth(token))
          .send({
            balanceMinor: rupees(asset.amount),
            // M5.18 — only a class the family stated THIS run is sent; the other rows PATCH
            // exactly as they always have.
            ...(asset.stated ? { assetClass: asset.assetClass } : {}),
          });
        if (!anchor || asset.assetClass === 'cash') anchor = current.id;
        continue;
      }
      if (asset.amount <= 0) continue;
      const created = await http()
        .post(`/api/households/${householdId}/accounts`)
        .set(auth(token))
        .send({
          name: asset.name,
          type: asset.type,
          ...(asset.assetClass !== undefined ? { assetClass: asset.assetClass } : {}),
          currency: 'INR',
          balanceMinor: rupees(asset.amount),
          isLiability: false,
        });
      expect(created.status).toBe(201);
      if (!anchor || asset.assetClass === 'cash') anchor = created.body.id;
    }

    const period = new Date().toISOString().slice(0, 7);
    const txs = (
      await http().get(`/api/households/${householdId}/cashflow?month=${period}`).set(auth(token))
    ).body as { id: string; type: string; category: string; status: string }[];
    for (const flow of [
      { amount: f.monthlyIncome, ...FLOW.income },
      { amount: f.monthlyExpenses, ...FLOW.expense },
    ]) {
      const current = txs.filter(
        (t) => t.type === flow.type && t.category === flow.category && t.status !== 'void',
      )[0];
      if (current) {
        await http()
          .patch(`/api/households/${householdId}/cashflow/${current.id}`)
          .set(auth(token))
          .send(flow.amount > 0 ? { amountMinor: rupees(flow.amount) } : { status: 'void' });
        continue;
      }
      if (flow.amount <= 0 || !anchor) continue;
      const created = await http()
        .post(`/api/households/${householdId}/cashflow`)
        .set(auth(token))
        .send({
          accountId: anchor,
          type: flow.type,
          category: flow.category,
          amountMinor: rupees(flow.amount),
          currency: 'INR',
          occurredAt: new Date().toISOString(),
        });
      expect(created.status).toBe(201);
    }

    const snap = await http()
      .post(`/api/households/${householdId}/financial-snapshot`)
      .set(auth(token))
      .send({});
    expect(snap.status).toBe(201);
    return snap.body as { id: string; checksum: string };
  }

  const FULL: Figures = {
    cash: 200000,
    investments: 300000,
    retirement: 500000,
    property: 5000000,
    monthlyIncome: 300000,
    monthlyExpenses: 75000,
  };

  const assetsOf = (payload: unknown) =>
    (payload as FinancialSnapshotPayload).assets as {
      name: string;
      assetClass: string | null;
      accountType?: string;
    }[];

  it('1 — a consumer records retirement savings, as a retirement account with no asset class', async () => {
    const { token, householdId } = await newConsumer('cap_new');
    await runCheck(token, householdId, FULL);

    const row = named(await accountsOf(token, householdId), OWNED.retirement)[0];
    expect(row).toBeDefined();
    expect(row.type).toBe('retirement');
    expect(Number(row.balanceMinor)).toBe(rupees(500000));

    // Never mapped to a class. Retirement is a kind of account, not a kind of asset: PPF is
    // debt, NPS-E is equity, and the family was not asked which. Picking one would assert a
    // fact nobody recorded (#67, M5.9, M5.12, M5.14).
    expect(row.assetClass).toBeNull();
    expect(row.assetClass).not.toBe('cash');
    expect(row.assetClass).not.toBe('equity');
    expect(row.assetClass).not.toBe('debt');
    expect(row.assetClass).not.toBe('other');
  });

  it('1b — it is distinguishable from ordinary investing, which assetClass alone could not do', async () => {
    // Teeth. Before M5.16 a family's EPF went into "Investments" as type `investment` —
    // the wizard's own hint told them to — so the payload could not tell retirement money
    // from a taxable fund.
    const { token, householdId } = await newConsumer('cap_teeth');
    await runCheck(token, householdId, FULL);
    const rows = await accountsOf(token, householdId);

    expect(named(rows, OWNED.retirement)[0].type).toBe('retirement');
    expect(named(rows, OWNED.investments)[0].type).toBe('investment');
    expect(named(rows, OWNED.retirement)[0].type).not.toBe(named(rows, OWNED.investments)[0].type);
  });

  it('2 — the type reaches the next snapshot, at schemaVersion 1', async () => {
    const { token, householdId } = await newConsumer('cap_snap');
    const snap = await runCheck(token, householdId, FULL);

    const stored = await prisma.financialSnapshot.findUnique({ where: { id: snap.id } });
    expect(stored).not.toBeNull();
    expect(stored!.schemaVersion).toBe(1); // additive — M5.15 added no version

    const asset = assetsOf(stored!.payload).find((a) => a.name === OWNED.retirement)!;
    expect(asset).toBeDefined();
    expect(asset.accountType).toBe('retirement');
    // And the asset class is absent in the payload too — not null-as-a-value, absent.
    expect(asset.assetClass).toBeNull();
  });

  it('3 — the balance lands in the unclassified allocation bucket, never a defaulted class', async () => {
    const { token, householdId } = await newConsumer('cap_alloc');
    const snap = await runCheck(token, householdId, FULL);
    const stored = await prisma.financialSnapshot.findUnique({ where: { id: snap.id } });
    const alloc = (stored!.payload as unknown as FinancialSnapshotPayload).assetAllocation;

    const unclassified = alloc.find((a) => a.assetClass === 'unclassified');
    expect(unclassified).toBeDefined();
    expect(unclassified!.baseValueMinor).toBe(rupees(500000));

    // It did not silently join any real class.
    const classOf = (c: string) => alloc.find((a) => a.assetClass === c)?.baseValueMinor ?? 0;
    expect(classOf('cash')).toBe(rupees(200000));
    expect(classOf('equity')).toBe(rupees(300000));
    expect(classOf('real_estate')).toBe(rupees(5000000));
    expect(classOf('debt')).toBe(0);
    expect(classOf('other')).toBe(0);
  });

  it('4 — excluded from Emergency Liquidity, included in the investable corpus', async () => {
    // The two guarantees the milestone rests on, and both fall out of existing logic:
    // liquidity filters `assetClass === 'cash'`, the corpus filters `!== 'real_estate'`.
    // Neither branches on `accountType`, and M5.16 adds no branch that does.
    const { token, householdId } = await newConsumer('cap_corpus');

    const members = await http().get(`/api/households/${householdId}/members`).set(auth(token));
    const self = (members.body as { id: string; relation: string }[]).find(
      (m) => m.relation === 'self',
    )!;
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 41);
    await http()
      .patch(`/api/households/${householdId}/members/${self.id}`)
      .set(auth(token))
      .send({ dateOfBirth: dob.toISOString().slice(0, 10) });

    await runCheck(token, householdId, FULL);
    const intel = await http()
      .get(`/api/households/${householdId}/intelligence/current`)
      .set(auth(token));
    expect(intel.status).toBe(200);

    // Included: everything except the home. 2L + 3L + 5L = 10L; the 50L property is excluded.
    expect(intel.body.retirement.data.currentCorpusMinor).toBe(rupees(200000 + 300000 + 500000));

    // Excluded from the emergency fund: retirement money is not reachable in a crisis, and
    // counting it would tell a family they are covered when they are not.
    expect(intel.body.emergencyFund.available).toBe(true);
    expect(intel.body.emergencyFund.data.cashMinor).toBe(rupees(200000));
  });

  /** Sets a date of birth so the retirement section can report at all. */
  async function withAge(token: string, householdId: string) {
    const members = await http().get(`/api/households/${householdId}/members`).set(auth(token));
    const self = (members.body as { id: string; relation: string }[]).find(
      (m) => m.relation === 'self',
    )!;
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 41);
    await http()
      .patch(`/api/households/${householdId}/members/${self.id}`)
      .set(auth(token))
      .send({ dateOfBirth: dob.toISOString().slice(0, 10) });
  }

  it('4b — M5.17: the intelligence layer reports the retirement balance, end to end', async () => {
    // The first reader of `accountType` anywhere. M5.15 put the field in the payload and M5.16
    // let a family produce one; until M5.17 nothing read it back, so a family who said "this is
    // my retirement savings" was shown a bucket called `unclassified` and nothing else. This
    // walks the whole path: wizard -> account -> snapshot -> intelligence.
    const { token, householdId } = await newConsumer('cap_legible');
    await withAge(token, householdId);
    await runCheck(token, householdId, FULL);

    const intel = await http()
      .get(`/api/households/${householdId}/intelligence/current`)
      .set(auth(token));
    expect(intel.status).toBe(200);

    // The new figure: exactly what the family recorded, and nothing else. TOP LEVEL, not inside
    // the retirement section — see 4d for why that distinction is the milestone's real fix.
    expect(intel.body.retirementAccountsMinor).toBe(rupees(500000));

    // And it changed NOTHING it sits beside. The corpus is the figure case 4 asserts, the
    // allocation still buckets the money as unclassified, and no `retirement` class exists.
    expect(intel.body.retirement.data.currentCorpusMinor).toBe(rupees(200000 + 300000 + 500000));
    const classes = (
      intel.body.assetAllocation.data.current as { assetClass: string }[]
    ).map((c) => c.assetClass);
    expect(classes).toContain('unclassified');
    expect(classes).not.toContain('retirement');

    // The same figure reaches the retirement page's own endpoint — one definition, two readers.
    const overview = await http().get(`/api/households/${householdId}/retirement`).set(auth(token));
    expect(overview.status).toBe(200);
    expect(overview.body.retirementAccountsMinor).toBe(rupees(500000));
  });

  it('4c — M5.17: a household with no retirement account reports 0, not null', async () => {
    // "We asked and they have none" is an answer, and must stay distinguishable from "this
    // snapshot predates account types", which is null. The three-state rule, a sixth time.
    const { token, householdId } = await newConsumer('cap_none');
    await withAge(token, householdId);
    await runCheck(token, householdId, { ...FULL, retirement: 0 });

    const intel = await http()
      .get(`/api/households/${householdId}/intelligence/current`)
      .set(auth(token));
    expect(intel.body.retirementAccountsMinor).toBe(0);
    expect(intel.body.retirementAccountsMinor).not.toBeNull();
  });

  it('4d — M5.17: the figure survives a household with NO date of birth', async () => {
    // The default state of every newly onboarded family: neither onboarding nor the Wealth
    // Health Check records a date of birth, so the retirement PROJECTION cannot be made. That
    // says nothing about how much sits in a retirement account, and must not hide it.
    //
    // This is the case the first cut of M5.17 got wrong: the figure hung off the retirement
    // section, so the family who most needed to see their retirement savings could not.
    const { token, householdId } = await newConsumer('cap_nodob');
    await runCheck(token, householdId, FULL); // deliberately NO withAge()

    const intel = await http()
      .get(`/api/households/${householdId}/intelligence/current`)
      .set(auth(token));
    expect(intel.status).toBe(200);

    // The projection genuinely cannot be made …
    expect(intel.body.retirement.available).toBe(false);
    // … and the fact is reported anyway.
    expect(intel.body.retirementAccountsMinor).toBe(rupees(500000));

    // Same on the retirement page's own endpoint.
    const overview = await http().get(`/api/households/${householdId}/retirement`).set(auth(token));
    expect(overview.body.retirement.available).toBe(false);
    expect(overview.body.retirementAccountsMinor).toBe(rupees(500000));
  });

  it('5 — recording it rewrites no stored snapshot, checksum included', async () => {
    // Immutability is what the whole kernel rests on (ADR-004/012). A family recording a new
    // kind of account must not disturb a single byte of what was already captured.
    const { token, householdId } = await newConsumer('cap_immutable');

    // A first capture with no retirement savings — the shape of every pre-M5.16 household.
    const before = await runCheck(token, householdId, { ...FULL, retirement: 0 });
    const stored = await prisma.financialSnapshot.findUnique({ where: { id: before.id } });
    const beforeJson = canonicalStringify(stored!.payload as never);
    const beforeChecksum = stored!.checksum;

    // No retirement row was created for a zero figure — an account is not created to hold zero.
    expect(named(await accountsOf(token, householdId), OWNED.retirement)).toHaveLength(0);
    expect(assetsOf(stored!.payload).find((a) => a.name === OWNED.retirement)).toBeUndefined();

    // Now they record it.
    const after = await runCheck(token, householdId, FULL);
    expect(after.id).not.toBe(before.id);

    const reread = await prisma.financialSnapshot.findUnique({ where: { id: before.id } });
    expect(canonicalStringify(reread!.payload as never)).toBe(beforeJson);
    expect(reread!.checksum).toBe(beforeChecksum);
    expect(reread!.capturedAt.toISOString()).toBe(stored!.capturedAt.toISOString());
    // …and the checksum still genuinely describes the payload it was taken over.
    expect(createHash('sha256').update(beforeJson).digest('hex')).toBe(beforeChecksum);

    // The earlier snapshot still reports no retirement account. History says what it said.
    const old = assetsOf(reread!.payload);
    expect(old.find((a) => a.name === OWNED.retirement)).toBeUndefined();
    const fresh = await prisma.financialSnapshot.findUnique({ where: { id: after.id } });
    expect(assetsOf(fresh!.payload).find((a) => a.name === OWNED.retirement)!.accountType).toBe(
      'retirement',
    );
  });

  it('6 — a blank figure zeroes the row and keeps it; zero on a first run creates nothing', async () => {
    const { token, householdId } = await newConsumer('cap_blank');

    // Zero on a first run: no account at all. A blank field is not a balance of zero until
    // the family has told us something to zero.
    await runCheck(token, householdId, { ...FULL, retirement: 0 });
    expect(named(await accountsOf(token, householdId), OWNED.retirement)).toHaveLength(0);

    await runCheck(token, householdId, FULL);
    const created = named(await accountsOf(token, householdId), OWNED.retirement)[0];
    expect(Number(created.balanceMinor)).toBe(rupees(500000));

    // Clearing it afterwards is "I have none of this" — a figure, not an event. Same row,
    // zeroed, still typed, its history intact.
    await runCheck(token, householdId, { ...FULL, retirement: 0 });
    const cleared = named(await accountsOf(token, householdId), OWNED.retirement);
    expect(cleared).toHaveLength(1);
    expect(cleared[0].id).toBe(created.id);
    expect(Number(cleared[0].balanceMinor)).toBe(0);
    expect(cleared[0].type).toBe('retirement');
    expect(cleared[0].assetClass).toBeNull();
  });

  // ---------------------------------------------------------------------------------------
  // M5.18 — the family answers the question M5.17 put to them.
  //
  // M5.17 showed a family their retirement balance beside an allocation calling it "Not yet
  // classified", and invited them to *"tell us how it's invested"*. Nothing carried that
  // invitation anywhere: no consumer surface could set `assetClass` on a retirement account.
  // These cases cover the path that does, and the four things it must not disturb.
  //
  // This milestone deliberately MOVES NUMBERS — for a family who answers, and only for them.
  // That is the point: an answer is new information, and the allocation should change when it
  // arrives. Cases 10 and 11 fix the boundary of that movement.
  // ---------------------------------------------------------------------------------------

  it('7 — a family says how their retirement money is invested, and the next snapshot agrees', async () => {
    const { token, householdId } = await newConsumer('cls_answer');

    // First run, unanswered — the M5.16 shape, and the state every family starts in.
    await runCheck(token, householdId, FULL);
    expect(named(await accountsOf(token, householdId), OWNED.retirement)[0].assetClass).toBeNull();

    // They answer: EPF and PPF, so debt.
    const snap = await runCheck(token, householdId, { ...FULL, retirementAssetClass: 'debt' });

    // The answer is on the row they own …
    const row = named(await accountsOf(token, householdId), OWNED.retirement)[0];
    expect(row.assetClass).toBe('debt');

    // … and, crucially, it did not consume the fact already there. `accountType` says what kind
    // of account holds the money, `assetClass` what economic asset it is. Two facts, both true,
    // neither derivable from the other — the boundary M5.16 drew and M5.18 must not blur.
    expect(row.type).toBe('retirement');

    // The next snapshot buckets it as debt, and the unclassified bucket is empty because there
    // is genuinely nothing left unclassified.
    const stored = await prisma.financialSnapshot.findUnique({ where: { id: snap.id } });
    const alloc = (stored!.payload as unknown as FinancialSnapshotPayload).assetAllocation;
    const classOf = (c: string) => alloc.find((a) => a.assetClass === c)?.baseValueMinor ?? 0;
    expect(classOf('debt')).toBe(rupees(500000));
    expect(classOf('unclassified')).toBe(0);
    expect(alloc.find((a) => a.assetClass === 'unclassified')).toBeUndefined();

    // Everything else sits exactly where case 3 left it. The other three rows were PATCHed with
    // no `assetClass` at all, as they always have been.
    expect(classOf('cash')).toBe(rupees(200000));
    expect(classOf('equity')).toBe(rupees(300000));
    expect(classOf('real_estate')).toBe(rupees(5000000));

    // And the payload still carries the account type, so M5.17's figure is unaffected.
    const asset = assetsOf(stored!.payload).find((a) => a.name === OWNED.retirement)!;
    expect(asset.accountType).toBe('retirement');
    expect(asset.assetClass).toBe('debt');
  });

  it('7b — equity is equally available, so the answer is the family’s and not a default', async () => {
    // Teeth for case 7: if the path hard-coded `debt` — the likeliest answer for an Indian
    // household, and therefore the easiest thing to quietly assume — case 7 alone would pass.
    const { token, householdId } = await newConsumer('cls_equity');
    await runCheck(token, householdId, { ...FULL, retirementAssetClass: 'equity' });

    const row = named(await accountsOf(token, householdId), OWNED.retirement)[0];
    expect(row.assetClass).toBe('equity');
    expect(row.assetClass).not.toBe('debt');

    // Their NPS-E sits with their other equity rather than in a bucket of its own: 3L of
    // investments plus 5L of retirement. An asset class is an economic fact about money, and
    // where it is held does not change it.
    const intel = await http()
      .get(`/api/households/${householdId}/intelligence/current`)
      .set(auth(token));
    const current = intel.body.assetAllocation.data.current as {
      assetClass: string;
      baseValueMinor: number;
    }[];
    expect(current.find((c) => c.assetClass === 'equity')!.baseValueMinor).toBe(rupees(800000));
    expect(current.map((c) => c.assetClass)).not.toContain('retirement');
  });

  it('8 — declining to answer leaves the money unclassified, never a default', async () => {
    // The three-state rule, for the last field of the milestone. "We have not asked" and "they
    // chose debt" are different facts, and the first must survive a full run of the wizard —
    // which now shows the question, so silence here is a *declined* question, not an unasked
    // one. It still must not become a value.
    const { token, householdId } = await newConsumer('cls_decline');
    const snap = await runCheck(token, householdId, FULL); // question shown, left at "Not sure yet"

    const row = named(await accountsOf(token, householdId), OWNED.retirement)[0];
    expect(row.assetClass).toBeNull();
    expect(row.assetClass).not.toBe('debt');
    expect(row.assetClass).not.toBe('equity');
    expect(row.assetClass).not.toBe('other');

    const stored = await prisma.financialSnapshot.findUnique({ where: { id: snap.id } });
    const alloc = (stored!.payload as unknown as FinancialSnapshotPayload).assetAllocation;
    expect(alloc.find((a) => a.assetClass === 'unclassified')!.baseValueMinor).toBe(rupees(500000));
  });

  it('9 — an answer already given is not erased by a later run that skips the question', async () => {
    // Gap 7's failure mode, in a new field: a later submission carrying nothing for a question
    // must not write that nothing over an answer. The wizard prefills the control, so a normal
    // re-run resubmits the answer — but a run that omits it (an older client, a family who
    // cleared the field, any path that does not reach step 1) must leave the answer standing.
    // Silence is not a retraction.
    const { token, householdId } = await newConsumer('cls_persist');
    await runCheck(token, householdId, { ...FULL, retirementAssetClass: 'debt' });
    expect(named(await accountsOf(token, householdId), OWNED.retirement)[0].assetClass).toBe('debt');

    // A full run, figures changed, no answer supplied.
    const snap = await runCheck(token, householdId, { ...FULL, retirement: 600000 });

    const row = named(await accountsOf(token, householdId), OWNED.retirement)[0];
    expect(Number(row.balanceMinor)).toBe(rupees(600000)); // the figure did move
    expect(row.assetClass).toBe('debt'); // the answer did not
    expect(row.assetClass).not.toBeNull();

    const stored = await prisma.financialSnapshot.findUnique({ where: { id: snap.id } });
    const alloc = (stored!.payload as unknown as FinancialSnapshotPayload).assetAllocation;
    expect(alloc.find((a) => a.assetClass === 'debt')!.baseValueMinor).toBe(rupees(600000));
    expect(alloc.find((a) => a.assetClass === 'unclassified')).toBeUndefined();
  });

  it('10 — classifying retirement money never moves it into the emergency fund', async () => {
    // The guard that shapes the offered answers. `cashMinorOf` in `@lcos/core` and the household
    // composer's own liquidity sum both read `assetClass === 'cash'` as "reachable in a crisis",
    // and neither looks at `accountType`. A family who classed their EPF as cash would be told
    // they hold months of buffer in money locked until 58 — covered when they are not, the exact
    // harm case 4 exists to prevent.
    //
    // `RetirementAssetClass` therefore excludes `cash`. This case pins the consequence rather
    // than the list, so it keeps biting however the list is spelled. Teaching the liquidity
    // derivations to exclude retirement accounts is the proper fix and is a later milestone;
    // this milestone does not touch a frozen derivation to make room for one option.
    const { token, householdId } = await newConsumer('cls_liquid');
    await withAge(token, householdId);

    const read = async () => {
      const intel = await http()
        .get(`/api/households/${householdId}/intelligence/current`)
        .set(auth(token));
      expect(intel.status).toBe(200);
      return intel.body;
    };

    await runCheck(token, householdId, FULL);
    const before = await read();
    expect(before.emergencyFund.data.cashMinor).toBe(rupees(200000));

    for (const answer of ['debt', 'equity', 'other'] as const) {
      await runCheck(token, householdId, { ...FULL, retirementAssetClass: answer });
      const after = await read();
      // Not one paisa of retirement money reaches liquidity, whatever they answered.
      expect(after.emergencyFund.data.cashMinor).toBe(rupees(200000));
      expect(after.emergencyFund.data.cashMinor).not.toBe(rupees(700000));
    }
  });

  it('11 — the answer moves the allocation and nothing else: corpus, kernel versions, history', async () => {
    // The blast radius, stated. This milestone is allowed to move allocation-derived figures for
    // a family who answers, because an answer is information. It is allowed to move nothing else.
    const { token, householdId } = await newConsumer('cls_bounds');
    await withAge(token, householdId);

    const first = await runCheck(token, householdId, FULL);
    const firstStored = await prisma.financialSnapshot.findUnique({ where: { id: first.id } });
    const firstJson = canonicalStringify(firstStored!.payload as never);
    const firstChecksum = firstStored!.checksum;

    const intelBefore = await http()
      .get(`/api/households/${householdId}/intelligence/current`)
      .set(auth(token));
    const corpusBefore = intelBefore.body.retirement.data.currentCorpusMinor;
    expect(corpusBefore).toBe(rupees(200000 + 300000 + 500000));

    const second = await runCheck(token, householdId, { ...FULL, retirementAssetClass: 'debt' });
    const intelAfter = await http()
      .get(`/api/households/${householdId}/intelligence/current`)
      .set(auth(token));

    // The investable corpus filters `assetClass !== 'real_estate'`. `unclassified` was in it and
    // `debt` is in it, so naming the class changes the composition of nothing.
    expect(intelAfter.body.retirement.data.currentCorpusMinor).toBe(corpusBefore);

    // M5.17's figure reads `accountType`, which the answer did not touch.
    expect(intelAfter.body.retirementAccountsMinor).toBe(rupees(500000));

    // The contract did not move: the answer is a value in an existing field, not a new shape.
    const secondStored = await prisma.financialSnapshot.findUnique({ where: { id: second.id } });
    expect(secondStored!.schemaVersion).toBe(1);
    expect(intelAfter.body.meta.schemaVersion).toBe(1);
    expect(intelAfter.body.meta.engineVersion).toBe('m5-fil-1.0.0');
    expect(intelAfter.body.meta.scoreModelVersion).toBe('fhs-2.0.0');

    // No asset class was invented to hold retirement money — the rule M5.16 and M5.17 both rest
    // on, and the one an answer field is most tempting to break.
    const classes = (
      intelAfter.body.assetAllocation.data.current as { assetClass: string }[]
    ).map((c) => c.assetClass);
    expect(classes).toContain('debt');
    expect(classes).not.toContain('retirement');
    expect(classes).not.toContain('unclassified');

    // And the earlier snapshot is byte-identical, checksum included. History records what the
    // family knew then, not what they later told us. ADR-004/012.
    const reread = await prisma.financialSnapshot.findUnique({ where: { id: first.id } });
    expect(canonicalStringify(reread!.payload as never)).toBe(firstJson);
    expect(reread!.checksum).toBe(firstChecksum);
    expect(createHash('sha256').update(firstJson).digest('hex')).toBe(firstChecksum);

    // Concretely: the old snapshot still says unclassified, the new one says debt. Both true
    // when taken.
    const oldAlloc = (reread!.payload as unknown as FinancialSnapshotPayload).assetAllocation;
    expect(oldAlloc.find((a) => a.assetClass === 'unclassified')!.baseValueMinor).toBe(
      rupees(500000),
    );
    expect(
      (secondStored!.payload as unknown as FinancialSnapshotPayload).assetAllocation.find(
        (a) => a.assetClass === 'debt',
      )!.baseValueMinor,
    ).toBe(rupees(500000));
  });
});
