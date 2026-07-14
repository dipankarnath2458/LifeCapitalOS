import { Body, Controller, Delete, Get, Ip, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FirmRole } from '@prisma/client';
import { HouseholdAccountsService } from './household-accounts.service';
import { AuthUser, CurrentUser } from '../common/decorators';
import { CurrentFirm, FirmContext, FirmRoles } from '../firms/firm-context.decorators';
import { HouseholdScopeGuard } from './household-scope.guard';
import { CreateHouseholdAccountDto, UpdateHouseholdAccountDto } from './household-accounts.dto';

/**
 * Household accounts (MOD-4.1) — assets & liabilities scoped to a household and
 * optionally owned by a legal entity. Every route is household-scoped by
 * HouseholdScopeGuard; writes are limited to the household's data-entry roles.
 */
@ApiTags('households')
@Controller('households/:id/accounts')
@UseGuards(HouseholdScopeGuard)
export class HouseholdAccountsController {
  constructor(private readonly accounts: HouseholdAccountsService) {}

  @Get()
  list(@Param('id') householdId: string) {
    return this.accounts.list(householdId);
  }

  @Post()
  @FirmRoles(FirmRole.OWNER, FirmRole.ADVISOR, FirmRole.SUPPORT)
  create(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @Param('id') householdId: string,
    @Body() dto: CreateHouseholdAccountDto,
    @Ip() ip: string,
  ) {
    return this.accounts.create(actor, firm, householdId, dto, ip);
  }

  @Patch(':accountId')
  @FirmRoles(FirmRole.OWNER, FirmRole.ADVISOR, FirmRole.SUPPORT)
  update(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @Param('id') householdId: string,
    @Param('accountId') accountId: string,
    @Body() dto: UpdateHouseholdAccountDto,
    @Ip() ip: string,
  ) {
    return this.accounts.update(actor, firm, householdId, accountId, dto, ip);
  }

  @Delete(':accountId')
  @FirmRoles(FirmRole.OWNER, FirmRole.ADVISOR, FirmRole.SUPPORT)
  remove(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @Param('id') householdId: string,
    @Param('accountId') accountId: string,
    @Ip() ip: string,
  ) {
    return this.accounts.remove(actor, firm, householdId, accountId, ip);
  }
}
