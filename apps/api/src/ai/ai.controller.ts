import { Body, Controller, ForbiddenException, Module, Post } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsArray } from 'class-validator';
import { can, resolveEntitlements, type FeatureKey } from '@lcos/core';
import { AiService, type CoachMessage } from './ai.service';
import { BillingModule } from '../billing/billing.module';
import { BillingService } from '../billing/billing.service';
import { AuthUser, CurrentUser } from '../common/decorators';

class CoachDto {
  @ApiProperty({
    description: 'Conversation so far; last item should be the new user message.',
    example: [{ role: 'user', content: 'Can I afford to retire at 55?' }],
  })
  @IsArray()
  messages!: CoachMessage[];
}

@ApiTags('ai')
@Controller('ai')
class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly billing: BillingService,
  ) {}

  @Post('coach')
  async coach(@CurrentUser() user: AuthUser, @Body() dto: CoachDto) {
    // Gate behind the premium `ai_recommendations` entitlement.
    const { tier, features } = await this.billing.entitlements(user.id);
    const ent = resolveEntitlements(tier);
    ent.features = new Set(features as FeatureKey[]);
    if (!can(ent, 'ai_recommendations')) {
      throw new ForbiddenException('The AI Wealth Coach is a Premium feature. Upgrade to unlock it.');
    }
    return this.ai.coach(user.id, dto.messages ?? []);
  }
}

@Module({
  imports: [BillingModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
