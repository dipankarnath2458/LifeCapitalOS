import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Retirement money is never emergency liquidity (M5.19).
 *
 * See `docs/M5_19_REACHABLE_CASH_ARCHITECTURE.md`.
 *
 * "Cash a family can reach in a crisis" was defined four times and no copy looked at
 * `accountType`, so a retirement account recorded as `assetClass: 'cash'` was counted as
 * emergency buffer on every one of them. The three inside `@lcos/core` are pinned by
 * `packages/core/src/finance/reachableCash.test.ts`. This suite covers the fourth — the retail
 * composer in `apps/api` — and walks both paths end to end through real HTTP, because the defect
 * was only ever visible where the pieces meet.
 *
 * The household path can still *record* the combination: `PATCH /accounts/:id` accepts all eight
 * asset classes, and M5.18 withheld `cash` from the consumer question rather than from the API.
 * That is deliberate, and it is exactly why the kernel has to be the thing that knows better.
 */
describe('Retirement money is not liquidity (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const PASSWORD = 'RetireLiquid1pw';
  const rupees = (n: number) => n * 100;

  // 15,00,000 reachable against 4,00,000 a month is 3.75 months — a real weakness. Counting the
  // 20,00,000 EPF makes it 8.75 and the shortfall disappears from view.
  const CASH = 1500000;
  const EPF = 2000000;
  const MONTHLY_EXPENSES = 400000;
  const MONTHLY_INCOME = 600000;

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

  // ---------------------------------------------------------------------------------------
  // The V2 household path — the primary consumer experience.
  // ---------------------------------------------------------------------------------------

  /** Records the family's figures and captures a snapshot, optionally classing the EPF. */
  async function seedHousehold(
    token: string,
    householdId: string,
    epf: { assetClass?: string } = {},
  ) {
    const mk = async (name: string, type: string, assetClass: string | undefined, amount: number) => {
      const res = await http()
        .post(`/api/households/${householdId}/accounts`)
        .set(auth(token))
        .send({
          name,
          type,
          ...(assetClass !== undefined ? { assetClass } : {}),
          currency: 'INR',
          balanceMinor: rupees(amount),
          isLiability: false,
        });
      expect(res.status).toBe(201);
      return res.body.id as string;
    };

    const cashId = await mk('Savings', 'bank', 'cash', CASH);
    await mk('EPF', 'retirement', epf.assetClass, EPF);

    for (const flow of [
      { type: 'income', category: 'salary', amount: MONTHLY_INCOME },
      { type: 'expense', category: 'living', amount: MONTHLY_EXPENSES },
    ]) {
      const res = await http()
        .post(`/api/households/${householdId}/cashflow`)
        .set(auth(token))
        .send({
          accountId: cashId,
          type: flow.type,
          category: flow.category,
          amountMinor: rupees(flow.amount),
          currency: 'INR',
          occurredAt: new Date().toISOString(),
        });
      expect(res.status).toBe(201);
    }

    const snap = await http()
      .post(`/api/households/${householdId}/financial-snapshot`)
      .set(auth(token))
      .send({});
    expect(snap.status).toBe(201);
    return snap.body as { id: string };
  }

  const intelOf = async (token: string, householdId: string) => {
    const res = await http()
      .get(`/api/households/${householdId}/intelligence/current`)
      .set(auth(token));
    expect(res.status).toBe(200);
    return res.body;
  };

  it('1 — an EPF recorded as cash is kept out of the household emergency fund', async () => {
    // The defect, end to end on the path that matters most. The family's own dashboard told them
    // they held 35,00,000 they could reach in a crisis. 20,00,000 of it is locked until 58.
    const { token, householdId } = await newConsumer('liq_epf');
    await seedHousehold(token, householdId, { assetClass: 'cash' });

    const intel = await intelOf(token, householdId);
    expect(intel.emergencyFund.available).toBe(true);
    expect(intel.emergencyFund.data.cashMinor).toBe(rupees(CASH));
    expect(intel.emergencyFund.data.cashMinor).not.toBe(rupees(CASH + EPF));
  });

  it('1b — an ordinary account holding the same cash is still counted, so the rule is about the wrapper', async () => {
    // Teeth. If case 1 passed because the balance vanished for some unrelated reason, this fails:
    // the identical money in a `bank` account is reachable and must still be counted.
    const { token, householdId } = await newConsumer('liq_bank');
    const mk = async (name: string, type: string, amount: number) => {
      const res = await http()
        .post(`/api/households/${householdId}/accounts`)
        .set(auth(token))
        .send({
          name,
          type,
          assetClass: 'cash',
          currency: 'INR',
          balanceMinor: rupees(amount),
          isLiability: false,
        });
      expect(res.status).toBe(201);
      return res.body.id as string;
    };
    const cashId = await mk('Savings', 'bank', CASH);
    await mk('Second savings', 'bank', EPF); // same money, ordinary wrapper

    for (const flow of [
      { type: 'income', category: 'salary', amount: MONTHLY_INCOME },
      { type: 'expense', category: 'living', amount: MONTHLY_EXPENSES },
    ]) {
      await http()
        .post(`/api/households/${householdId}/cashflow`)
        .set(auth(token))
        .send({
          accountId: cashId,
          type: flow.type,
          category: flow.category,
          amountMinor: rupees(flow.amount),
          currency: 'INR',
          occurredAt: new Date().toISOString(),
        });
    }
    await http().post(`/api/households/${householdId}/financial-snapshot`).set(auth(token)).send({});

    const intel = await intelOf(token, householdId);
    expect(intel.emergencyFund.data.cashMinor).toBe(rupees(CASH + EPF));
  });

  it('2 — the Wealth Health score follows, and the model behind it does not move', async () => {
    // The decision this milestone was approved under: the score may change because its INPUT was
    // wrong, not because the model was. Emergency Liquidity is the heaviest single dimension.
    const { token, householdId } = await newConsumer('liq_score');
    await seedHousehold(token, householdId, { assetClass: 'cash' });

    const score = await http()
      .get(`/api/households/${householdId}/health-score/current`)
      .set(auth(token));
    expect(score.status).toBe(200);
    expect(score.body.scoreModelVersion).toBe('fhs-2.0.0');

    const liquidity = (
      score.body.categories as { key: string; weight: number; metric?: { value: number } }[]
    ).find((c) => c.key === 'liquidity')!;
    expect(liquidity).toBeDefined();
    expect(liquidity.weight).toBe(14);
    // 15,00,000 / 4,00,000 = 3.75 months, not the 8.75 the old input claimed.
    expect(liquidity.metric!.value).toBe(3.8);
  });

  it('3 — an unclassified retirement account is unaffected, which is nearly every family', async () => {
    // M5.16 and M5.18 mean most retirement accounts carry no asset class at all. They were never
    // counted as cash and still are not: this milestone must not reach beyond its subject.
    const { token, householdId } = await newConsumer('liq_plain');
    await seedHousehold(token, householdId, {}); // no assetClass on the EPF

    const intel = await intelOf(token, householdId);
    expect(intel.emergencyFund.data.cashMinor).toBe(rupees(CASH));
    // And M5.17's figure still sees it as retirement money — both facts, independently true.
    expect(intel.retirementAccountsMinor).toBe(rupees(EPF));
  });

  it('4 — nothing outside liquidity moves: net worth, allocation, corpus, the retirement figure', async () => {
    // The blast radius, as an assertion. Only the liquidity family of figures may differ between
    // a household whose EPF is classed as cash and one whose identical money sits in a bank.
    const a = await newConsumer('liq_bounds_a');
    const b = await newConsumer('liq_bounds_b');
    await seedHousehold(a.token, a.householdId, { assetClass: 'cash' });
    await seedHousehold(b.token, b.householdId, { assetClass: 'cash' });

    const ia = await intelOf(a.token, a.householdId);
    const ib = await intelOf(b.token, b.householdId);

    // Two identical households agree on everything — determinism, and the baseline for below.
    expect(ia.netWorth).toEqual(ib.netWorth);
    expect(JSON.stringify(ia.assetAllocation)).toBe(JSON.stringify(ib.assetAllocation));

    // The EPF is still an asset, still cash-classed in the allocation, still in the corpus. The
    // rule narrows what counts as REACHABLE; it changes nothing about what the family owns.
    expect(ia.netWorth.data.assetsMinor).toBe(rupees(CASH + EPF));
    const classes = (ia.assetAllocation.data.current as { assetClass: string; baseValueMinor: number }[]);
    expect(classes.find((c) => c.assetClass === 'cash')!.baseValueMinor).toBe(rupees(CASH + EPF));
    expect(ia.retirementAccountsMinor).toBe(rupees(EPF));
  });

  it('5 — the stored snapshot is untouched: it records what the family owns, not what they can reach', async () => {
    // Reachability is derived at read time from an immutable payload. If this ever fails, the
    // rule has leaked into capture, and history has started changing meaning (ADR-004/012).
    const { token, householdId } = await newConsumer('liq_snap');
    const snap = await seedHousehold(token, householdId, { assetClass: 'cash' });

    const stored = await prisma.financialSnapshot.findUnique({ where: { id: snap.id } });
    expect(stored).not.toBeNull();
    expect(stored!.schemaVersion).toBe(1);

    const assets = (stored!.payload as unknown as {
      assets: { name: string; assetClass: string | null; accountType?: string }[];
      assetAllocation: { assetClass: string; baseValueMinor: number }[];
    });
    const epf = assets.assets.find((x) => x.name === 'EPF')!;
    // Both facts are captured, exactly as recorded. The kernel reads them together.
    expect(epf.assetClass).toBe('cash');
    expect(epf.accountType).toBe('retirement');
    expect(assets.assetAllocation.find((c) => c.assetClass === 'cash')!.baseValueMinor).toBe(
      rupees(CASH + EPF),
    );
  });

  // ---------------------------------------------------------------------------------------
  // The V1 retail path — the fourth reader, and the one that made this reachable by default.
  // ---------------------------------------------------------------------------------------

  it('6 — the retail path excludes it too, which is where a user could reach it by accident', async () => {
    // `AddAccount` on `/dashboard` offers `type: 'retirement'` and, until M5.19, defaulted the
    // asset class to `cash`. A user adding their EPF and not touching the dropdown produced
    // exactly this state without choosing anything. The retail composer feeds the V1 score and
    // the Wealth Coach's grounding context, so it had to learn the same rule.
    const { token } = await newConsumer('liq_retail');

    const profile = await http().put('/api/profile').set(auth(token)).send({
      annualIncomeMinor: rupees(MONTHLY_INCOME * 12),
      monthlyExpensesMinor: rupees(MONTHLY_EXPENSES),
      dependents: 1,
      hasTermCover: false,
      hasHealthInsurance: false,
      riskTolerance: 'moderate',
    });
    expect(profile.status).toBe(200);

    for (const a of [
      { name: 'Savings', type: 'bank', assetClass: 'cash', amount: CASH },
      { name: 'EPF', type: 'retirement', assetClass: 'cash', amount: EPF },
    ]) {
      const res = await http().post('/api/accounts').set(auth(token)).send({
        name: a.name,
        type: a.type,
        assetClass: a.assetClass,
        currency: 'INR',
        balanceMinor: rupees(a.amount),
        isLiability: false,
      });
      expect(res.status).toBe(201);
    }

    const ew = await http().get('/api/insights/early-warning').set(auth(token));
    expect(ew.status).toBe(200);
    const fund = (ew.body.signals as { key: string; detail: string }[]).find(
      (s) => s.key === 'emergency_fund',
    )!;
    expect(fund).toBeDefined();
    // 15,00,000 / 4,00,000 = 3.8 months. Before M5.19 this read 8.8, and the family was told a
    // shortfall they have is a buffer they do not.
    expect(fund.detail).toContain('3.8');
    expect(fund.detail).not.toContain('8.8');
  });
});
