import { ApiProperty } from '@nestjs/swagger';
import { FirmRole } from '@prisma/client';
import { IsEmail, IsEnum, IsIn, IsOptional } from 'class-validator';

export class CreateInvitationDto {
  @ApiProperty({ description: 'Email of an existing user to invite into the firm' })
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: FirmRole })
  @IsEnum(FirmRole)
  firmRole!: FirmRole;
}

export class UpdateMembershipDto {
  @ApiProperty({ enum: FirmRole, required: false })
  @IsOptional()
  @IsEnum(FirmRole)
  firmRole?: FirmRole;

  @ApiProperty({ required: false, enum: ['active', 'disabled'] })
  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: 'active' | 'disabled';
}
