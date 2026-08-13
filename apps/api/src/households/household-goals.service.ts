import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Goal, GoalType } from '@prisma/client';
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
 * ## What goals do NOT do
 *
 * They move no figure. The Financial Snapshot has no goals section, so a goal changes nothing in
 * the dashboard, the health score or the AI grounding. See §3 of the architecture note for what
 * closing that gap would cost and why it is deliberately still open.
 */
@Injectable()
export class HouseholdGoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private serialize(g: Goal) {
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
    return rows.map((g) => this.serialize(g));
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
