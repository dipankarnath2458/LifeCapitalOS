import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { Household } from '@prisma/client';
import { IsArray, IsOptional } from 'class-validator';
import { HouseholdAiService, type CoachMessage } from './household-ai.service';
import { HouseholdScopeGuard } from './household-scope.guard';
import { CurrentHousehold } from './household.decorators';
import { BillingService } from '../billing/billing.service';
import { AuthUser, CurrentUser } from '../common/decorators';

class CoachDto {
  @ApiProperty({
    required: false,
    description: 'Conversation so far; the last item should be the new user message.',
    example: [{ role: 'user', content: 'Can I afford to retire at 55?' }],
  })
  @IsOptional()
  @IsArray()
  messages?: CoachMessage[];
}

/**
 * V2 consumer AI — the Family CFO surface (M5.7).
 *
 * See `docs/M5_7_AI_INSIGHTS_ARCHITECTURE.md`.
 *
 * Household-scoped and guarded like every other household route, so another firm's household is a
 * 404 rather than a 403. Read-only: nothing here writes to the kernel or captures a snapshot.
 *
 * ## Why the two routes are gated differently
 *
 * `insights` narrates figures the consumer's own dashboard already renders, and **never calls a
 * model** — so it genuinely costs nothing to serve, and putting a paywall in front of a sentence
 * describing numbers already on screen would be user-hostile.
 *
 * That "never calls a model" is load-bearing, not incidental. The coach page loads this summary
 * automatically on mount; while it shared the coach's code path it was deterministic only because
 * no API key happened to be configured, and the day one was, every page view became a billed call
 * on an ungated route. See §6.1 of the architecture doc.
 *
 * `coach` is a conversation with a model and carries per-token cost, so it keeps the same
 * `ai_recommendations` entitlement that gates V1's `/ai/*`. Consumers without it get the
 * deterministic layer narrative through `insights`, never an error and never silence.
 *
 * This split is a product decision recorded in §6 of the architecture doc. If the whole surface
 * should be premium, the only change is adding the same guard to `insights`.
 */
@ApiTags('households')
@Controller('households/:id/ai')
@UseGuards(HouseholdScopeGuard)
export class HouseholdAiController {
  constructor(
    private readonly ai: HouseholdAiService,
    private readonly billing: BillingService,
  ) {}

  @Post('insights')
  insights(@CurrentHousehold() household: Household) {
    return this.ai.insights(household);
  }

  @Post('coach')
  async coach(
    @CurrentUser() user: AuthUser,
    @CurrentHousehold() household: Household,
    @Body() dto: CoachDto,
  ) {
    await this.billing.assertFeature(
      user.id,
      'ai_recommendations',
      'This is a Premium feature. Upgrade to unlock it.',
    );
    return this.ai.coach(household, dto.messages ?? []);
  }
}
