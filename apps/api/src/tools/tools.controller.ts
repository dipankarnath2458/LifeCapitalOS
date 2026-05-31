import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  analyzeAllocation,
  analyzeLifeInsuranceGap,
  computeRetirement,
  computeWealthHealth,
  topWealthActions,
  type Allocation,
  type CurrencyCode,
} from '@lcos/core';
import { Public } from '../common/decorators';
import { AllocationDto, HealthCheckDto, InsuranceDto, RetirementDto } from './tools.dto';

/**
 * Public, no-login "Wealth Tools" — the lead-generation engine from the blueprint.
 * These deliver instant value before asking for personal details.
 */
@ApiTags('tools')
@Controller('tools')
export class ToolsController {
  @Public()
  @Post('health-check')
  healthCheck(@Body() dto: HealthCheckDto) {
    const report = computeWealthHealth({
      age: dto.age,
      monthlyExpensesMinor: dto.monthlyExpensesMinor,
      emergencyFundMinor: dto.emergencyFundMinor,
      annualIncomeMinor: dto.annualIncomeMinor,
      existingLifeCoverMinor: dto.existingLifeCoverMinor,
      hasHealthInsurance: dto.hasHealthInsurance,
      investmentAssetsMinor: dto.investmentAssetsMinor,
      totalAssetsMinor: dto.totalAssetsMinor,
      totalLiabilitiesMinor: dto.totalLiabilitiesMinor,
      retirementRequiredCorpusMinor: dto.retirementRequiredCorpusMinor ?? 0,
      retirementCorpusGapMinor: dto.retirementCorpusGapMinor ?? 0,
    });
    return { report, topActions: topWealthActions(report) };
  }

  @Public()
  @Post('retirement')
  retirement(@Body() dto: RetirementDto) {
    return computeRetirement({ ...dto, currency: dto.currency as CurrencyCode });
  }

  @Public()
  @Post('asset-allocation')
  allocation(@Body() dto: AllocationDto) {
    return analyzeAllocation(dto.values as Allocation, dto.riskTolerance, dto.age);
  }

  @Public()
  @Post('insurance-gap')
  insurance(@Body() dto: InsuranceDto) {
    return analyzeLifeInsuranceGap({ ...dto, currency: dto.currency as CurrencyCode });
  }
}
