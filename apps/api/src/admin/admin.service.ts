import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { allFeatureKeys } from '@lcos/core';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';

interface Actor {
  id: string;
  role: Role;
}

/**
 * Admin operations — the backend behind the "full control" panel. Every mutating
 * action is recorded in the append-only audit log.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
  ) {}

  // ---- Users ----

  async listUsers(query: { search?: string; skip?: number; take?: number }) {
    const where: Prisma.UserWhereInput = query.search
      ? {
          OR: [
            { email: { contains: query.search, mode: 'insensitive' } },
            { phone: { contains: query.search } },
          ],
        }
      : {};
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: query.skip ?? 0,
        take: Math.min(query.take ?? 25, 100),
        orderBy: { createdAt: 'desc' },
        include: { subscription: { include: { plan: true } }, profile: true },
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      total,
      data: rows.map((u) => ({
        id: u.id,
        email: u.email,
        phone: u.phone,
        role: u.role,
        status: u.status,
        tier: u.subscription?.plan.tier ?? 'free',
        fullName: u.profile ? this.crypto.decrypt(u.profile.fullName) : null,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
      })),
    };
  }

  async setUserStatus(actor: Actor, userId: string, status: 'active' | 'suspended') {
    const user = await this.prisma.user.update({ where: { id: userId }, data: { status } });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: `user.${status === 'suspended' ? 'suspend' : 'reactivate'}`,
      entityType: 'User',
      entityId: userId,
    });
    return { id: user.id, status: user.status };
  }

  async setUserRole(actor: Actor, userId: string, role: Role) {
    const user = await this.prisma.user.update({ where: { id: userId }, data: { role } });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'user.role_change',
      entityType: 'User',
      entityId: userId,
      metadata: { role },
    });
    return { id: user.id, role: user.role };
  }

  /** DPDP / GDPR data export — returns all data held about a user. */
  async exportUserData(actor: Actor, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        accounts: true,
        transactions: true,
        debts: true,
        goals: true,
        familyMembers: true,
        consents: true,
        subscription: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'user.data_export',
      entityType: 'User',
      entityId: userId,
    });
    return JSON.parse(
      JSON.stringify(user, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)),
    );
  }

  /** DPDP / GDPR erasure — soft-delete + cascade hard delete of personal records. */
  async eraseUser(actor: Actor, userId: string) {
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'user.erase',
      entityType: 'User',
      entityId: userId,
    });
    await this.prisma.user.delete({ where: { id: userId } });
    return { ok: true };
  }

  async setFeatureOverride(actor: Actor, userId: string, feature: string, enabled: boolean) {
    const row = await this.prisma.featureOverride.upsert({
      where: { userId_feature: { userId, feature } },
      create: { userId, feature, enabled },
      update: { enabled },
    });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'user.feature_override',
      entityType: 'User',
      entityId: userId,
      metadata: { feature, enabled },
    });
    return row;
  }

  // ---- Plans ----

  async listPlans() {
    const rows = await this.prisma.plan.findMany({ orderBy: { priceMinor: 'asc' } });
    return rows.map((p) => ({ ...p, priceMinor: Number(p.priceMinor) }));
  }

  async updatePlan(
    actor: Actor,
    id: string,
    data: { name?: string; priceMinor?: number; active?: boolean; features?: unknown },
  ) {
    const plan = await this.prisma.plan.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.priceMinor !== undefined ? { priceMinor: BigInt(data.priceMinor) } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
        ...(data.features !== undefined ? { features: data.features as Prisma.InputJsonValue } : {}),
      },
    });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'plan.update',
      entityType: 'Plan',
      entityId: id,
      metadata: data as Record<string, unknown>,
    });
    return { ...plan, priceMinor: Number(plan.priceMinor) };
  }

  // ---- Feature flags / remote config ----

  async listFlags() {
    return this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
  }

  async upsertFlag(
    actor: Actor,
    key: string,
    data: { enabled?: boolean; description?: string; payload?: unknown },
  ) {
    const flag = await this.prisma.featureFlag.upsert({
      where: { key },
      create: {
        key,
        enabled: data.enabled ?? false,
        description: data.description,
        payload: data.payload as Prisma.InputJsonValue,
      },
      update: {
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.payload !== undefined ? { payload: data.payload as Prisma.InputJsonValue } : {}),
      },
    });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'flag.upsert',
      entityType: 'FeatureFlag',
      entityId: key,
      metadata: data as Record<string, unknown>,
    });
    return flag;
  }

  // ---- Analytics ----

  async metrics() {
    const [totalUsers, activeUsers, paidSubs, snapshots] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: 'active' } }),
      this.prisma.subscription.count({ where: { status: 'active' } }),
      this.prisma.netWorthSnapshot.count(),
    ]);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dau = await this.prisma.user.count({ where: { lastLoginAt: { gte: since } } });
    return {
      totalUsers,
      activeUsers,
      paidSubscriptions: paidSubs,
      monthlyActiveUsers: dau,
      netWorthSnapshots: snapshots,
      conversionRate: totalUsers > 0 ? paidSubs / totalUsers : 0,
    };
  }

  // ---- Audit log ----

  async auditLog(query: { skip?: number; take?: number; action?: string }) {
    const where: Prisma.AuditLogWhereInput = query.action ? { action: query.action } : {};
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip: query.skip ?? 0,
        take: Math.min(query.take ?? 50, 200),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { total, data: rows };
  }

  availableFeatures() {
    return allFeatureKeys();
  }
}
