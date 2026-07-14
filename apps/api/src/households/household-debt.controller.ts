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
import { HouseholdDebtService } from './household-debt.service';
import { AuthUser, CurrentUser } from '../common/decorators';
import { CurrentFirm, FirmContext, FirmRoles } from '../firms/firm-context.decorators';
import { HouseholdScopeGuard } from './household-scope.guard';
import { CurrentHousehold } from './household.decorators';
import {
  CreateDebtDto,
  DebtQueryDto,
  PayoffQueryDto,
  RecordDebtPaymentDto,
  UpdateDebtDto,
} from './household-debt.dto';

/**
 * Household debt & payoff engine (M2-5) — a detailed liability ledger with payments,
 * live summary/payoff, and immutable debt snapshots. Household-scoped by
 * HouseholdScopeGuard; writes limited to the household's data-entry roles.
 */
@ApiTags('households')
@Controller('households/:id/debts')
@UseGuards(HouseholdScopeGuard)
export class HouseholdDebtController {
  constructor(private readonly debts: HouseholdDebtService) {}

  @Get()
  list(@Param('id') householdId: string, @Query() q: DebtQueryDto) {
    return this.debts.list(householdId, q.status);
  }

  @Get('summary')
  summary(@CurrentHousehold() household: Household) {
    return this.debts.summary(household.id, household.baseCurrency);
  }

  @Get('payoff')
  payoff(@CurrentHousehold() household: Household, @Query() q: PayoffQueryDto) {
    return this.debts.payoff(
      household.id,
      household.baseCurrency,
      q.strategy ?? 'avalanche',
      q.extraMonthlyMinor ?? 0,
    );
  }

  @Get('timeline')
  timeline(@Param('id') householdId: string) {
    return this.debts.timeline(householdId);
  }

  @Post()
  @FirmRoles(FirmRole.OWNER, FirmRole.ADVISOR, FirmRole.SUPPORT)
  create(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @Param('id') householdId: string,
    @Body() dto: CreateDebtDto,
    @Ip() ip: string,
  ) {
    return this.debts.create(actor, firm, householdId, dto, ip);
  }

  @Post('snapshot')
  @FirmRoles(FirmRole.OWNER, FirmRole.ADVISOR, FirmRole.SUPPORT)
  snapshot(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @CurrentHousehold() household: Household,
    @Ip() ip: string,
  ) {
    return this.debts.snapshot(actor, firm, household.id, household.baseCurrency, ip);
  }

  @Get(':debtId/payments')
  listPayments(@Param('id') householdId: string, @Param('debtId') debtId: string) {
    return this.debts.listPayments(householdId, debtId);
  }

  @Post(':debtId/payments')
  @FirmRoles(FirmRole.OWNER, FirmRole.ADVISOR, FirmRole.SUPPORT)
  recordPayment(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @Param('id') householdId: string,
    @Param('debtId') debtId: string,
    @Body() dto: RecordDebtPaymentDto,
    @Ip() ip: string,
  ) {
    return this.debts.recordPayment(actor, firm, householdId, debtId, dto, ip);
  }

  @Patch(':debtId')
  @FirmRoles(FirmRole.OWNER, FirmRole.ADVISOR, FirmRole.SUPPORT)
  update(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @Param('id') householdId: string,
    @Param('debtId') debtId: string,
    @Body() dto: UpdateDebtDto,
    @Ip() ip: string,
  ) {
    return this.debts.update(actor, firm, householdId, debtId, dto, ip);
  }

  @Delete(':debtId')
  @FirmRoles(FirmRole.OWNER, FirmRole.ADVISOR, FirmRole.SUPPORT)
  remove(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @Param('id') householdId: string,
    @Param('debtId') debtId: string,
    @Ip() ip: string,
  ) {
    return this.debts.remove(actor, firm, householdId, debtId, ip);
  }
}
