import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAccountDto, UpdateAccountDto } from './accounts.dto';

/** Serialize BigInt money fields to numbers for JSON transport. */
function serialize<T extends { balanceMinor: bigint }>(a: T) {
  return { ...a, balanceMinor: Number(a.balanceMinor) };
}

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const rows = await this.prisma.account.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(serialize);
  }

  async create(userId: string, dto: CreateAccountDto) {
    const account = await this.prisma.account.create({
      data: {
        userId,
        name: dto.name,
        type: dto.type as Prisma.AccountCreateInput['type'],
        assetClass: dto.assetClass as Prisma.AccountCreateInput['assetClass'],
        currency: dto.currency,
        balanceMinor: BigInt(dto.balanceMinor),
        isLiability: dto.isLiability ?? false,
      },
    });
    return serialize(account);
  }

  private async ownedAccount(userId: string, id: string) {
    const account = await this.prisma.account.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('Account not found');
    if (account.userId !== userId) throw new ForbiddenException();
    return account;
  }

  async update(userId: string, id: string, dto: UpdateAccountDto) {
    await this.ownedAccount(userId, id);
    const account = await this.prisma.account.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.balanceMinor !== undefined ? { balanceMinor: BigInt(dto.balanceMinor) } : {}),
        ...(dto.assetClass !== undefined
          ? { assetClass: dto.assetClass as Prisma.AccountUpdateInput['assetClass'] }
          : {}),
      },
    });
    return serialize(account);
  }

  async remove(userId: string, id: string) {
    await this.ownedAccount(userId, id);
    await this.prisma.account.delete({ where: { id } });
    return { ok: true };
  }
}
