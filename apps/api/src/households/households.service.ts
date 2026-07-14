import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Household } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/decorators';
import { FirmContext } from '../firms/firm-context.decorators';
import { AssignHouseholdDto, CreateHouseholdDto, UpdateHouseholdDto } from './households.dto';

/** Firm roles that write households (create/edit). Read scope is enforced by the guard. */
const WRITE_ROLES = ['OWNER', 'ADVISOR'];

@Injectable()
export class HouseholdsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  /** Public shape with the family name decrypted at the boundary. */
  private serialize(h: Household) {
    return {
      id: h.id,
      firmId: h.firmId,
      name: this.crypto.decrypt(h.name),
      advisorId: h.advisorId,
      baseCurrency: h.baseCurrency,
      status: h.status,
      createdAt: h.createdAt,
      updatedAt: h.updatedAt,
    };
  }

  /** Verify a user is an active member of the firm before assigning them a book. */
  private async assertFirmMember(firmId: string, userId: string) {
    const m = await this.prisma.membership.findUnique({
      where: { firmId_userId: { firmId, userId } },
    });
    if (!m || m.status !== 'active') {
      throw new BadRequestException('advisorId is not an active member of this firm');
    }
  }

  async create(actor: AuthUser, firm: FirmContext, dto: CreateHouseholdDto, ip?: string) {
    // An advisor creating a household owns it by default; an owner may leave it
    // unassigned or name any firm member.
    let advisorId = dto.advisorId ?? null;
    if (!advisorId && firm.firmRole === 'ADVISOR') advisorId = actor.id;
    if (advisorId) await this.assertFirmMember(firm.firmId, advisorId);

    const household = await this.prisma.household.create({
      data: {
        firmId: firm.firmId,
        name: this.crypto.encrypt(dto.name)!,
        advisorId,
        baseCurrency: dto.baseCurrency ?? 'INR',
      },
    });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'household.create',
      entityType: 'Household',
      entityId: household.id,
      metadata: { firmId: firm.firmId, advisorId },
      ip,
    });
    return this.serialize(household);
  }

  /** Book listing, firm-scoped and intersected with the caller's assignment. */
  async list(
    actor: AuthUser,
    firm: FirmContext,
    opts: { skip: number; take: number; advisorId?: string; status?: string },
  ) {
    const firmWide = firm.firmRole === 'OWNER' || firm.firmRole === 'ANALYST';
    const where = {
      firmId: firm.firmId,
      status: opts.status ?? { not: 'deleted' },
      // ADVISOR/SUPPORT are limited to their own book; a firm-wide role may filter
      // by advisor explicitly.
      ...(firmWide ? (opts.advisorId ? { advisorId: opts.advisorId } : {}) : { advisorId: actor.id }),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.household.count({ where }),
      this.prisma.household.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: opts.skip,
        take: opts.take,
      }),
    ]);
    return { total, data: rows.map((h) => this.serialize(h)) };
  }

  get(household: Household) {
    return this.serialize(household);
  }

  async update(actor: AuthUser, firm: FirmContext, householdId: string, dto: UpdateHouseholdDto, ip?: string) {
    const household = await this.prisma.household.update({
      where: { id: householdId },
      data: {
        ...(dto.name !== undefined ? { name: this.crypto.encrypt(dto.name)! } : {}),
        ...(dto.baseCurrency !== undefined ? { baseCurrency: dto.baseCurrency } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'household.update',
      entityType: 'Household',
      entityId: householdId,
      metadata: { firmId: firm.firmId, fields: Object.keys(dto) },
      ip,
    });
    return this.serialize(household);
  }

  /** Reassign the advisor. The change (from -> to) is recorded in the audit log. */
  async assign(actor: AuthUser, firm: FirmContext, current: Household, dto: AssignHouseholdDto, ip?: string) {
    await this.assertFirmMember(firm.firmId, dto.advisorId);
    const household = await this.prisma.household.update({
      where: { id: current.id },
      data: { advisorId: dto.advisorId },
    });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'household.assign',
      entityType: 'Household',
      entityId: current.id,
      metadata: { firmId: firm.firmId, fromAdvisorId: current.advisorId, toAdvisorId: dto.advisorId },
      ip,
    });
    return this.serialize(household);
  }

  /** Soft-delete: the row and its children are retained but hidden from access. */
  async remove(actor: AuthUser, firm: FirmContext, householdId: string, ip?: string) {
    await this.prisma.household.update({ where: { id: householdId }, data: { status: 'deleted' } });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'household.delete',
      entityType: 'Household',
      entityId: householdId,
      metadata: { firmId: firm.firmId },
      ip,
    });
    return { ok: true };
  }

  static readonly WRITE_ROLES = WRITE_ROLES;
}
