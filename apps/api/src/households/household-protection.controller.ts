import { Body, Controller, Get, Ip, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FirmRole } from '@prisma/client';
import { HouseholdProtectionService } from './household-protection.service';
import { AuthUser, CurrentUser } from '../common/decorators';
import { CurrentFirm, FirmContext, FirmRoles } from '../firms/firm-context.decorators';
import { HouseholdScopeGuard } from './household-scope.guard';
import { UpdateMemberProtectionDto } from './household-protection.dto';

/**
 * Household protection (M5.9) — see `docs/M5_9_PROTECTION_ARCHITECTURE.md`.
 *
 * Household-scoped by `HouseholdScopeGuard` (404-not-403) and limited to the household's
 * data-entry roles, like every sibling route. Additive: no existing route, response shape or
 * query parameter changes.
 *
 * The retail `PUT /profile` path is untouched and still serves V1's Protection component on
 * `/dashboard`.
 */
@ApiTags('households')
@Controller('households/:id/protection')
@UseGuards(HouseholdScopeGuard)
export class HouseholdProtectionController {
  constructor(private readonly protection: HouseholdProtectionService) {}

  @Get()
  overview(@Param('id') householdId: string) {
    return this.protection.overview(householdId);
  }

  @Patch('members/:memberId')
  @FirmRoles(FirmRole.OWNER, FirmRole.ADVISOR, FirmRole.SUPPORT)
  update(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @Param('id') householdId: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateMemberProtectionDto,
    @Ip() ip: string,
  ) {
    return this.protection.update(actor, firm, householdId, memberId, dto, ip);
  }
}
