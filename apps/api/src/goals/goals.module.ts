import { Body, Controller, Delete, Get, Injectable, Module, Param, Post } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNumber, IsOptional, IsString } from 'class-validator';
import { planGoal, type CurrencyCode } from '@lcos/core';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser } from '../common/decorators';

const GOAL_TYPES = [
  'retirement',
  'child_education',
  'child_marriage',
  'home_purchase',
  'emergency_fund',
  'travel',
  'custom',
] as const;

class CreateGoalDto {
  @ApiProperty() @IsString() name!: string;
  @ApiProperty({ enum: GOAL_TYPES }) @IsEnum(GOAL_TYPES) type!: (typeof GOAL_TYPES)[number];
  @ApiProperty({ default: 'INR' }) @IsString() currency = 'INR';
  @ApiProperty() @IsInt() targetAmountMinor!: number;
  @ApiProperty({ default: 0 }) @IsInt() currentAmountMinor = 0;
  @ApiProperty({ description: 'ISO date' }) @IsString() targetDate!: string;
  @ApiProperty({ default: 10 }) @IsOptional() @IsNumber() expectedAnnualReturnPct = 10;
}

const monthsBetween = (from: Date, to: Date) =>
  Math.max(1, Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24 * 30.44)));

@Injectable()
class GoalsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Each goal enriched with its SIP plan and a slippage estimate (for the warning system). */
  async list(userId: string) {
    const rows = await this.prisma.goal.findMany({ where: { userId }, orderBy: { targetDate: 'asc' } });
    const now = new Date();
    return rows.map((g) => {
      const plan = planGoal({
        targetAmountMinor: Number(g.targetAmountMinor),
        currentAmountMinor: Number(g.currentAmountMinor),
        monthsRemaining: monthsBetween(now, g.targetDate),
        expectedAnnualReturnPct: g.expectedAnnualReturnPct,
        currency: g.currency as CurrencyCode,
      });
      return {
        id: g.id,
        name: g.name,
        type: g.type,
        currency: g.currency,
        targetAmountMinor: Number(g.targetAmountMinor),
        currentAmountMinor: Number(g.currentAmountMinor),
        targetDate: g.targetDate,
        expectedAnnualReturnPct: g.expectedAnnualReturnPct,
        plan,
      };
    });
  }

  async create(userId: string, dto: CreateGoalDto) {
    const g = await this.prisma.goal.create({
      data: {
        userId,
        name: dto.name,
        type: dto.type,
        currency: dto.currency,
        targetAmountMinor: BigInt(dto.targetAmountMinor),
        currentAmountMinor: BigInt(dto.currentAmountMinor ?? 0),
        targetDate: new Date(dto.targetDate),
        expectedAnnualReturnPct: dto.expectedAnnualReturnPct ?? 10,
      },
    });
    return { id: g.id };
  }

  async remove(userId: string, id: string) {
    await this.prisma.goal.deleteMany({ where: { id, userId } });
    return { ok: true };
  }
}

@ApiTags('goals')
@Controller('goals')
class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.goals.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateGoalDto) {
    return this.goals.create(user.id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.goals.remove(user.id, id);
  }
}

@Module({
  controllers: [GoalsController],
  providers: [GoalsService],
})
export class GoalsModule {}
