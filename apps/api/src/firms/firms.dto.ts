import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

export class CreateFirmDto {
  @ApiProperty()
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty({ description: 'User id of the firm owner (gets an OWNER membership)' })
  @IsString()
  ownerUserId!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  brandName?: string;

  @ApiProperty({ required: false, default: 'INR' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  baseCurrency?: string;

  @ApiProperty({ required: false, default: 'quarterly' })
  @IsOptional()
  @IsString()
  reviewCadence?: string;
}

export class UpdateFirmDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  brandName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  baseCurrency?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reviewCadence?: string;
}
