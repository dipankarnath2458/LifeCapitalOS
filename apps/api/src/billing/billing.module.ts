import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Module,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import type { Request } from 'express';
import type { PlanTier } from '@lcos/core';
import { BillingService, type RazorpayWebhookEvent } from './billing.service';
import { RazorpayService } from './razorpay.service';
import { AuthUser, CurrentUser, Public } from '../common/decorators';

class SubscribeDto {
  @ApiProperty({ enum: ['free', 'premium', 'family_cfo'] })
  @IsIn(['free', 'premium', 'family_cfo'])
  tier!: PlanTier;
}

@ApiTags('billing')
@Controller('billing')
class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly razorpay: RazorpayService,
  ) {}

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

  @Post('cancel')
  cancel(@CurrentUser() user: AuthUser) {
    return this.billing.cancel(user.id);
  }

  /**
   * Razorpay payment webhook. Public (Razorpay has no JWT) but the HMAC signature is
   * verified against the raw body before any state changes.
   */
  @Public()
  @Post('razorpay/webhook')
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature: string | undefined,
  ) {
    const raw = req.rawBody;
    if (!raw || !this.razorpay.verifyWebhookSignature(raw, signature)) {
      throw new BadRequestException('Invalid webhook signature');
    }
    await this.billing.applyWebhookEvent(req.body as RazorpayWebhookEvent);
    return { received: true };
  }
}

@Module({
  controllers: [BillingController],
  providers: [BillingService, RazorpayService],
  exports: [BillingService],
})
export class BillingModule {}
