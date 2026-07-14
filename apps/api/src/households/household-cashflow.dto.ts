import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Matches,
} from 'class-validator';

const TRANSACTION_TYPES = ['income', 'expense', 'transfer', 'adjustment'] as const;
const TRANSACTION_STATUSES = ['cleared', 'pending', 'void'] as const;

export class CreateHouseholdTransactionDto {
  @ApiProperty({ description: 'Account the money moved in/out of (must be in this household)' })
  @IsString()
  accountId!: string;

  @ApiProperty({ enum: TRANSACTION_TYPES })
  @IsEnum(TRANSACTION_TYPES)
  type!: (typeof TRANSACTION_TYPES)[number];

  @ApiProperty({ description: 'Category (free-form; see the recommended taxonomy)' })
  @IsString()
  @Length(1, 60)
  category!: string;

  @ApiProperty({ description: 'Amount in minor units (paise/cents); always positive' })
  @IsInt()
  @IsPositive()
  amountMinor!: number;

  @ApiProperty({ default: 'INR', description: 'Native ISO currency of the transaction' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiProperty({ description: 'Transaction date (ISO 8601)' })
  @IsISO8601()
  occurredAt!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  tags?: string[];

  @ApiProperty({ enum: TRANSACTION_STATUSES, default: 'cleared', required: false })
  @IsOptional()
  @IsEnum(TRANSACTION_STATUSES)
  status?: (typeof TRANSACTION_STATUSES)[number];
}

export class UpdateHouseholdTransactionDto {
  @ApiProperty({ enum: TRANSACTION_TYPES, required: false })
  @IsOptional()
  @IsEnum(TRANSACTION_TYPES)
  type?: (typeof TRANSACTION_TYPES)[number];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  category?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @IsPositive()
  amountMinor?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsISO8601()
  occurredAt?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  tags?: string[];

  @ApiProperty({ enum: TRANSACTION_STATUSES, required: false })
  @IsOptional()
  @IsEnum(TRANSACTION_STATUSES)
  status?: (typeof TRANSACTION_STATUSES)[number];
}

/** `?month=YYYY-MM` filter for the transaction list / timeline. */
export class CashflowQueryDto {
  @ApiProperty({ required: false, description: 'Filter to a single month (YYYY-MM)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'month must be formatted YYYY-MM' })
  month?: string;
}
