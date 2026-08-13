import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Min,
} from 'class-validator';

const GOAL_TYPES = [
  'retirement',
  'child_education',
  'child_marriage',
  'home_purchase',
  'emergency_fund',
  'travel',
  'custom',
] as const;

export class CreateHouseholdGoalDto {
  @ApiProperty()
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty({ enum: GOAL_TYPES })
  @IsEnum(GOAL_TYPES)
  type!: (typeof GOAL_TYPES)[number];

  @ApiProperty({ default: 'INR' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiProperty({ description: 'Target amount in minor units' })
  @IsInt()
  @IsPositive()
  targetAmountMinor!: number;

  @ApiProperty({ required: false, description: 'Saved so far, in minor units' })
  @IsOptional()
  @IsInt()
  @Min(0)
  currentAmountMinor?: number;

  @ApiProperty({ description: 'When the money is needed (ISO 8601)' })
  @IsISO8601()
  targetDate!: string;

  @ApiProperty({ required: false, default: 10 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  expectedAnnualReturnPct?: number;
}

export class UpdateHouseholdGoalDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiProperty({ enum: GOAL_TYPES, required: false })
  @IsOptional()
  @IsEnum(GOAL_TYPES)
  type?: (typeof GOAL_TYPES)[number];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @IsPositive()
  targetAmountMinor?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  currentAmountMinor?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsISO8601()
  targetDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  expectedAnnualReturnPct?: number;
}
