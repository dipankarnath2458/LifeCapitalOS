import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Account, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/decorators';
import { FirmContext } from '../firms/firm-context.decorators';
import { CreateHouseholdAccountDto, UpdateHouseholdAccountDto } from './household-accounts.dto';

/** Serialize BigInt money to number at the boundary. */
function serialize(a: Account) {
  return {
    id: a.id,
    householdId: a.householdId,
    firmId: a.firmId,
    entityId: a.entityId,
    name: a.name,
    type: a.type,
    assetClass: a.assetClass,
    currency: a.currency,
    balanceMinor: Number(a.balanceMinor),
    isLiability: a.isLiability,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

@Injectable()
export class HouseholdAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** An entity referenced by an account must belong to the same household. */
  private async assertEntityInHousehold(householdId: string, entityId: string) {
    const entity = await this.prisma.entity.findUnique({ where: { id: entityId } });
    if (!entity || entity.householdId !== householdId) {
      throw new BadRequestException('entityId is not an entity of this household');
    }
  }

  /** Load an account and confirm it belongs to the path household (no cross-household access). */
  private async owned(householdId: string, accountId: string): Promise<Account> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.householdId !== householdId) {
      throw new NotFoundException('Account not found');
    }
    return account;
  }

  async list(householdId: string) {
    const rows = await this.prisma.account.findMany({
      where: { householdId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(serialize);
  }

  async create(
    actor: AuthUser,
    firm: FirmContext,
    householdId: string,
    dto: CreateHouseholdAccountDto,
    ip?: string,
  ) {
    if (dto.entityId) await this.assertEntityInHousehold(householdId, dto.entityId);
    const account = await this.prisma.account.create({
      data: {
        householdId,
        firmId: firm.firmId,
        entityId: dto.entityId ?? null,
        name: dto.name,
        type: dto.type as Prisma.AccountCreateInput['type'],
        assetClass: dto.assetClass as Prisma.AccountCreateInput['assetClass'],
        currency: dto.currency ?? 'INR',
        balanceMinor: BigInt(dto.balanceMinor),
        isLiability: dto.isLiability ?? false,
      },
    });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'household.account.create',
      entityType: 'Account',
      entityId: account.id,
      metadata: { firmId: firm.firmId, householdId, entityId: dto.entityId ?? null },
      ip,
    });
    return serialize(account);
  }

  async update(
    actor: AuthUser,
    firm: FirmContext,
    householdId: string,
    accountId: string,
    dto: UpdateHouseholdAccountDto,
    ip?: string,
  ) {
    await this.owned(householdId, accountId);
    if (dto.entityId) await this.assertEntityInHousehold(householdId, dto.entityId);
    const account = await this.prisma.account.update({
      where: { id: accountId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.balanceMinor !== undefined ? { balanceMinor: BigInt(dto.balanceMinor) } : {}),
        ...(dto.assetClass !== undefined
          ? { assetClass: dto.assetClass as Prisma.AccountUpdateInput['assetClass'] }
          : {}),
        ...(dto.isLiability !== undefined ? { isLiability: dto.isLiability } : {}),
        ...(dto.entityId !== undefined ? { entityId: dto.entityId } : {}),
      },
    });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'household.account.update',
      entityType: 'Account',
      entityId: accountId,
      metadata: { firmId: firm.firmId, householdId, fields: Object.keys(dto) },
      ip,
    });
    return serialize(account);
  }

  async remove(
    actor: AuthUser,
    firm: FirmContext,
    householdId: string,
    accountId: string,
    ip?: string,
  ) {
    await this.owned(householdId, accountId);
    await this.prisma.account.delete({ where: { id: accountId } });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'household.account.delete',
      entityType: 'Account',
      entityId: accountId,
      metadata: { firmId: firm.firmId, householdId },
      ip,
    });
    return { ok: true };
  }
}
