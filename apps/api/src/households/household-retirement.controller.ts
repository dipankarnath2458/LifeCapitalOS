import { Body, Controller, Get, Ip, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FirmRole, Household } from '@prisma/client';
import { HouseholdRetirementService } from './household-retirement.service';
import { AuthUser, CurrentUser } from '../common/decorators';
import { CurrentFirm, FirmContext, FirmRoles } from '../firms/firm-context.decorators';
import { HouseholdScopeGuard } from './household-scope.guard';
import { CurrentHousehold } from './household.decorators';
import { RetirementWhatIfDto, UpdateRetirementPlanDto } from './household-retirement.dto';

/**
 * Retirement Planning (M5.10) — see `docs/M5_10_RETIREMENT_PLANNING_ARCHITECTURE.md`.
 *
 * Household-scoped by `HouseholdScopeGuard` (404-not-403), like every sibling route. Additive:
 * no existing route, response shape or query parameter changes.
 *
 * `PUT` because a household has exactly one plan — there is no create/delete lifecycle to model.
 * The what-if `POST` carries a scenario body and **persists nothing**; it is not a write, which
 * is why it is available to any in-scope member, matching the existing simulation controller.
 */
@ApiTags('households')
@Controller('households/:id/retirement')
@UseGuards(HouseholdScopeGuard)
export class HouseholdRetirementController {
  constructor(private readonly retirement: HouseholdRetirementService) {}

  @Get()
  overview(@CurrentHousehold() household: Household) {
    return this.retirement.overview(household);
  }

  @Put()
  @FirmRoles(FirmRole.OWNER, FirmRole.ADVISOR, FirmRole.SUPPORT)
  upsert(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @Param('id') householdId: string,
    @Body() dto: UpdateRetirementPlanDto,
    @Ip() ip: string,
  ) {
    return this.retirement.upsert(actor, firm, householdId, dto, ip);
  }

  @Post('what-if')
  whatIf(@CurrentHousehold() household: Household, @Body() dto: RetirementWhatIfDto) {
    return this.retirement.whatIf(household, dto);
  }
}
