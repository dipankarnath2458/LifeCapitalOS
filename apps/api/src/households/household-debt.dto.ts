import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

const DEBT_TYPES = [
  'home_loan',
  'personal_loan',
  'vehicle_loan',
  'education_loan',
  'business_loan',
  'credit_card',
  'other',
] as const;

const DEBT_STATUSES = ['active', 'closed', 'written_off', 'archived'] as const;
const PAYMENT_TYPES = ['emi', 'extra', 'prepayment', 'foreclosure'] as const;

export class CreateDebtDto {
  @ApiProperty()
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty({ enum: DEBT_TYPES })
  @IsEnum(DEBT_TYPES)
  type!: (typeof DEBT_TYPES)[number];

  @ApiProperty({ default: false, description: 'Secured (asset-backed) vs unsecured' })
  @IsOptional()
  @IsBoolean()
  secured?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  lender?: string;

  @ApiProperty({ default: 'INR', description: 'Native ISO currency of the debt' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiProperty({ description: 'Original sanctioned amount (minor units)' })
  @IsInt()
  @IsPositive()
  principalMinor!: number;

  @ApiProperty({ required: false, description: 'Current outstanding (minor units); defaults to principal' })
  @IsOptional()
  @IsInt()
  @Min(0)
  outstandingMinor?: number;

  @ApiProperty({ description: 'Nominal annual interest rate (%)' })
  @IsNumber()
  @Min(0)
  @Max(100)
  annualInterestRatePct!: number;

  @ApiProperty({ description: 'Minimum monthly payment (minor units)' })
  @IsInt()
  @Min(0)
  minimumPaymentMinor!: number;

  @ApiProperty({ required: false, description: 'Scheduled EMI (minor units)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  emiMinor?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsISO8601()
  startedAt?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsISO8601()
  maturityAt?: string;

  @ApiProperty({ required: false, description: 'Day of month the payment is due (1–31)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dueDayOfMonth?: number;

  @ApiProperty({ required: false, description: 'Owning legal entity (must be in this household)' })
  @IsOptional()
  @IsString()
  entityId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;
}

export class UpdateDebtDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  secured?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  lender?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  outstandingMinor?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  annualInterestRatePct?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  minimumPaymentMinor?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  emiMinor?: number;

  @ApiProperty({ enum: DEBT_STATUSES, required: false })
  @IsOptional()
  @IsEnum(DEBT_STATUSES)
  status?: (typeof DEBT_STATUSES)[number];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsISO8601()
  maturityAt?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dueDayOfMonth?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  entityId?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;
}

export class RecordDebtPaymentDto {
  @ApiProperty({ enum: PAYMENT_TYPES, default: 'emi' })
  @IsOptional()
  @IsEnum(PAYMENT_TYPES)
  type?: (typeof PAYMENT_TYPES)[number];

  @ApiProperty({ description: 'Total paid (minor units)' })
  @IsInt()
  @IsPositive()
  amountMinor!: number;

  @ApiProperty({ required: false, description: 'Principal portion (reduces outstanding)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  principalMinor?: number;

  @ApiProperty({ required: false, description: 'Interest portion (cost)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  interestMinor?: number;

  @ApiProperty({ description: 'Payment date (ISO 8601)' })
  @IsISO8601()
  paidOn!: string;

  @ApiProperty({ required: false, description: 'Linked cashflow Transaction id (M2-4)' })
  @IsOptional()
  @IsString()
  transactionId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;
}

/** `?status=` filter for the debt list. */
export class DebtQueryDto {
  @ApiProperty({ enum: DEBT_STATUSES, required: false })
  @IsOptional()
  @IsEnum(DEBT_STATUSES)
  status?: (typeof DEBT_STATUSES)[number];
}

/** Payoff projection query. */
export class PayoffQueryDto {
  @ApiProperty({ enum: ['snowball', 'avalanche'], required: false, default: 'avalanche' })
  @IsOptional()
  @IsEnum(['snowball', 'avalanche'] as const)
  strategy?: 'snowball' | 'avalanche';

  @ApiProperty({ required: false, description: 'Extra monthly budget over minimums (minor units)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  extraMonthlyMinor?: number;
}
