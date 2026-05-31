import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
} from 'class-validator';

export class RequestOtpDto {
  @ApiProperty({ enum: ['phone', 'email'] })
  @IsEnum(['phone', 'email'] as const)
  channel!: 'phone' | 'email';

  @ApiProperty({ example: '+919876543210' })
  @IsString()
  target!: string;
}

export class VerifyOtpDto {
  @ApiProperty({ enum: ['phone', 'email'] })
  @IsEnum(['phone', 'email'] as const)
  channel!: 'phone' | 'email';

  @ApiProperty({ example: '+919876543210' })
  @IsString()
  target!: string;

  @ApiProperty({ example: '123456' })
  @Length(6, 6)
  code!: string;
}

export class RegisterDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 8 })
  @MinLength(8)
  @Matches(/[0-9]/, { message: 'Password must contain a number' })
  password!: string;

  @ApiProperty()
  @IsString()
  fullName!: string;
}

export class LoginDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  password!: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  refreshToken!: string;
}

export class UpdateProfileDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  baseCurrency?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  annualIncomeMinor?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  monthlyExpensesMinor?: number;

  @ApiProperty({ required: false, enum: ['conservative', 'moderate', 'aggressive'] })
  @IsOptional()
  @IsEnum(['conservative', 'moderate', 'aggressive'] as const)
  riskTolerance?: 'conservative' | 'moderate' | 'aggressive';

  @ApiProperty({ required: false })
  @IsOptional()
  dependents?: number;
}
