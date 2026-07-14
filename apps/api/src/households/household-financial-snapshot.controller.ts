import {
  Body,
  Controller,
  Get,
  Ip,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FirmRole, Household } from '@prisma/client';
import { IsOptional, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { HouseholdFinancialSnapshotService } from './household-financial-snapshot.service';
import { AuthUser, CurrentUser } from '../common/decorators';
import { CurrentFirm, FirmContext, FirmRoles } from '../firms/firm-context.decorators';
import { HouseholdScopeGuard } from './household-scope.guard';
import { CurrentHousehold } from './household.decorators';

class CaptureSnapshotDto {
  @ApiProperty({ required: false, description: 'Cashflow period (YYYY-MM); defaults to current month' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'cashflowPeriod must be formatted YYYY-MM' })
  cashflowPeriod?: string;
}

class SnapshotQueryDto {
  @ApiProperty({ required: false, description: 'Cashflow period (YYYY-MM) for the live preview' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'period must be formatted YYYY-MM' })
  period?: string;
}

/**
 * Household Financial Snapshot seam (M2-6) — the canonical, immutable, versioned read
 * model composed from M2-2..M2-5. Every route is household-scoped by
 * HouseholdScopeGuard; capture is limited to the household's data-entry roles.
 */
@ApiTags('households')
@Controller('households/:id/financial-snapshot')
@UseGuards(HouseholdScopeGuard)
export class HouseholdFinancialSnapshotController {
  constructor(private readonly snapshots: HouseholdFinancialSnapshotService) {}

  @Get('current')
  current(@CurrentHousehold() household: Household, @Query() q: SnapshotQueryDto) {
    return this.snapshots.current(household.id, household.baseCurrency, q.period);
  }

  @Get('latest')
  latest(@Param('id') householdId: string) {
    return this.snapshots.latest(householdId);
  }

  @Get('timeline')
  timeline(@Param('id') householdId: string) {
    return this.snapshots.timeline(householdId);
  }

  @Post()
  @FirmRoles(FirmRole.OWNER, FirmRole.ADVISOR, FirmRole.SUPPORT)
  capture(
    @CurrentUser() actor: AuthUser,
    @CurrentFirm() firm: FirmContext,
    @CurrentHousehold() household: Household,
    @Body() dto: CaptureSnapshotDto,
    @Ip() ip: string,
  ) {
    return this.snapshots.capture(
      actor,
      firm,
      household.id,
      household.baseCurrency,
      dto.cashflowPeriod,
      ip,
    );
  }

  @Get(':snapshotId')
  async getById(@Param('id') householdId: string, @Param('snapshotId') snapshotId: string) {
    const snap = await this.snapshots.getById(householdId, snapshotId);
    if (!snap) throw new NotFoundException('Financial snapshot not found');
    return snap;
  }
}
