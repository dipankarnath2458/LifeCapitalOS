import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';

const ACCOUNT_TYPES = [
  'bank',
  'investment',
  'retirement',
  'real_estate',
  'vehicle',
  'cash',
  'other_asset',
  'loan',
  'credit_card',
] as const;

const ASSET_CLASSES = [
  'equity',
  'debt',
  'gold',
  'real_estate',
  'cash',
  'crypto',
  'business',
  'other',
] as const;

export class CreateAccountDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty({ enum: ACCOUNT_TYPES })
  @IsEnum(ACCOUNT_TYPES)
  type!: (typeof ACCOUNT_TYPES)[number];

  @ApiProperty({ enum: ASSET_CLASSES, required: false })
  @IsOptional()
  @IsEnum(ASSET_CLASSES)
  assetClass?: (typeof ASSET_CLASSES)[number];

  @ApiProperty({ default: 'INR' })
  @IsString()
  currency = 'INR';

  @ApiProperty({ description: 'Balance in minor units (paise)' })
  @IsInt()
  balanceMinor!: number;

  @ApiProperty({ default: false })
  @IsBoolean()
  @IsOptional()
  isLiability = false;
}

export class UpdateAccountDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  balanceMinor?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEnum(ASSET_CLASSES)
  assetClass?: (typeof ASSET_CLASSES)[number];
}
