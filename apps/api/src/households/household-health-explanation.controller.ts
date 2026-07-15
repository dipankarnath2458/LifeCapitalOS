import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { HouseholdHealthExplanationService } from './household-health-explanation.service';
import { HouseholdScopeGuard } from './household-scope.guard';
import { CurrentHousehold } from './household.decorators';
import { Household } from '@prisma/client';

class ExplanationQueryDto {
  @ApiProperty({ required: false, description: 'Explain a specific immutable snapshot (defaults to latest)' })
  @IsOptional()
  @IsString()
  snapshotId?: string;
}

/**
 * Explainable Financial Health Engine (M3-2) — a **read-only** explanation over an
 * existing Financial Health Score. Household-scoped by HouseholdScopeGuard; all reads
 * (any in-scope member). Nothing is computed here beyond the deterministic explanation,
 * nothing is persisted, and the Financial Kernel / scoring logic is never modified.
 */
@ApiTags('households')
@Controller('households/:id/health-score/explanation')
@UseGuards(HouseholdScopeGuard)
export class HouseholdHealthExplanationController {
  constructor(private readonly explanations: HouseholdHealthExplanationService) {}

  @Get('current')
  current(@CurrentHousehold() household: Household, @Query() q: ExplanationQueryDto) {
    return this.explanations.current(household.id, q.snapshotId);
  }

  @Get('latest')
  latest(@Param('id') householdId: string) {
    return this.explanations.latest(householdId);
  }

  @Get(':scoreId')
  byId(@Param('id') householdId: string, @Param('scoreId') scoreId: string) {
    return this.explanations.byId(householdId, scoreId);
  }
}
