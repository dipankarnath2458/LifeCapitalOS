import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsArray } from 'class-validator';
import { AiService, type CoachMessage } from './ai.service';
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
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly billing: BillingService,
  ) {}

  /** Throws 403 unless the user has the premium `ai_recommendations` entitlement. */
  private assertAiAccess(userId: string): Promise<void> {
    return this.billing.assertFeature(
      userId,
      'ai_recommendations',
      'This is a Premium feature. Upgrade to unlock it.',
    );
  }

  @Post('coach')
  async coach(@CurrentUser() user: AuthUser, @Body() dto: CoachDto) {
    await this.assertAiAccess(user.id);
    return this.ai.coach(user.id, dto.messages ?? []);
  }

  @Get('second-opinion')
  async secondOpinion(@CurrentUser() user: AuthUser) {
    await this.assertAiAccess(user.id);
    return this.ai.secondOpinion(user.id);
  }
}
