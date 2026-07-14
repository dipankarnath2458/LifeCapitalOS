import { Body, Controller, Get, Ip, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FirmRole } from '@prisma/client';
import { MembersService } from './members.service';
import { AuthUser, CurrentUser } from '../common/decorators';
import { FirmContextGuard } from './firm-context.guard';
import { CurrentFirm, FirmContext, FirmRoles } from './firm-context.decorators';
import { CreateInvitationDto, UpdateMembershipDto } from './members.dto';

@ApiTags('firms')
@Controller('firms/:firmId')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  /** Firm roster. Any active member of the firm may read it. */
  @Get('members')
  @UseGuards(FirmContextGuard)
  list(@CurrentFirm() firm: FirmContext) {
    return this.members.list(firm.firmId);
  }

  /** Invite an existing user into the firm. Owner-only. */
  @Post('invitations')
  @UseGuards(FirmContextGuard)
  @FirmRoles(FirmRole.OWNER)
  invite(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @Body() dto: CreateInvitationDto,
    @Ip() ip: string,
  ) {
    return this.members.invite(actor, firm.firmId, dto, ip);
  }

  /**
   * Accept a pending invitation. Not FirmContextGuard-gated: the caller is not
   * yet an active member, so the guard would (correctly) hide the firm.
   */
  @Post('accept')
  accept(@CurrentUser() actor: AuthUser, @Param('firmId') firmId: string, @Ip() ip: string) {
    return this.members.accept(actor, firmId, ip);
  }

  /** Change a member's firm role or status. Owner-only. */
  @Patch('members/:mid')
  @UseGuards(FirmContextGuard)
  @FirmRoles(FirmRole.OWNER)
  update(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @Param('mid') mid: string,
    @Body() dto: UpdateMembershipDto,
    @Ip() ip: string,
  ) {
    return this.members.update(actor, firm.firmId, mid, dto, ip);
  }
}
