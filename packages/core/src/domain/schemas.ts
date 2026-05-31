import { z } from 'zod';

/**
 * Canonical domain schemas shared across API, web and mobile. These mirror the
 * persistence model (Prisma) but are transport/validation-focused and contain no
 * server-only fields. Keep these the single source of truth for shapes.
 */

export const currencyCodeSchema = z.enum(['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD']);

export const riskToleranceSchema = z.enum(['conservative', 'moderate', 'aggressive']);

export const assetClassSchema = z.enum([
  'equity',
  'debt',
  'gold',
  'real_estate',
  'cash',
  'crypto',
  'business',
  'other',
]);

export const accountTypeSchema = z.enum([
  'bank',
  'investment',
  'retirement',
  'real_estate',
  'vehicle',
  'cash',
  'other_asset',
  'loan',
  'credit_card',
]);

export const transactionTypeSchema = z.enum(['income', 'expense', 'transfer']);

export const debtTypeSchema = z.enum([
  'home_loan',
  'personal_loan',
  'vehicle_loan',
  'education_loan',
  'credit_card',
  'other',
]);

export const goalTypeSchema = z.enum([
  'retirement',
  'child_education',
  'child_marriage',
  'home_purchase',
  'emergency_fund',
  'travel',
  'custom',
]);

export const moneyInputSchema = z.object({
  minor: z.number().int(),
  currency: currencyCodeSchema,
});

export const profileSchema = z.object({
  fullName: z.string().min(1).max(120),
  dateOfBirth: z.coerce.date().optional(),
  baseCurrency: currencyCodeSchema.default('INR'),
  annualIncomeMinor: z.number().int().nonnegative().optional(),
  monthlyExpensesMinor: z.number().int().nonnegative().optional(),
  riskTolerance: riskToleranceSchema.default('moderate'),
  dependents: z.number().int().nonnegative().default(0),
  taxResidency: z.string().length(2).default('IN'),
});
export type ProfileInput = z.infer<typeof profileSchema>;

export const accountSchema = z.object({
  name: z.string().min(1).max(120),
  type: accountTypeSchema,
  assetClass: assetClassSchema.optional(),
  currency: currencyCodeSchema,
  balanceMinor: z.number().int(),
  isLiability: z.boolean().default(false),
});
export type AccountInput = z.infer<typeof accountSchema>;

export const transactionSchema = z.object({
  accountId: z.string().min(1),
  type: transactionTypeSchema,
  amountMinor: z.number().int().positive(),
  currency: currencyCodeSchema,
  category: z.string().min(1).max(60),
  note: z.string().max(280).optional(),
  occurredAt: z.coerce.date(),
});
export type TransactionInput = z.infer<typeof transactionSchema>;

export const debtSchema = z.object({
  name: z.string().min(1).max(120),
  type: debtTypeSchema,
  currency: currencyCodeSchema,
  principalMinor: z.number().int().positive(),
  annualInterestRatePct: z.number().min(0).max(100),
  minimumPaymentMinor: z.number().int().nonnegative(),
});
export type DebtFormInput = z.infer<typeof debtSchema>;

export const goalSchema = z.object({
  name: z.string().min(1).max(120),
  type: goalTypeSchema,
  currency: currencyCodeSchema,
  targetAmountMinor: z.number().int().positive(),
  currentAmountMinor: z.number().int().nonnegative().default(0),
  targetDate: z.coerce.date(),
  expectedAnnualReturnPct: z.number().min(0).max(50).default(10),
});
export type GoalFormInput = z.infer<typeof goalSchema>;
