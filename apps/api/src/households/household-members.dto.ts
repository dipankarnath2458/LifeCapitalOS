import { ApiProperty } from '@nestjs/swagger';
import { HouseholdRole } from '@prisma/client';
import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, Length } from 'class-validator';

export class CreateHouseholdMemberDto {
  @ApiProperty({ description: 'Person name (stored encrypted)' })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiProperty({ description: 'Relationship to the household, e.g. spouse, child' })
  @IsString()
  @Length(1, 60)
  relation!: string;

  @ApiProperty({ required: false, description: 'ISO date' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isDependent?: boolean;

  @ApiProperty({ required: false, enum: HouseholdRole })
  @IsOptional()
  @IsEnum(HouseholdRole)
  householdRole?: HouseholdRole;
}

export class UpdateHouseholdMemberDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  relation?: string;

  @ApiProperty({ required: false, description: 'ISO date' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isDependent?: boolean;

  @ApiProperty({ required: false, enum: HouseholdRole })
  @IsOptional()
  @IsEnum(HouseholdRole)
  householdRole?: HouseholdRole;
}
