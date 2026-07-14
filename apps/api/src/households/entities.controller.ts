import { Body, Controller, Delete, Get, Ip, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FirmRole } from '@prisma/client';
import { EntitiesService } from './entities.service';
import { AuthUser, CurrentUser } from '../common/decorators';
import { CurrentFirm, FirmContext, FirmRoles } from '../firms/firm-context.decorators';
import { HouseholdScopeGuard } from './household-scope.guard';
import { CreateEntityDto, UpdateEntityDto } from './entities.dto';

/**
 * Legal entities that own accounts within a household (MOD-3.3). Scoped to the
 * household by HouseholdScopeGuard; writes limited to data-entry roles. name and
 * taxId are encrypted at rest.
 */
@ApiTags('households')
@Controller('households/:id/entities')
@UseGuards(HouseholdScopeGuard)
export class EntitiesController {
  constructor(private readonly entities: EntitiesService) {}

  @Get()
  list(@Param('id') householdId: string) {
    return this.entities.list(householdId);
  }

  @Post()
  @FirmRoles(FirmRole.OWNER, FirmRole.ADVISOR, FirmRole.SUPPORT)
  create(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @Param('id') householdId: string,
    @Body() dto: CreateEntityDto,
    @Ip() ip: string,
  ) {
    return this.entities.create(actor, firm, householdId, dto, ip);
  }

  @Patch(':eid')
  @FirmRoles(FirmRole.OWNER, FirmRole.ADVISOR, FirmRole.SUPPORT)
  update(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @Param('id') householdId: string,
    @Param('eid') eid: string,
    @Body() dto: UpdateEntityDto,
    @Ip() ip: string,
  ) {
    return this.entities.update(actor, firm, householdId, eid, dto, ip);
  }

  @Delete(':eid')
  @FirmRoles(FirmRole.OWNER, FirmRole.ADVISOR, FirmRole.SUPPORT)
  remove(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @Param('id') householdId: string,
    @Param('eid') eid: string,
    @Ip() ip: string,
  ) {
    return this.entities.remove(actor, firm, householdId, eid, ip);
  }
}
