import { Body, Controller, Delete, Get, Ip, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FirmRole } from '@prisma/client';
import { HouseholdMembersService } from './household-members.service';
import { AuthUser, CurrentUser } from '../common/decorators';
import { CurrentFirm, FirmContext, FirmRoles } from '../firms/firm-context.decorators';
import { HouseholdScopeGuard } from './household-scope.guard';
import { CreateHouseholdMemberDto, UpdateHouseholdMemberDto } from './household-members.dto';

/**
 * Household members (MOD-3.2). Every route is scoped to the household by
 * HouseholdScopeGuard (read access follows advisor assignment); writes are
 * limited to the household's data-entry roles.
 */
@ApiTags('households')
@Controller('households/:id/members')
@UseGuards(HouseholdScopeGuard)
export class HouseholdMembersController {
  constructor(private readonly members: HouseholdMembersService) {}

  @Get()
  list(@Param('id') householdId: string) {
    return this.members.list(householdId);
  }

  @Post()
  @FirmRoles(FirmRole.OWNER, FirmRole.ADVISOR, FirmRole.SUPPORT)
  create(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @Param('id') householdId: string,
    @Body() dto: CreateHouseholdMemberDto,
    @Ip() ip: string,
  ) {
    return this.members.create(actor, firm, householdId, dto, ip);
  }

  @Patch(':mid')
  @FirmRoles(FirmRole.OWNER, FirmRole.ADVISOR, FirmRole.SUPPORT)
  update(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @Param('id') householdId: string,
    @Param('mid') mid: string,
    @Body() dto: UpdateHouseholdMemberDto,
    @Ip() ip: string,
  ) {
    return this.members.update(actor, firm, householdId, mid, dto, ip);
  }

  @Delete(':mid')
  @FirmRoles(FirmRole.OWNER, FirmRole.ADVISOR, FirmRole.SUPPORT)
  remove(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @Param('id') householdId: string,
    @Param('mid') mid: string,
    @Ip() ip: string,
  ) {
    return this.members.remove(actor, firm, householdId, mid, ip);
  }
}
