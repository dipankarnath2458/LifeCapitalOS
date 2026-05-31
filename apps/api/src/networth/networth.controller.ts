import { Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NetWorthService } from './networth.service';
import { AuthUser, CurrentUser } from '../common/decorators';

@ApiTags('net-worth')
@Controller('net-worth')
export class NetWorthController {
  constructor(private readonly netWorth: NetWorthService) {}

  @Get('current')
  current(@CurrentUser() user: AuthUser) {
    return this.netWorth.current(user.id);
  }

  @Post('snapshot')
  snapshot(@CurrentUser() user: AuthUser) {
    return this.netWorth.snapshot(user.id);
  }

  @Get('timeline')
  timeline(@CurrentUser() user: AuthUser) {
    return this.netWorth.timeline(user.id);
  }
}
