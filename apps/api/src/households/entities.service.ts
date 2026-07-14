import { Injectable, NotFoundException } from '@nestjs/common';
import { Entity } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/decorators';
import { FirmContext } from '../firms/firm-context.decorators';
import { CreateEntityDto, UpdateEntityDto } from './entities.dto';

@Injectable()
export class EntitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  private serialize(e: Entity) {
    return {
      id: e.id,
      householdId: e.householdId,
      firmId: e.firmId,
      name: this.crypto.decrypt(e.name),
      type: e.type,
      taxId: this.crypto.decrypt(e.taxId),
      createdAt: e.createdAt,
    };
  }

  /** Load an entity and confirm it belongs to the path household. */
  private async owned(householdId: string, entityId: string) {
    const entity = await this.prisma.entity.findUnique({ where: { id: entityId } });
    if (!entity || entity.householdId !== householdId) {
      throw new NotFoundException('Entity not found');
    }
    return entity;
  }

  async list(householdId: string) {
    const rows = await this.prisma.entity.findMany({
      where: { householdId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((e) => this.serialize(e));
  }

  async create(actor: AuthUser, firm: FirmContext, householdId: string, dto: CreateEntityDto, ip?: string) {
    const entity = await this.prisma.entity.create({
      data: {
        householdId,
        firmId: firm.firmId,
        name: this.crypto.encrypt(dto.name)!,
        ...(dto.type ? { type: dto.type } : {}),
        taxId: this.crypto.encrypt(dto.taxId),
      },
    });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'household.entity.create',
      entityType: 'Entity',
      entityId: entity.id,
      metadata: { firmId: firm.firmId, householdId, type: entity.type },
      ip,
    });
    return this.serialize(entity);
  }

  async update(
    actor: AuthUser,
    firm: FirmContext,
    householdId: string,
    entityId: string,
    dto: UpdateEntityDto,
    ip?: string,
  ) {
    await this.owned(householdId, entityId);
    const entity = await this.prisma.entity.update({
      where: { id: entityId },
      data: {
        ...(dto.name !== undefined ? { name: this.crypto.encrypt(dto.name)! } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.taxId !== undefined ? { taxId: this.crypto.encrypt(dto.taxId) } : {}),
      },
    });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'household.entity.update',
      entityType: 'Entity',
      entityId,
      metadata: { firmId: firm.firmId, householdId, fields: Object.keys(dto) },
      ip,
    });
    return this.serialize(entity);
  }

  async remove(actor: AuthUser, firm: FirmContext, householdId: string, entityId: string, ip?: string) {
    await this.owned(householdId, entityId);
    await this.prisma.entity.delete({ where: { id: entityId } });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'household.entity.delete',
      entityType: 'Entity',
      entityId,
      metadata: { firmId: firm.firmId, householdId },
      ip,
    });
    return { ok: true };
  }
}
