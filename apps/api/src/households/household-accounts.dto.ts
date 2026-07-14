import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Length } from 'class-validator';

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

export class CreateHouseholdAccountDto {
  @ApiProperty()
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty({ enum: ACCOUNT_TYPES })
  @IsEnum(ACCOUNT_TYPES)
  type!: (typeof ACCOUNT_TYPES)[number];

  @ApiProperty({ enum: ASSET_CLASSES, required: false })
  @IsOptional()
  @IsEnum(ASSET_CLASSES)
  assetClass?: (typeof ASSET_CLASSES)[number];

  @ApiProperty({ default: 'INR', description: 'Native ISO currency of the account' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiProperty({ description: 'Balance in minor units (paise/cents)' })
  @IsInt()
  balanceMinor!: number;

  @ApiProperty({ default: false })
  @IsOptional()
  @IsBoolean()
  isLiability?: boolean;

  @ApiProperty({ required: false, description: 'Owning legal entity (must be in this household)' })
  @IsOptional()
  @IsString()
  entityId?: string;
}

export class UpdateHouseholdAccountDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  balanceMinor?: number;

  @ApiProperty({ enum: ASSET_CLASSES, required: false })
  @IsOptional()
  @IsEnum(ASSET_CLASSES)
  assetClass?: (typeof ASSET_CLASSES)[number];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isLiability?: boolean;

  @ApiProperty({
    required: false,
    description: 'Reassign to a legal entity in this household (null to clear)',
  })
  @IsOptional()
  @IsString()
  entityId?: string | null;
}
