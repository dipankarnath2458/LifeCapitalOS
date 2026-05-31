import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import type { PlanTier } from '@lcos/core';
import { BillingService } from './billing.service';
import { AuthUser, CurrentUser, Public } from '../common/decorators';

class SubscribeDto {
  @ApiProperty({ enum: ['free', 'premium', 'family_cfo'] })
  @IsIn(['free', 'premium', 'family_cfo'])
  tier!: PlanTier;
}

@ApiTags('billing')
@Controller('billing')
class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Public()
  @Get('plans')
  plans() {
    return this.billing.plans();
  }

  @Get('entitlements')
  entitlements(@CurrentUser() user: AuthUser) {
    return this.billing.entitlements(user.id);
  }

  @Post('subscribe')
  subscribe(@CurrentUser() user: AuthUser, @Body() dto: SubscribeDto) {
    return this.billing.subscribe(user.id, dto.tier);
  }
}

@Module({
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
