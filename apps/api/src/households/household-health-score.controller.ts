import { Body, Controller, Get, Ip, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { FirmRole, Household } from '@prisma/client';
import { IsOptional, IsString } from 'class-validator';
import { HouseholdHealthScoreService } from './household-health-score.service';
import { AuthUser, CurrentUser } from '../common/decorators';
import { CurrentFirm, FirmContext, FirmRoles } from '../firms/firm-context.decorators';
import { HouseholdScopeGuard } from './household-scope.guard';
import { CurrentHousehold } from './household.decorators';

class HealthScoreQueryDto {
  @ApiProperty({ required: false, description: 'Score a specific immutable snapshot (defaults to latest)' })
  @IsOptional()
  @IsString()
  snapshotId?: string;
}

class CaptureHealthScoreDto {
  @ApiProperty({ required: false, description: 'Snapshot id to score (defaults to latest)' })
  @IsOptional()
  @IsString()
  snapshotId?: string;
}

/**
 * Financial Health Score (M3-1) — an explainable score derived from an immutable
 * Financial Snapshot. Household-scoped by HouseholdScopeGuard; the persist action is
 * limited to the household's data-entry roles. Reads snapshots only; never mutates the
 * Financial Kernel.
 */
@ApiTags('households')
@Controller('households/:id/health-score')
@UseGuards(HouseholdScopeGuard)
export class HouseholdHealthScoreController {
  constructor(private readonly scores: HouseholdHealthScoreService) {}

  @Get('current')
  current(@CurrentHousehold() household: Household, @Query() q: HealthScoreQueryDto) {
    return this.scores.current(household.id, q.snapshotId);
  }

  @Get('latest')
  latest(@Param('id') householdId: string) {
    return this.scores.latest(householdId);
  }

  @Get('timeline')
  timeline(@Param('id') householdId: string) {
    return this.scores.timeline(householdId);
  }

  @Post()
  @FirmRoles(FirmRole.OWNER, FirmRole.ADVISOR, FirmRole.SUPPORT)
  capture(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @Param('id') householdId: string,
    @Body() dto: CaptureHealthScoreDto,
    @Ip() ip: string,
  ) {
    return this.scores.capture(actor, firm, householdId, dto.snapshotId, ip);
  }

  @Get(':scoreId')
  getById(@Param('id') householdId: string, @Param('scoreId') scoreId: string) {
    return this.scores.getById(householdId, scoreId);
  }
}
