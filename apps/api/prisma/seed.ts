import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { createCipheriv, randomBytes } from 'crypto';

const prisma = new PrismaClient();

// Mirror CryptoService.encrypt so seeded PII matches the runtime format.
function encrypt(plain: string): string {
  const key = Buffer.from(
    process.env.FIELD_ENCRYPTION_KEY ??
      '0000000000000000000000000000000000000000000000000000000000000000',
    'hex',
  );
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ct.toString('hex')}`;
}

async function main(): Promise<void> {
  // Plans (the monetization backbone).
  const plans = [
    {
      tier: 'free' as const,
      name: 'Free',
      priceMinor: 0n,
      features: ['wealth_health_check', 'family_balance_sheet', 'asset_allocation', 'retirement_calculator', 'goal_planning', 'debt_payoff_basic'],
    },
    {
      tier: 'premium' as const,
      name: 'Premium',
      priceMinor: 49900n, // ₹499/mo
      features: ['ai_recommendations', 'scenario_simulator', 'advanced_analytics', 'account_aggregation', 'knowledge_vault'],
    },
    {
      tier: 'family_cfo' as const,
      name: 'Family CFO',
      priceMinor: 199900n, // ₹1,999/mo
      features: ['advisor_consultation', 'family_members_unlimited'],
    },
  ];
  for (const p of plans) {
    await prisma.plan.upsert({
      where: { tier: p.tier },
      create: { ...p, currency: 'INR', interval: 'month' },
      update: { name: p.name, priceMinor: p.priceMinor, features: p.features },
    });
  }

  // Feature flags for monetization modules — off by default, enabled tastefully.
  const flags = [
    { key: 'marketplace.enabled', enabled: false, description: 'Advisor marketplace' },
    { key: 'affiliate.enabled', enabled: false, description: 'Affiliate / referral products' },
    { key: 'whitelabel.enabled', enabled: false, description: 'B2B white-label tenants' },
    { key: 'gamification.enabled', enabled: true, description: 'Streaks, badges, challenges' },
    { key: 'aa.enabled', enabled: false, description: 'Account Aggregator auto-linking' },
  ];
  for (const f of flags) {
    await prisma.featureFlag.upsert({ where: { key: f.key }, create: f, update: {} });
  }

  // Super admin (credentials are dev-only; rotate in production).
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@lifecapitalos.dev';
  const adminPass = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345';
  await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      passwordHash: await argon2.hash(adminPass),
      role: 'SUPERADMIN',
      emailVerified: true,
      profile: { create: { fullName: encrypt('Platform Admin') } },
    },
    update: { role: 'SUPERADMIN' },
  });

  // Demo user with a small balance sheet.
  const demoEmail = 'demo@lifecapitalos.dev';
  const demo = await prisma.user.upsert({
    where: { email: demoEmail },
    create: {
      email: demoEmail,
      passwordHash: await argon2.hash('Demo@12345'),
      emailVerified: true,
      profile: {
        create: {
          fullName: encrypt('Demo User'),
          baseCurrency: 'INR',
          annualIncomeMinor: 200000000n,
          monthlyExpensesMinor: 5000000n,
          riskTolerance: 'moderate',
          dependents: 2,
        },
      },
    },
    update: {},
  });

  const existingAccounts = await prisma.account.count({ where: { userId: demo.id } });
  if (existingAccounts === 0) {
    await prisma.account.createMany({
      data: [
        { userId: demo.id, name: 'Savings Account', type: 'bank', assetClass: 'cash', balanceMinor: 80000000n },
        { userId: demo.id, name: 'Equity MF', type: 'investment', assetClass: 'equity', balanceMinor: 150000000n },
        { userId: demo.id, name: 'Apartment', type: 'real_estate', assetClass: 'real_estate', balanceMinor: 800000000n },
        { userId: demo.id, name: 'Home Loan', type: 'loan', balanceMinor: 350000000n, isLiability: true },
      ],
    });
  }

  // eslint-disable-next-line no-console
  console.log('Seed complete. Admin:', adminEmail, '/ Demo:', demoEmail);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
