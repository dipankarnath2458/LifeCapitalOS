import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export class CreateHouseholdDto {
  @ApiProperty({ description: 'Family/household name (stored encrypted)' })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiProperty({ required: false, description: 'Assigned advisor (a firm member user id)' })
  @IsOptional()
  @IsString()
  advisorId?: string;

  @ApiProperty({ required: false, default: 'INR' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  baseCurrency?: string;
}

export class UpdateHouseholdDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  baseCurrency?: string;

  @ApiProperty({ required: false, enum: ['active', 'archived'] })
  @IsOptional()
  @IsIn(['active', 'archived'])
  status?: 'active' | 'archived';
}

export class AssignHouseholdDto {
  @ApiProperty({ description: 'The firm member to assign as the household advisor' })
  @IsString()
  advisorId!: string;
}
