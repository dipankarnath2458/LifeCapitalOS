import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

export class HealthCheckDto {
  @ApiProperty() @IsInt() age!: number;
  @ApiProperty() @IsInt() monthlyExpensesMinor!: number;
  @ApiProperty() @IsInt() emergencyFundMinor!: number;
  @ApiProperty() @IsInt() annualIncomeMinor!: number;
  @ApiProperty() @IsInt() existingLifeCoverMinor!: number;
  @ApiProperty() @IsBoolean() hasHealthInsurance!: boolean;
  @ApiProperty() @IsInt() investmentAssetsMinor!: number;
  @ApiProperty() @IsInt() totalAssetsMinor!: number;
  @ApiProperty() @IsInt() totalLiabilitiesMinor!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() retirementRequiredCorpusMinor?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() retirementCorpusGapMinor?: number;
}

export class RetirementDto {
  @ApiProperty() @IsInt() currentAge!: number;
  @ApiProperty() @IsInt() retirementAge!: number;
  @ApiProperty({ default: 25 }) @IsInt() yearsInRetirement = 25;
  @ApiProperty() @IsInt() currentAnnualExpensesMinor!: number;
  @ApiProperty() @IsInt() currentCorpusMinor!: number;
  @ApiProperty({ default: 6 }) @IsNumber() inflationRatePct = 6;
  @ApiProperty({ default: 11 }) @IsNumber() preRetirementReturnPct = 11;
  @ApiProperty({ default: 7 }) @IsNumber() postRetirementReturnPct = 7;
  @ApiProperty({ default: 'INR' }) @IsString() currency = 'INR';
}

export class AllocationDto {
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } })
  values!: Record<string, number>;

  @ApiProperty({ enum: ['conservative', 'moderate', 'aggressive'] })
  @IsString()
  riskTolerance!: 'conservative' | 'moderate' | 'aggressive';

  @ApiProperty({ required: false }) @IsOptional() @IsInt() age?: number;
}

export class InsuranceDto {
  @ApiProperty() @IsInt() annualIncomeMinor!: number;
  @ApiProperty() @IsInt() outstandingLiabilitiesMinor!: number;
  @ApiProperty() @IsInt() existingCoverMinor!: number;
  @ApiProperty({ default: 0 }) @IsInt() dependents = 0;
  @ApiProperty({ default: 'INR' }) @IsString() currency = 'INR';
}
