import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  allocationFromValues,
  computeEarlyWarning,
  planGoal,
  type Allocation,
  type AssetClass,
  type CurrencyCode,
} from '@lcos/core';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser } from '../common/decorators';

const monthsBetween = (from: Date, to: Date) =>
  Math.max(1, Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24 * 30.44)));

@Injectable()
class InsightsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Assemble the Wealth Early Warning report from the user's real data. */
  async earlyWarning(userId: string) {
    const [profile, accounts, debts, goals] = await Promise.all([
      this.prisma.profile.findUnique({ where: { userId } }),
      this.prisma.account.findMany({ where: { userId } }),
      this.prisma.debt.findMany({ where: { userId } }),
      this.prisma.goal.findMany({ where: { userId } }),
    ]);

    // Allocation (by asset class) + asset/liability totals.
    const byClass: Allocation = {};
    let assets = 0;
    let liabilities = 0;
    let liquid = 0;
    for (const a of accounts) {
      const bal = Number(a.balanceMinor);
      if (a.isLiability) {
        liabilities += bal;
        continue;
      }
      assets += bal;
      if (a.assetClass) byClass[a.assetClass as AssetClass] = (byClass[a.assetClass as AssetClass] ?? 0) + bal;
      if (a.assetClass === 'cash' || a.type === 'bank') liquid += bal;
    }
    const allocationPct = Object.keys(byClass).length ? allocationFromValues(byClass) : {};

    const monthlyExpenses = Number(profile?.monthlyExpensesMinor ?? 0);
    const annualIncome = Number(profile?.annualIncomeMinor ?? 0);
    const emergencyFund = accounts
      .filter((a) => !a.isLiability && a.assetClass === 'cash')
      .reduce((s, a) => s + Number(a.balanceMinor), 0);
    const monthlyDebtPayment = debts.reduce((s, d) => s + Number(d.minimumPaymentMinor), 0);

    // Goal slippage: how far each goal is behind a straight-line funding schedule.
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
      // Slippage ≈ shortfall as a fraction of target after projected growth.
      return Number(g.targetAmountMinor) > 0 ? plan.gap.minor / Number(g.targetAmountMinor) : 0;
    });

    // Insurance is not yet tracked as structured data; pass neutral flags so the
    // signal stays informational rather than falsely red. (See profile insurance
    // tracking — planned follow-up.)
    const report = computeEarlyWarning({
      allocationPct,
      monthlyExpensesMinor: monthlyExpenses,
      emergencyFundMinor: emergencyFund,
      liquidAssetsMinor: liquid,
      totalAssetsMinor: assets,
      totalLiabilitiesMinor: liabilities,
      annualIncomeMinor: annualIncome,
      monthlyDebtPaymentMinor: monthlyDebtPayment,
      hasTermCover: true,
      hasHealthInsurance: true,
      dependents: profile?.dependents ?? 0,
      goalSlippage,
    });

    return report;
  }
}

@ApiTags('insights')
@Controller('insights')
class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get('early-warning')
  earlyWarning(@CurrentUser() user: AuthUser) {
    return this.insights.earlyWarning(user.id);
  }
}

@Module({
  controllers: [InsightsController],
  providers: [InsightsService],
})
export class InsightsModule {}
