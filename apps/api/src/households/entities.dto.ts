import { ApiProperty } from '@nestjs/swagger';
import { EntityType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';

export class CreateEntityDto {
  @ApiProperty({ description: 'Legal entity name (stored encrypted)' })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiProperty({ required: false, enum: EntityType })
  @IsOptional()
  @IsEnum(EntityType)
  type?: EntityType;

  @ApiProperty({ required: false, description: 'Tax identifier, e.g. PAN (stored encrypted)' })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  taxId?: string;
}

export class UpdateEntityDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @ApiProperty({ required: false, enum: EntityType })
  @IsOptional()
  @IsEnum(EntityType)
  type?: EntityType;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  taxId?: string;
}
