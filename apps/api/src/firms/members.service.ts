import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FirmRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/decorators';
import { CreateInvitationDto, UpdateMembershipDto } from './members.dto';

/** Public shape of a firm membership row. */
function serializeMembership(m: {
  id: string;
  firmId: string;
  userId: string;
  firmRole: FirmRole;
  status: string;
  invitedAt: Date;
  user?: { email: string | null } | null;
}) {
  return {
    id: m.id,
    firmId: m.firmId,
    userId: m.userId,
    firmRole: m.firmRole,
    status: m.status,
    invitedAt: m.invitedAt,
    ...(m.user !== undefined ? { email: m.user?.email ?? null } : {}),
  };
}

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Roster of the firm's memberships (any active member may read). */
  async list(firmId: string) {
    const rows = await this.prisma.membership.findMany({
      where: { firmId },
      include: { user: { select: { email: true } } },
      orderBy: { invitedAt: 'asc' },
    });
    return rows.map(serializeMembership);
  }

  /**
   * Invite an existing user into the firm as a pending ("invited") membership.
   * Email-based invitations for brand-new users depend on the email transport
   * (M0) and are out of scope here.
   */
  async invite(actor: AuthUser, firmId: string, dto: CreateInvitationDto, ip?: string) {
    const invitee = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!invitee) {
      throw new NotFoundException('No user with that email; new-user invites require email (M0)');
    }

    const existing = await this.prisma.membership.findUnique({
      where: { firmId_userId: { firmId, userId: invitee.id } },
    });
    if (existing) throw new ConflictException('User is already a member of this firm');

    const membership = await this.prisma.membership.create({
      data: { firmId, userId: invitee.id, firmRole: dto.firmRole, status: 'invited' },
    });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'firm.member.invite',
      entityType: 'Membership',
      entityId: membership.id,
      metadata: { firmId, inviteeId: invitee.id, firmRole: dto.firmRole },
      ip,
    });
    return serializeMembership(membership);
  }

  /** The invited user accepts their own pending membership, activating it. */
  async accept(actor: AuthUser, firmId: string, ip?: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { firmId_userId: { firmId, userId: actor.id } },
    });
    if (!membership || membership.status !== 'invited') {
      throw new NotFoundException('No pending invitation for this firm');
    }
    const updated = await this.prisma.membership.update({
      where: { id: membership.id },
      data: { status: 'active' },
    });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'firm.member.accept',
      entityType: 'Membership',
      entityId: membership.id,
      metadata: { firmId },
      ip,
    });
    return serializeMembership(updated);
  }

  /** Change a member's firm role or status (OWNER-gated by the controller). */
  async update(
    actor: AuthUser,
    firmId: string,
    membershipId: string,
    dto: UpdateMembershipDto,
    ip?: string,
  ) {
    const membership = await this.prisma.membership.findUnique({ where: { id: membershipId } });
    if (!membership || membership.firmId !== firmId) {
      throw new NotFoundException('Membership not found');
    }

    // Guard the last active owner: the firm must never lose its final owner via a
    // demotion or a disable.
    const losesOwner =
      membership.firmRole === 'OWNER' &&
      membership.status === 'active' &&
      ((dto.firmRole !== undefined && dto.firmRole !== 'OWNER') || dto.status === 'disabled');
    if (losesOwner) {
      const otherActiveOwners = await this.prisma.membership.count({
        where: {
          firmId,
          firmRole: 'OWNER',
          status: 'active',
          id: { not: membership.id },
        },
      });
      if (otherActiveOwners === 0) {
        throw new BadRequestException('A firm must keep at least one active owner');
      }
    }

    const updated = await this.prisma.membership.update({
      where: { id: membershipId },
      data: {
        ...(dto.firmRole !== undefined ? { firmRole: dto.firmRole } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'firm.member.update',
      entityType: 'Membership',
      entityId: membershipId,
      metadata: { firmId, fields: Object.keys(dto) },
      ip,
    });
    return serializeMembership(updated);
  }
}
