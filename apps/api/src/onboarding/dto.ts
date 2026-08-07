import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

export class ProvisionHouseholdDto {
  @ApiProperty({ required: false, description: 'What the family calls itself. Defaults to the profile name.' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  familyName?: string;

  @ApiProperty({ required: false, default: 'INR' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  baseCurrency?: string;
}
