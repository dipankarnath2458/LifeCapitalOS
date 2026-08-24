import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Goal, GoalType } from '@prisma/client';
import { planGoalAsOf, type CurrencyCode } from '@lcos/core';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/decorators';
import { FirmContext } from '../firms/firm-context.decorators';
import { CreateHouseholdGoalDto, UpdateHouseholdGoalDto } from './household-goals.dto';

/**
 * Household goals (M5.8 PR 2).
 *
 * See `docs/M5_8_GOALS_CHARTS_ARCHITECTURE.md`.
 *
 * ## Why there is no schema change
 *
 * `Goal` already carries `firmId`, `householdId` and `memberId` as nullable, indexed columns from
 * M1b's advisory scoping. Only the API to reach them was missing: goals have been available solely
 * through the retail `/goals` module, keyed on `userId`.
 *
 * ## `Goal.userId` is NOT NULL, and that is a boundary
 *
 * Unlike `Account`, `Transaction` and `Debt`, `Goal.userId` was never relaxed — every goal must
 * name a user. For a consumer that is unambiguous: the user is themselves and the household is
 * theirs.
 *
 * For an advisor creating a goal on a client's household it would be actively wrong. `userId`
 * would name the **advisor**, and the goal would surface in the advisor's own retail goal list —
 * their client's money filed under their name. That is the confusion that put advisors inside
 * client households in #52 and #54, and it is why this service refuses rather than guesses.
 *
 * Supporting advisor-created goals properly means relaxing `Goal.userId` to nullable, which is a
 * schema change and a separate decision.
 *
 * ## What goals do — and still do not — move (M5.11)
 *
 * A goal now reaches the Financial Intelligence Layer as a **module-owned assumption**, the same
 * route Protection (M5.9) and Retirement (M5.10) take, and produces a Goal Progress signal in the
 * early-warning report. `assumptionsFor` below is the whole of that seam.
 *
 * The Financial Snapshot still has no goals section, and the Wealth Health Score still does not
 * count goals. Both are deliberate: the snapshot payload is frozen at `schemaVersion 1`, and
 * changing what "health" means re-bands every score already shown to a family — a decision of
 * its own, not a side effect of this one.
 */
