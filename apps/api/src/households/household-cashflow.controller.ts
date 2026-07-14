import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FirmRole, Household } from '@prisma/client';
import { HouseholdCashflowService } from './household-cashflow.service';
import { AuthUser, CurrentUser } from '../common/decorators';
import { CurrentFirm, FirmContext, FirmRoles } from '../firms/firm-context.decorators';
import { HouseholdScopeGuard } from './household-scope.guard';
import { CurrentHousehold } from './household.decorators';
import {
  CashflowQueryDto,
  CreateHouseholdTransactionDto,
  UpdateHouseholdTransactionDto,
} from './household-cashflow.dto';

/**
 * Household cashflow ledger (M2-4) — the single source of truth for household
 * financial activity. Transactions are stored in their native currency and
 * FX-converted to the household base at aggregation. Every route is household-scoped
 * by HouseholdScopeGuard; writes are limited to the household's data-entry roles.
 */
@ApiTags('households')
@Controller('households/:id/cashflow')
@UseGuards(HouseholdScopeGuard)
export class HouseholdCashflowController {
  constructor(private readonly cashflow: HouseholdCashflowService) {}

  @Get()
  list(@Param('id') householdId: string, @Query() q: CashflowQueryDto) {
    return this.cashflow.list(householdId, q.month);
  }

  @Get('summary')
  summary(@CurrentHousehold() household: Household, @Query() q: CashflowQueryDto) {
    return this.cashflow.summary(household.id, household.baseCurrency, q.month);
  }

  @Get('timeline')
  timeline(@CurrentHousehold() household: Household) {
    return this.cashflow.timeline(household.id, household.baseCurrency);
  }

  @Post()
  @FirmRoles(FirmRole.OWNER, FirmRole.ADVISOR, FirmRole.SUPPORT)
  create(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @CurrentHousehold() household: Household,
    @Body() dto: CreateHouseholdTransactionDto,
    @Ip() ip: string,
  ) {
    return this.cashflow.create(actor, firm, household.id, household.baseCurrency, dto, ip);
  }

  @Patch(':txId')
  @FirmRoles(FirmRole.OWNER, FirmRole.ADVISOR, FirmRole.SUPPORT)
  update(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @Param('id') householdId: string,
    @Param('txId') txId: string,
    @Body() dto: UpdateHouseholdTransactionDto,
    @Ip() ip: string,
  ) {
    return this.cashflow.update(actor, firm, householdId, txId, dto, ip);
  }

  @Delete(':txId')
  @FirmRoles(FirmRole.OWNER, FirmRole.ADVISOR, FirmRole.SUPPORT)
  remove(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @Param('id') householdId: string,
    @Param('txId') txId: string,
    @Ip() ip: string,
  ) {
    return this.cashflow.remove(actor, firm, householdId, txId, ip);
  }
}
