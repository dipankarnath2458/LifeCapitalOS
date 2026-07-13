import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/decorators';
import { CreateFirmDto, UpdateFirmDto } from './firms.dto';

/** Public shape of a firm (no secrets; timestamps serialize as ISO strings). */
function serializeFirm(f: {
  id: string;
  name: string;
  brandName: string | null;
  logoKey: string | null;
  baseCurrency: string;
  reviewCadence: string;
  status: string;
  planId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: f.id,
    name: f.name,
    brandName: f.brandName,
    logoKey: f.logoKey,
    baseCurrency: f.baseCurrency,
    reviewCadence: f.reviewCadence,
    status: f.status,
    planId: f.planId,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}

@Injectable()
export class FirmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Platform-admin provisioning: create a firm and seat its owner. */
  async create(actor: AuthUser, dto: CreateFirmDto, ip?: string) {
    const owner = await this.prisma.user.findUnique({ where: { id: dto.ownerUserId } });
    if (!owner) throw new BadRequestException('ownerUserId does not reference an existing user');

    const firm = await this.prisma.$transaction(async (tx) => {
      const created = await tx.firm.create({
        data: {
          name: dto.name,
          brandName: dto.brandName ?? null,
          baseCurrency: dto.baseCurrency ?? 'INR',
          reviewCadence: dto.reviewCadence ?? 'quarterly',
        },
      });
      await tx.membership.create({
        data: { firmId: created.id, userId: dto.ownerUserId, firmRole: 'OWNER', status: 'active' },
      });
      return created;
    });

    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'firm.create',
      entityType: 'Firm',
      entityId: firm.id,
      metadata: { firmId: firm.id, ownerUserId: dto.ownerUserId },
      ip,
    });
    return serializeFirm(firm);
  }

  /** Firms the caller belongs to, with their firm role, plus the active firm id. */
  async listMine(user: AuthUser) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId: user.id, status: 'active' },
      include: { firm: true },
      orderBy: { invitedAt: 'asc' },
    });
    return {
      activeFirmId: user.activeFirmId ?? null,
      firms: memberships.map((m) => ({ ...serializeFirm(m.firm), firmRole: m.firmRole })),
    };
  }

  /** Firm detail. Membership is already verified by FirmContextGuard. */
  async get(firmId: string) {
    const firm = await this.prisma.firm.findUnique({ where: { id: firmId } });
    if (!firm) throw new NotFoundException('Firm not found');
    return serializeFirm(firm);
  }

  /** Update firm settings (OWNER-gated by the controller). */
  async update(actor: AuthUser, firmId: string, dto: UpdateFirmDto, ip?: string) {
    const firm = await this.prisma.firm.update({
      where: { id: firmId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.brandName !== undefined ? { brandName: dto.brandName } : {}),
        ...(dto.baseCurrency !== undefined ? { baseCurrency: dto.baseCurrency } : {}),
        ...(dto.reviewCadence !== undefined ? { reviewCadence: dto.reviewCadence } : {}),
      },
    });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'firm.update',
      entityType: 'Firm',
      entityId: firmId,
      metadata: { firmId, fields: Object.keys(dto) },
      ip,
    });
    return serializeFirm(firm);
  }

  /** Set the caller's active firm context. Membership is verified by the guard. */
  async switchActive(actor: AuthUser, firmId: string, ip?: string) {
    await this.prisma.user.update({ where: { id: actor.id }, data: { activeFirmId: firmId } });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'firm.switch',
      entityType: 'Firm',
      entityId: firmId,
      metadata: { firmId },
      ip,
    });
    return { activeFirmId: firmId };
  }
}
