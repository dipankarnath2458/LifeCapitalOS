import { Controller, Get, Ip, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FirmRole, Household } from '@prisma/client';
import { HouseholdNetWorthService } from './household-networth.service';
import { AuthUser, CurrentUser } from '../common/decorators';
import { CurrentFirm, FirmContext, FirmRoles } from '../firms/firm-context.decorators';
import { HouseholdScopeGuard } from './household-scope.guard';
import { CurrentHousehold } from './household.decorators';

/**
 * Household net worth & snapshots (MOD-4.2). Live figures are computed multi-currency
 * from the household's accounts; snapshots are immutable (create-only) and form the
 * timeline. Every route is household-scoped by HouseholdScopeGuard.
 */
@ApiTags('households')
@Controller('households/:id/net-worth')
@UseGuards(HouseholdScopeGuard)
export class HouseholdNetWorthController {
  constructor(private readonly netWorth: HouseholdNetWorthService) {}

  @Get('current')
  current(@CurrentHousehold() household: Household) {
    return this.netWorth.current(household.id, household.baseCurrency);
  }

  @Post('snapshot')
  @FirmRoles(FirmRole.OWNER, FirmRole.ADVISOR, FirmRole.SUPPORT)
  snapshot(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @CurrentHousehold() household: Household,
    @Ip() ip: string,
  ) {
    return this.netWorth.snapshot(actor, firm, household.id, household.baseCurrency, ip);
  }

  @Get('timeline')
  timeline(@Param('id') householdId: string) {
    return this.netWorth.timeline(householdId);
  }
}
