import { Injectable, NotFoundException } from '@nestjs/common';
import { HouseholdMember } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/decorators';
import { FirmContext } from '../firms/firm-context.decorators';
import { CreateHouseholdMemberDto, UpdateHouseholdMemberDto } from './household-members.dto';

@Injectable()
export class HouseholdMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  private serialize(m: HouseholdMember) {
    return {
      id: m.id,
      householdId: m.householdId,
      userId: m.userId,
      name: this.crypto.decrypt(m.name),
      relation: m.relation,
      dateOfBirth: m.dateOfBirth,
      isDependent: m.isDependent,
      householdRole: m.householdRole,
    };
  }

  /** Load a member and confirm it belongs to the path household (no cross-household access). */
  private async owned(householdId: string, memberId: string) {
    const member = await this.prisma.householdMember.findUnique({ where: { id: memberId } });
    if (!member || member.householdId !== householdId) {
      throw new NotFoundException('Member not found');
    }
    return member;
  }

  async list(householdId: string) {
    const rows = await this.prisma.householdMember.findMany({
      where: { householdId },
      orderBy: { id: 'asc' },
    });
    return rows.map((m) => this.serialize(m));
  }

  async create(
    actor: AuthUser,
    firm: FirmContext,
    householdId: string,
    dto: CreateHouseholdMemberDto,
    ip?: string,
  ) {
    const member = await this.prisma.householdMember.create({
      data: {
        householdId,
        name: this.crypto.encrypt(dto.name)!,
        relation: dto.relation,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
        isDependent: dto.isDependent ?? true,
        ...(dto.householdRole ? { householdRole: dto.householdRole } : {}),
      },
    });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'household.member.create',
      entityType: 'HouseholdMember',
      entityId: member.id,
      metadata: { firmId: firm.firmId, householdId },
      ip,
    });
    return this.serialize(member);
  }

  async update(
    actor: AuthUser,
    firm: FirmContext,
    householdId: string,
    memberId: string,
    dto: UpdateHouseholdMemberDto,
    ip?: string,
  ) {
    await this.owned(householdId, memberId);
    const member = await this.prisma.householdMember.update({
      where: { id: memberId },
      data: {
        ...(dto.name !== undefined ? { name: this.crypto.encrypt(dto.name)! } : {}),
        ...(dto.relation !== undefined ? { relation: dto.relation } : {}),
        ...(dto.dateOfBirth !== undefined ? { dateOfBirth: new Date(dto.dateOfBirth) } : {}),
        ...(dto.isDependent !== undefined ? { isDependent: dto.isDependent } : {}),
        ...(dto.householdRole !== undefined ? { householdRole: dto.householdRole } : {}),
      },
    });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'household.member.update',
      entityType: 'HouseholdMember',
      entityId: memberId,
      metadata: { firmId: firm.firmId, householdId, fields: Object.keys(dto) },
      ip,
    });
    return this.serialize(member);
  }

  async remove(actor: AuthUser, firm: FirmContext, householdId: string, memberId: string, ip?: string) {
    await this.owned(householdId, memberId);
    await this.prisma.householdMember.delete({ where: { id: memberId } });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'household.member.delete',
      entityType: 'HouseholdMember',
      entityId: memberId,
      metadata: { firmId: firm.firmId, householdId },
      ip,
    });
    return { ok: true };
  }
}
