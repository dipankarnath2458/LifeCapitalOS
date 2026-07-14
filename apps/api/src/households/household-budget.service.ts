import { Injectable } from '@nestjs/common';
import { evaluateBudget, type BudgetEnvelope } from '@lcos/core';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/decorators';
import { FirmContext } from '../firms/firm-context.decorators';
import { HouseholdCashflowService } from './household-cashflow.service';
import { UpsertBudgetDto } from './household-budget.dto';

/** Current month as `YYYY-MM` (UTC). */
function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Household monthly budget engine (M2-4). Stores category envelopes; actual spend is
 * always computed live from the cashflow ledger via {@link HouseholdCashflowService}
 * (no duplicated aggregation). Budget-vs-actual math is the pure `@lcos/core`
 * `evaluateBudget`.
 */
@Injectable()
export class HouseholdBudgetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cashflow: HouseholdCashflowService,
    private readonly audit: AuditService,
  ) {}

  /** Upsert the month's budget and replace its category envelopes atomically. */
  async upsert(
    actor: AuthUser,
    firm: FirmContext,
    householdId: string,
    baseCurrency: string,
    dto: UpsertBudgetDto,
    ip?: string,
  ) {
    const budget = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.budget.findUnique({
        where: { householdId_periodMonth: { householdId, periodMonth: dto.periodMonth } },
      });
      const b = await tx.budget.upsert({
        where: { householdId_periodMonth: { householdId, periodMonth: dto.periodMonth } },
        create: {
          householdId,
          firmId: firm.firmId,
          periodMonth: dto.periodMonth,
          currency: baseCurrency,
          totalAmountMinor:
            dto.totalAmountMinor !== undefined ? BigInt(dto.totalAmountMinor) : null,
          createdById: actor.id,
          updatedById: actor.id,
        },
        update: {
          currency: baseCurrency,
          totalAmountMinor:
            dto.totalAmountMinor !== undefined ? BigInt(dto.totalAmountMinor) : null,
          updatedById: actor.id,
        },
      });
      // Replace the envelope set (simple, deterministic — the client sends the full set).
      if (existing) {
        await tx.budgetLine.deleteMany({ where: { budgetId: b.id } });
      }
      if (dto.lines.length > 0) {
        await tx.budgetLine.createMany({
          data: dto.lines.map((l) => ({
            budgetId: b.id,
            category: l.category,
            amountMinor: BigInt(l.amountMinor),
          })),
        });
      }
      return b;
    });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'household.budget.upsert',
      entityType: 'Budget',
      entityId: budget.id,
      metadata: { firmId: firm.firmId, householdId, periodMonth: dto.periodMonth },
      ip,
    });
    return this.getForMonth(householdId, baseCurrency, dto.periodMonth);
  }

  /**
   * Budget vs actual for a month. Reads the stored envelopes, pulls actual per-category
   * expense from the ledger (base currency), and runs `evaluateBudget`. Returns the
   * overall cap comparison too.
   */
  async getForMonth(householdId: string, baseCurrency: string, month?: string) {
    const periodMonth = month ?? currentMonth();
    const budget = await this.prisma.budget.findUnique({
      where: { householdId_periodMonth: { householdId, periodMonth } },
      include: { lines: true },
    });
    const actuals = await this.cashflow.actualsByCategory(householdId, baseCurrency, periodMonth);

    const envelopes: BudgetEnvelope[] = (budget?.lines ?? []).map((l) => ({
      category: l.category,
      limitMinor: Number(l.amountMinor),
      spentMinor: actuals.get(l.category) ?? 0,
    }));
    const lines = evaluateBudget(envelopes);

    const budgetedCategories = new Set(envelopes.map((e) => e.category));
    const uncategorized = [...actuals.entries()]
      .filter(([category]) => !budgetedCategories.has(category))
      .map(([category, spentMinor]) => ({ category, spentMinor }));

    const totalSpentMinor = [...actuals.values()].reduce((a, b) => a + b, 0);
    const totalBudgetMinor = budget?.totalAmountMinor != null ? Number(budget.totalAmountMinor) : null;

    return {
      periodMonth,
      currency: baseCurrency,
      exists: budget != null,
      totalBudgetMinor,
      totalSpentMinor,
      totalRemainingMinor: totalBudgetMinor != null ? totalBudgetMinor - totalSpentMinor : null,
      overTotal: totalBudgetMinor != null ? totalSpentMinor > totalBudgetMinor : false,
      lines,
      uncategorized,
    };
  }
}
