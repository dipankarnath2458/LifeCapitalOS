import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export class BudgetLineDto {
  @ApiProperty({ description: 'Category the envelope caps (matches transaction categories)' })
  @IsString()
  @Length(1, 60)
  category!: string;

  @ApiProperty({ description: 'Envelope limit in minor units' })
  @IsInt()
  @Min(0)
  amountMinor!: number;
}

export class UpsertBudgetDto {
  @ApiProperty({ description: 'Budget period (YYYY-MM)' })
  @Matches(/^\d{4}-\d{2}$/, { message: 'periodMonth must be formatted YYYY-MM' })
  periodMonth!: string;

  @ApiProperty({ required: false, description: 'Optional overall monthly cap (minor units)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  totalAmountMinor?: number;

  @ApiProperty({ type: [BudgetLineDto], description: 'Per-category envelopes' })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BudgetLineDto)
  lines!: BudgetLineDto[];
}

/** `?month=YYYY-MM` selector for the budget-vs-actual read. */
export class BudgetQueryDto {
  @ApiProperty({ required: false, description: 'Budget month (YYYY-MM); defaults to current month' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'month must be formatted YYYY-MM' })
  month?: string;
}
