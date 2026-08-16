import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Stating a retirement plan (M5.10).
 *
 * Every field is optional so a family can answer one question at a time. **Omitting a field
 * leaves the stored answer unchanged; it never resets it to "not stated."** An answer given is
 * a fact, and silently discarding it would put the household back into the state the projection
 * cannot be made from.
 *
 * `monthlyContributionMinor` accepts `0` deliberately: "we are not saving for retirement yet" is
 * a real answer that produces a real At Risk finding, and is not the same as never having said.
 */
export class UpdateRetirementPlanDto {
  @ApiProperty({ required: false, minimum: 30, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(100)
  retirementAge?: number;

  @ApiProperty({ required: false, description: 'The age the plan funds to.', minimum: 40, maximum: 120 })
  @IsOptional()
  @IsInt()
  @Min(40)
  @Max(120)
  lifeExpectancy?: number;

  @ApiProperty({ required: false, description: 'Desired yearly income in retirement, minor units.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  desiredAnnualIncomeMinor?: number;

  @ApiProperty({ required: false, description: 'Saved for retirement each month, minor units.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyContributionMinor?: number;

  @ApiProperty({ required: false, description: 'Overrides the snapshot-derived corpus.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  currentCorpusMinor?: number;

  @ApiProperty({ required: false, minimum: 0, maximum: 20 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(20)
  inflationRatePct?: number;

  @ApiProperty({ required: false, minimum: 0, maximum: 30 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(30)
  preRetirementReturnPct?: number;

  @ApiProperty({ required: false, minimum: 0, maximum: 30 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(30)
  postRetirementReturnPct?: number;
}

const SCENARIO_TYPES = [
  'retire_earlier',
  'retire_later',
  'increase_contribution',
  'increase_corpus',
  'change_income_target',
] as const;

export class RetirementScenarioDto {
  @ApiProperty({ enum: SCENARIO_TYPES })
  @IsEnum(SCENARIO_TYPES)
  type!: (typeof SCENARIO_TYPES)[number];

  @ApiProperty({ required: false, description: 'Years to shift the retirement age by.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  years?: number;

  @ApiProperty({ required: false, description: 'Amount in minor units.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  amountMinor?: number;
}

export class RetirementWhatIfDto {
  /** Bounded: each scenario is a full projection, and this endpoint is unauthenticated-cheap. */
  @ApiProperty({ type: [RetirementScenarioDto] })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => RetirementScenarioDto)
  scenarios!: RetirementScenarioDto[];
}
