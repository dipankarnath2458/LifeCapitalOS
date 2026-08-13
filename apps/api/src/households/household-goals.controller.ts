import { Body, Controller, Delete, Get, Ip, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FirmRole } from '@prisma/client';
import { HouseholdGoalsService } from './household-goals.service';
import { AuthUser, CurrentUser } from '../common/decorators';
import { CurrentFirm, FirmContext, FirmRoles } from '../firms/firm-context.decorators';
import { HouseholdScopeGuard } from './household-scope.guard';
import { CreateHouseholdGoalDto, UpdateHouseholdGoalDto } from './household-goals.dto';

/**
 * Household goals (M5.8 PR 2) — the family's goals, alongside everything else they own.
 *
 * See `docs/M5_8_GOALS_CHARTS_ARCHITECTURE.md`.
 *
 * Household-scoped by `HouseholdScopeGuard` (404-not-403) and limited to the household's
 * data-entry roles, like every sibling route. No schema change: `Goal` already carries
 * `householdId`, `firmId` and `memberId` from M1b.
 *
 * The retail `/goals` module is untouched and still serves `/dashboard`.
 */
@ApiTags('households')
@Controller('households/:id/goals')
@UseGuards(HouseholdScopeGuard)
export class HouseholdGoalsController {
  constructor(private readonly goals: HouseholdGoalsService) {}

  @Get()
  list(@Param('id') householdId: string) {
    return this.goals.list(householdId);
  }

  @Post()
  @FirmRoles(FirmRole.OWNER, FirmRole.ADVISOR, FirmRole.SUPPORT)
  create(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @Param('id') householdId: string,
    @Body() dto: CreateHouseholdGoalDto,
    @Ip() ip: string,
  ) {
    return this.goals.create(actor, firm, householdId, dto, ip);
  }

  @Patch(':goalId')
  @FirmRoles(FirmRole.OWNER, FirmRole.ADVISOR, FirmRole.SUPPORT)
  update(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @Param('id') householdId: string,
    @Param('goalId') goalId: string,
    @Body() dto: UpdateHouseholdGoalDto,
    @Ip() ip: string,
  ) {
    return this.goals.update(actor, firm, householdId, goalId, dto, ip);
  }

  @Delete(':goalId')
  @FirmRoles(FirmRole.OWNER, FirmRole.ADVISOR, FirmRole.SUPPORT)
  remove(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @Param('id') householdId: string,
    @Param('goalId') goalId: string,
    @Ip() ip: string,
  ) {
    return this.goals.remove(actor, firm, householdId, goalId, ip);
  }
}
