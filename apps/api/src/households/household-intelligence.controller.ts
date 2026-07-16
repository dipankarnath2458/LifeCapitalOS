import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { Household } from '@prisma/client';
import { IsOptional, IsString } from 'class-validator';
import { HouseholdIntelligenceService } from './household-intelligence.service';
import { HouseholdScopeGuard } from './household-scope.guard';
import { CurrentHousehold } from './household.decorators';

class IntelligenceQueryDto {
  @ApiProperty({ required: false, description: 'Analyse a specific immutable snapshot (defaults to latest)' })
  @IsOptional()
  @IsString()
  snapshotId?: string;
}

/**
 * Financial Intelligence Layer (M5). A read-only **consumer** of the Financial Kernel:
 * it composes the immutable Financial Snapshot into the canonical
 * `HouseholdFinancialIntelligence` object that every surface (Dashboard, AI Family CFO™,
 * Reports, What-if, Advisor Workspace, Mobile) reads instead of calculating. Additive,
 * household-scoped, guarded; no mutation to the kernel. This milestone ships the live
 * `current` compute; persistence/timeline are a documented follow-up (no schema change).
 */
@ApiTags('households')
@Controller('households/:id/intelligence')
@UseGuards(HouseholdScopeGuard)
export class HouseholdIntelligenceController {
  constructor(private readonly intelligence: HouseholdIntelligenceService) {}

  @Get('current')
  current(@CurrentHousehold() household: Household, @Query() q: IntelligenceQueryDto) {
    return this.intelligence.current(household, q.snapshotId);
  }
}
