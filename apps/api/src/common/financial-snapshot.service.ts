import { Injectable } from '@nestjs/common';
import {
  allocationFromValues,
  computeRetirement,
  planGoal,
  type Allocation,
  type AssetClass,
  type CurrencyCode,
  type EarlyWarningInput,
  type RiskTolerance,
  type ScoreInput,
} from '@lcos/core';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Assumptions used to derive a retirement gap when the user has not set explicit
 * retirement parameters. Conservative, India-typical defaults; kept here so the AI
 * coach and the scoring engine reason from the same numbers instead of guessing.
 */
const RETIREMENT_DEFAULTS = {
  retirementAge: 60,
  yearsInRetirement: 25,
  inflationRatePct: 6,
  preRetirementReturnPct: 11,
  postRetirementReturnPct: 7,
  /** Apply equity LTCG (12.5%) so the projected corpus/gap is post-tax, not gross. */
  effectiveGainsTaxPct: 12.5,
};

const DEFAULT_AGE = 35;

/** Asset classes that count as retirement/investment corpus for projections. */
const INVESTMENT_CLASSES: AssetClass[] = ['equity', 'debt'];

/**
 * One snapshot of a user's finances, assembled once from the database and shaped so
 * every consumer (Early Warning, Wealth Health scoring, the AI coach) reasons from
 * identical, real data. Previously this assembly lived inline in InsightsService and
 * was partly re-implemented — with hardcoded values — inside the AI service.
 */
export interface FinancialSnapshot {
  currency: CurrencyCode;
  age: number;
  dependents: number;
  riskTolerance: RiskTolerance;
  annualIncomeMinor: number;
  monthlyExpensesMinor: number;
  // Balance-sheet aggregates
  assetsMinor: number;
  liabilitiesMinor: number;
  netWorthMinor: number;
  liquidAssetsMinor: number;
  emergencyFundMinor: number;
  investmentAssetsMinor: number;
  allocationByClass: Allocation;
  allocationPct: Record<string, number>;
  // Debt
  monthlyDebtPaymentMinor: number;
  // Goals — how far behind each goal's funding schedule is, in [0,1]
  goalSlippage: number[];
  // Protection (single source of truth: Profile)
  hasTermCover: boolean;
  hasHealthInsurance: boolean;
  existingLifeCoverMinor: number;
  // Retirement (derived from profile + corpus, not hardcoded)
  retirementRequiredCorpusMinor: number;
  retirementCorpusGapMinor: number;
}

const monthsBetween = (from: Date, to: Date) =>
  Math.max(1, Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24 * 30.44)));

function ageFromDob(dob: Date | null | undefined): number {
  if (!dob) return DEFAULT_AGE;
  const ms = Date.now() - new Date(dob).getTime();
  const years = ms / (1000 * 60 * 60 * 24 * 365.25);
  return years > 0 && years < 120 ? Math.floor(years) : DEFAULT_AGE;
}

@Injectable()
export class FinancialSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  async assemble(userId: string): Promise<FinancialSnapshot> {
    const [profile, accounts, debts, goals] = await Promise.all([
      this.prisma.profile.findUnique({ where: { userId } }),
      this.prisma.account.findMany({ where: { userId } }),
      this.prisma.debt.findMany({ where: { userId } }),
      this.prisma.goal.findMany({ where: { userId } }),
    ]);

    const currency = (profile?.baseCurrency as CurrencyCode) ?? 'INR';

    // Allocation (by asset class) + asset/liability/liquid totals.
    const byClass: Allocation = {};
    let assets = 0;
    let liabilities = 0;
    let liquid = 0;
    let investments = 0;
    for (const a of accounts) {
      const bal = Number(a.balanceMinor);
      if (a.isLiability) {
        liabilities += bal;
        continue;
      }
      assets += bal;
      if (a.assetClass) byClass[a.assetClass as AssetClass] = (byClass[a.assetClass as AssetClass] ?? 0) + bal;
      if (a.assetClass === 'cash' || a.type === 'bank') liquid += bal;
      if (a.assetClass && INVESTMENT_CLASSES.includes(a.assetClass as AssetClass)) investments += bal;
    }
    const allocationPct = Object.keys(byClass).length ? allocationFromValues(byClass) : {};

    const monthlyExpenses = Number(profile?.monthlyExpensesMinor ?? 0);
    const annualIncome = Number(profile?.annualIncomeMinor ?? 0);
    const emergencyFund = accounts
      .filter((a) => !a.isLiability && a.assetClass === 'cash')
      .reduce((s, a) => s + Number(a.balanceMinor), 0);
    const monthlyDebtPayment = debts.reduce((s, d) => s + Number(d.minimumPaymentMinor), 0);

