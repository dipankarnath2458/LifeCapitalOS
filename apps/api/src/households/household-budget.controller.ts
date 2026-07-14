import { Body, Controller, Get, Ip, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FirmRole, Household } from '@prisma/client';
import { HouseholdBudgetService } from './household-budget.service';
import { AuthUser, CurrentUser } from '../common/decorators';
import { CurrentFirm, FirmContext, FirmRoles } from '../firms/firm-context.decorators';
import { HouseholdScopeGuard } from './household-scope.guard';
import { CurrentHousehold } from './household.decorators';
import { BudgetQueryDto, UpsertBudgetDto } from './household-budget.dto';

/**
 * Household monthly budget (M2-4). Category envelopes are stored; actual spend is
 * computed live from the cashflow ledger (budget vs actual). Household-scoped by
 * HouseholdScopeGuard; writes limited to the household's data-entry roles.
 */
@ApiTags('households')
@Controller('households/:id/budget')
@UseGuards(HouseholdScopeGuard)
export class HouseholdBudgetController {
  constructor(private readonly budget: HouseholdBudgetService) {}

  @Get()
  get(@CurrentHousehold() household: Household, @Query() q: BudgetQueryDto) {
    return this.budget.getForMonth(household.id, household.baseCurrency, q.month);
  }

  @Post()
  @FirmRoles(FirmRole.OWNER, FirmRole.ADVISOR, FirmRole.SUPPORT)
  upsert(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @CurrentHousehold() household: Household,
    @Body() dto: UpsertBudgetDto,
    @Ip() ip: string,
  ) {
    return this.budget.upsert(actor, firm, household.id, household.baseCurrency, dto, ip);
  }
}
