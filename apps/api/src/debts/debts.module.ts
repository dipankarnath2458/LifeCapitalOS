import { Body, Controller, Get, Injectable, Module, Post, Query } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNumber, IsString } from 'class-validator';
import { compareDebtStrategies, type CurrencyCode, type DebtInput } from '@lcos/core';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser } from '../common/decorators';

const DEBT_TYPES = [
  'home_loan',
  'personal_loan',
  'vehicle_loan',
  'education_loan',
  'credit_card',
  'other',
] as const;

class CreateDebtDto {
  @ApiProperty() @IsString() name!: string;
  @ApiProperty({ enum: DEBT_TYPES }) @IsEnum(DEBT_TYPES) type!: (typeof DEBT_TYPES)[number];
  @ApiProperty({ default: 'INR' }) @IsString() currency = 'INR';
  @ApiProperty() @IsInt() principalMinor!: number;
  @ApiProperty() @IsNumber() annualInterestRatePct!: number;
  @ApiProperty() @IsInt() minimumPaymentMinor!: number;
}

@Injectable()
class DebtsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const rows = await this.prisma.debt.findMany({ where: { userId } });
    return rows.map((d) => ({
      ...d,
      principalMinor: Number(d.principalMinor),
      minimumPaymentMinor: Number(d.minimumPaymentMinor),
    }));
  }

  async create(userId: string, dto: CreateDebtDto) {
    const debt = await this.prisma.debt.create({
      data: {
        userId,
        name: dto.name,
        type: dto.type,
        currency: dto.currency,
        principalMinor: BigInt(dto.principalMinor),
        annualInterestRatePct: dto.annualInterestRatePct,
        minimumPaymentMinor: BigInt(dto.minimumPaymentMinor),
      },
    });
    return {
      ...debt,
      principalMinor: Number(debt.principalMinor),
      minimumPaymentMinor: Number(debt.minimumPaymentMinor),
    };
  }

  /** Snowball vs avalanche payoff plan for all of the user's debts. */
  async payoffPlan(userId: string, extraMonthlyMinor: number) {
    const rows = await this.prisma.debt.findMany({ where: { userId } });
    const currency = (rows[0]?.currency as CurrencyCode) ?? 'INR';
    const debts: DebtInput[] = rows.map((d) => ({
      id: d.id,
      name: d.name,
      principalMinor: Number(d.principalMinor),
      annualInterestRatePct: d.annualInterestRatePct,
      minimumPaymentMinor: Number(d.minimumPaymentMinor),
    }));
    return compareDebtStrategies(debts, extraMonthlyMinor, currency);
  }
}

@ApiTags('debts')
@Controller('debts')
class DebtsController {
  constructor(private readonly debts: DebtsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.debts.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDebtDto) {
    return this.debts.create(user.id, dto);
  }

  @Get('payoff-plan')
  payoff(@CurrentUser() user: AuthUser, @Query('extraMonthlyMinor') extra?: string) {
    return this.debts.payoffPlan(user.id, extra ? parseInt(extra, 10) : 0);
  }
}

@Module({
  controllers: [DebtsController],
  providers: [DebtsService],
})
export class DebtsModule {}
