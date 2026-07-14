import { Body, Controller, Get, Ip, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FirmRole, Role } from '@prisma/client';
import { FirmsService } from './firms.service';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { RolesGuard } from '../common/roles.guard';
import { FirmContextGuard } from './firm-context.guard';
import { CurrentFirm, FirmContext, FirmRoles } from './firm-context.decorators';
import { CreateFirmDto, UpdateFirmDto } from './firms.dto';

@ApiTags('firms')
@Controller('firms')
export class FirmsController {
  constructor(private readonly firms: FirmsService) {}

  /** Platform-admin provisioning. Not firm-scoped (no firm exists yet). */
  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateFirmDto, @Ip() ip: string) {
    return this.firms.create(actor, dto, ip);
  }

  /** Firms the caller belongs to, plus their active firm context. */
  @Get('me')
  listMine(@CurrentUser() user: AuthUser) {
    return this.firms.listMine(user);
  }

  @Get(':id')
  @UseGuards(FirmContextGuard)
  get(@CurrentFirm() firm: FirmContext) {
    return this.firms.get(firm.firmId);
  }

  @Patch(':id')
  @UseGuards(FirmContextGuard)
  @FirmRoles(FirmRole.OWNER)
  update(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @Body() dto: UpdateFirmDto,
    @Ip() ip: string,
  ) {
    return this.firms.update(actor, firm.firmId, dto, ip);
  }

  @Post(':id/switch')
  @UseGuards(FirmContextGuard)
  switch(@CurrentUser() actor: AuthUser, @CurrentFirm() firm: FirmContext, @Ip() ip: string) {
    return this.firms.switchActive(actor, firm.firmId, ip);
  }
}