    // Goal slippage: shortfall as a fraction of target after projected growth.
    const now = new Date();
    const goalSlippage = goals.map((g) => {
      const months = monthsBetween(now, g.targetDate);
      const plan = planGoal({
        targetAmountMinor: Number(g.targetAmountMinor),
        currentAmountMinor: Number(g.currentAmountMinor),
        monthsRemaining: months,
        expectedAnnualReturnPct: g.expectedAnnualReturnPct,
        currency: g.currency as CurrencyCode,
      });
      return Number(g.targetAmountMinor) > 0 ? plan.gap.minor / Number(g.targetAmountMinor) : 0;
    });

    const age = ageFromDob(profile?.dateOfBirth);
    const existingLifeCover = Number(profile?.termLifeCoverMinor ?? 0);

    // Derive a retirement gap from real data instead of hardcoding zero. Uses the
    // user's age and current expenses; the investment corpus is the growth base.
    const retirement = computeRetirement({
      currentAge: age,
      retirementAge: Math.max(age + 1, RETIREMENT_DEFAULTS.retirementAge),
      yearsInRetirement: RETIREMENT_DEFAULTS.yearsInRetirement,
      currentAnnualExpensesMinor: monthlyExpenses * 12,
      currentCorpusMinor: investments,
      inflationRatePct: RETIREMENT_DEFAULTS.inflationRatePct,
      preRetirementReturnPct: RETIREMENT_DEFAULTS.preRetirementReturnPct,
      postRetirementReturnPct: RETIREMENT_DEFAULTS.postRetirementReturnPct,
      effectiveGainsTaxPct: RETIREMENT_DEFAULTS.effectiveGainsTaxPct,
      currency,
    });

    return {
      currency,
      age,
      dependents: profile?.dependents ?? 0,
      riskTolerance: (profile?.riskTolerance as RiskTolerance) ?? 'moderate',
      annualIncomeMinor: annualIncome,
      monthlyExpensesMinor: monthlyExpenses,
      assetsMinor: assets,
      liabilitiesMinor: liabilities,
      netWorthMinor: assets - liabilities,
      liquidAssetsMinor: liquid,
      emergencyFundMinor: emergencyFund,
      investmentAssetsMinor: investments,
      allocationByClass: byClass,
      allocationPct,
      monthlyDebtPaymentMinor: monthlyDebtPayment,
      goalSlippage,
      hasTermCover: profile?.hasTermCover ?? false,
      hasHealthInsurance: profile?.hasHealthInsurance ?? false,
      existingLifeCoverMinor: existingLifeCover,
      retirementRequiredCorpusMinor: retirement.requiredCorpus.minor,
      retirementCorpusGapMinor: retirement.corpusGap.minor,
    };
  }

  /** Map a snapshot to the Early Warning engine's input shape. */
  static toEarlyWarningInput(s: FinancialSnapshot): EarlyWarningInput {
    return {
      allocationPct: s.allocationPct,
      monthlyExpensesMinor: s.monthlyExpensesMinor,
      emergencyFundMinor: s.emergencyFundMinor,
      liquidAssetsMinor: s.liquidAssetsMinor,
      totalAssetsMinor: s.assetsMinor,
      totalLiabilitiesMinor: s.liabilitiesMinor,
      annualIncomeMinor: s.annualIncomeMinor,
      monthlyDebtPaymentMinor: s.monthlyDebtPaymentMinor,
      hasTermCover: s.hasTermCover,
      hasHealthInsurance: s.hasHealthInsurance,
      dependents: s.dependents,
      goalSlippage: s.goalSlippage,
    };
  }

  /** Map a snapshot to the Wealth Health scoring engine's input shape. */
  static toScoreInput(s: FinancialSnapshot): ScoreInput {
    return {
      monthlyExpensesMinor: s.monthlyExpensesMinor,
      emergencyFundMinor: s.emergencyFundMinor,
      annualIncomeMinor: s.annualIncomeMinor,
      existingLifeCoverMinor: s.existingLifeCoverMinor,
      hasHealthInsurance: s.hasHealthInsurance,
      investmentAssetsMinor: s.investmentAssetsMinor,
      totalAssetsMinor: s.assetsMinor,
      totalLiabilitiesMinor: s.liabilitiesMinor,
      retirementCorpusGapMinor: s.retirementCorpusGapMinor,
      retirementRequiredCorpusMinor: s.retirementRequiredCorpusMinor,
      age: s.age,
    };
  }
}
