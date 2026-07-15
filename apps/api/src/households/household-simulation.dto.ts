import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';

const SCENARIO_TYPES = [
  'repay_debt',
  'increase_emergency_fund',
  'buy_asset',
  'sell_asset',
  'reallocate',
  'reduce_expenses',
  'increase_savings',
  'increase_sip',
  'retirement_contribution',
  'improve_insurance',
] as const;

export class SimulationScenarioDto {
  @ApiProperty({ enum: SCENARIO_TYPES })
  @IsIn(SCENARIO_TYPES)
  type!: (typeof SCENARIO_TYPES)[number];

  @ApiProperty({ description: 'Scenario parameters (amounts in minor units; asset classes as strings)' })
  @IsObject()
  params!: Record<string, number | string>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  label?: string;
}

export class SimulationRequestDto {
  @ApiProperty({ required: false, description: 'Immutable snapshot to simulate against (defaults to latest)' })
  @IsOptional()
  @IsString()
  snapshotId?: string;

  @ApiProperty({ type: [SimulationScenarioDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SimulationScenarioDto)
  scenarios!: SimulationScenarioDto[];
}