@Injectable()
export class HouseholdGoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Where a goal stands right now. One call into the core planner — the same one the retail
   * list and the early-warning input use — so the figure a family reads on the goals page is
   * arithmetically the figure that raises their risk signal. No arithmetic here, and none in
   * the page that renders it.
   */
  private planOf(g: Goal, now: Date) {
    return planGoalAsOf(
      {
        targetAmountMinor: Number(g.targetAmountMinor),
        currentAmountMinor: Number(g.currentAmountMinor),
        targetDate: g.targetDate,
        expectedAnnualReturnPct: g.expectedAnnualReturnPct,
        currency: g.currency as CurrencyCode,
      },
      now,
    );
  }

  private serialize(g: Goal, now = new Date()) {
    const { plan, monthsRemaining, slippage } = this.planOf(g, now);
    return {
      id: g.id,
      householdId: g.householdId,
      name: g.name,
      type: g.type,
      currency: g.currency,
      targetAmountMinor: Number(g.targetAmountMinor),
      currentAmountMinor: Number(g.currentAmountMinor),
      targetDate: g.targetDate,
      expectedAnnualReturnPct: g.expectedAnnualReturnPct,
      /**
       * Additive (M5.11), and shaped like the retail `/goals` list so the two generations
       * describe a goal the same way. Existing fields are untouched.
       */
      plan: {
        monthsRemaining,
        projectedCurrentMinor: plan.projectedCurrentMinor.minor,
        gapMinor: plan.gap.minor,
        monthlySipRequiredMinor: plan.monthlySipRequired.minor,
        progress: plan.progress,
        /** Unfunded fraction of the target in [0,1] — what the warning engine bands. */
        slippage,
      },
    };
  }

  /**
   * The acting user must be a member of this household **as themselves** before a goal can be
   * filed under their name. `HouseholdMember.userId` is the same signal post-login routing uses:
   * it means *this money is mine, not my client's*.
   */
  private async assertOwnHousehold(actor: AuthUser, householdId: string) {
    const member = await this.prisma.householdMember.findFirst({
      where: { householdId, userId: actor.id },
    });
    if (!member) {
      throw new ForbiddenException(
        'Goals can only be created by a member of this household. Advisor-created goals are not supported yet.',
      );
    }
  }

  private async owned(householdId: string, goalId: string) {
    const goal = await this.prisma.goal.findUnique({ where: { id: goalId } });
    if (!goal || goal.householdId !== householdId) {
      throw new NotFoundException('Goal not found');
    }
    return goal;
  }

  async list(householdId: string) {
    const rows = await this.prisma.goal.findMany({
      where: { householdId },
      orderBy: { targetDate: 'asc' },
    });
    // One clock for the whole list: two goals read in the same request must be measured from
    // the same instant, or an identical pair could report different horizons.
    const now = new Date();
    return rows.map((g) => this.serialize(g, now));
  }

  /**
   * Goals as a module-owned input to the Financial Intelligence Layer (M5.11).
   *
   * The layer is given slippage per goal — not the goals themselves — because that is the only
   * thing the early-warning engine consumes, and a family's goal names have no business in an
   * AI-grounding payload.
   *
   * Returns `undefined` when this household has no goals, which the layer passes on as "not
   * asked" and the engine renders as *"Add goals to track progress"*. An empty array would be a
   * different claim — "we looked, and you have none to be behind on" — and reads identically to
   * a family with three goals they are on track for. Callers must not substitute one for the
   * other; this is the same distinction M5.9 drew for insurance, where `false` and `null` were
   * conflated and the product asserted an absence it had never been told.
   */
  async assumptionsFor(householdId: string): Promise<{ slippage: number[] } | undefined> {
    const rows = await this.prisma.goal.findMany({
      where: { householdId },
      select: {
        targetAmountMinor: true,
        currentAmountMinor: true,
        targetDate: true,
        expectedAnnualReturnPct: true,
        currency: true,
      },
    });
    if (rows.length === 0) return undefined;

    const now = new Date();
    return {
      slippage: rows.map(
        (g) =>
          planGoalAsOf(
            {
              targetAmountMinor: Number(g.targetAmountMinor),
              currentAmountMinor: Number(g.currentAmountMinor),
              targetDate: g.targetDate,
              expectedAnnualReturnPct: g.expectedAnnualReturnPct,
              currency: g.currency as CurrencyCode,
            },
            now,
          ).slippage,
      ),
    };
  }

  async create(
    actor: AuthUser,
    firm: FirmContext,
    householdId: string,
    dto: CreateHouseholdGoalDto,
    ip?: string,
  ) {
    await this.assertOwnHousehold(actor, householdId);

    const goal = await this.prisma.goal.create({
      data: {
        // Household-scoped AND user-owned. `userId` is required by the model; `householdId` and
        // `firmId` are what make the goal the family's rather than only this person's.
        userId: actor.id,
        householdId,
        firmId: firm.firmId,
        name: dto.name,
        type: dto.type as GoalType,
        currency: dto.currency ?? 'INR',
        targetAmountMinor: BigInt(dto.targetAmountMinor),
        currentAmountMinor: BigInt(dto.currentAmountMinor ?? 0),
        targetDate: new Date(dto.targetDate),
        ...(dto.expectedAnnualReturnPct !== undefined
          ? { expectedAnnualReturnPct: dto.expectedAnnualReturnPct }
          : {}),
      },
    });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'household.goal.create',
      entityType: 'Goal',
      entityId: goal.id,
      metadata: { firmId: firm.firmId, householdId },
      ip,
    });
    return this.serialize(goal);
  }

  async update(
    actor: AuthUser,
    firm: FirmContext,
    householdId: string,
    goalId: string,
    dto: UpdateHouseholdGoalDto,
    ip?: string,
  ) {
    await this.owned(householdId, goalId);
    const goal = await this.prisma.goal.update({
      where: { id: goalId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.type !== undefined ? { type: dto.type as GoalType } : {}),
        ...(dto.targetAmountMinor !== undefined
          ? { targetAmountMinor: BigInt(dto.targetAmountMinor) }
          : {}),
        ...(dto.currentAmountMinor !== undefined
          ? { currentAmountMinor: BigInt(dto.currentAmountMinor) }
          : {}),
        ...(dto.targetDate !== undefined ? { targetDate: new Date(dto.targetDate) } : {}),
        ...(dto.expectedAnnualReturnPct !== undefined
          ? { expectedAnnualReturnPct: dto.expectedAnnualReturnPct }
          : {}),
      },
    });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'household.goal.update',
      entityType: 'Goal',
      entityId: goalId,
      metadata: { firmId: firm.firmId, householdId, fields: Object.keys(dto) },
      ip,
    });
    return this.serialize(goal);
  }

  async remove(actor: AuthUser, firm: FirmContext, householdId: string, goalId: string, ip?: string) {
    await this.owned(householdId, goalId);
    await this.prisma.goal.delete({ where: { id: goalId } });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'household.goal.delete',
      entityType: 'Goal',
      entityId: goalId,
      metadata: { firmId: firm.firmId, householdId },
      ip,
    });
    return { ok: true };
  }
}
