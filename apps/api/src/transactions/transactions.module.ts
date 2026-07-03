import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Post,
  Query,
} from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { summarizeCashflow, type CurrencyCode } from '@lcos/core';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser } from '../common/decorators';

const TX_TYPES = ['income', 'expense', 'transfer'] as const;

class CreateTransactionDto {
  @ApiProperty() @IsString() accountId!: string;
  @ApiProperty({ enum: TX_TYPES }) @IsEnum(TX_TYPES) type!: (typeof TX_TYPES)[number];
  @ApiProperty() @IsInt() amountMinor!: number;
  @ApiProperty({ default: 'INR' }) @IsString() currency = 'INR';
  @ApiProperty() @IsString() category!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() note?: string;
  @ApiProperty() @IsString() occurredAt!: string;
}

@Injectable()
class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, limit = 100) {
    const rows = await this.prisma.transaction.findMany({
      where: { userId },
      orderBy: { occurredAt: 'desc' },
      take: Math.min(limit, 500),
    });
    return rows.map((t) => ({ ...t, amountMinor: Number(t.amountMinor) }));
  }

  async create(userId: string, dto: CreateTransactionDto) {
    // A transaction may only be attached to an account the caller owns.
    const account = await this.prisma.account.findUnique({ where: { id: dto.accountId } });
    if (!account) throw new NotFoundException('Account not found');
    if (account.userId !== userId) throw new ForbiddenException();

    const tx = await this.prisma.transaction.create({
      data: {
        userId,
        accountId: dto.accountId,
        type: dto.type,
        amountMinor: BigInt(dto.amountMinor),
        currency: dto.currency,
        category: dto.category,
        note: dto.note,
        occurredAt: new Date(dto.occurredAt),
      },
    });
    return { ...tx, amountMinor: Number(tx.amountMinor) };
  }

  /** Cashflow summary over the user's transactions (budgeting view). */
  async summary(userId: string) {
    const profile = await this.prisma.profile.findUnique({ where: { userId } });
    const currency = (profile?.baseCurrency as CurrencyCode) ?? 'INR';
    const rows = await this.prisma.transaction.findMany({ where: { userId } });
    return summarizeCashflow(
      rows.map((t) => ({
        type: t.type,
        amountMinor: Number(t.amountMinor),
        category: t.category,
      })),
      currency,
    );
  }
}

@ApiTags('transactions')
@Controller('transactions')
class TransactionsController {
  constructor(private readonly txs: TransactionsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('limit') limit?: string) {
    return this.txs.list(user.id, limit ? parseInt(limit, 10) : undefined);
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.txs.summary(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTransactionDto) {
    return this.txs.create(user.id, dto);
  }
}

@Module({
  controllers: [TransactionsController],
  providers: [TransactionsService],
})
export class TransactionsModule {}
