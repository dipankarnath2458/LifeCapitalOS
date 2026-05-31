import { Injectable } from '@nestjs/common';
import {
  resolveEntitlements,
  type FeatureKey,
  type PlanTier,
} from '@lcos/core';
import { PrismaService } from '../prisma/prisma.service';

/**
 * BillingService — resolves a user's effective entitlements from their plan tier
 * plus any per-user feature overrides set in the admin panel. Payment-provider
 * integration (Razorpay/Play/App Store) plugs in here; sandbox mode is the default.
 */
@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  async tierFor(userId: string): Promise<PlanTier> {
    const sub = await this.prisma.subscription.findUnique({
      where: { userId },
      include: { plan: true },
    });
    if (!sub || sub.status === 'canceled') return 'free';
    return sub.plan.tier as PlanTier;
  }

  async entitlements(userId: string) {
    const tier = await this.tierFor(userId);
    const overrideRows = await this.prisma.featureOverride.findMany({ where: { userId } });
    const overrides: Partial<Record<FeatureKey, boolean>> = {};
    for (const o of overrideRows) overrides[o.feature as FeatureKey] = o.enabled;
    const resolved = resolveEntitlements(tier, overrides);
    return { tier, features: Array.from(resolved.features) };
  }

  async plans() {
    const rows = await this.prisma.plan.findMany({ where: { active: true } });
    return rows.map((p) => ({ ...p, priceMinor: Number(p.priceMinor) }));
  }

  /**
   * Create/activate a subscription. In sandbox mode this immediately activates;
   * in production it would create a Razorpay subscription and confirm via webhook.
   */
  async subscribe(userId: string, tier: PlanTier) {
    const plan = await this.prisma.plan.findUnique({ where: { tier } });
    if (!plan) throw new Error(`Plan not found: ${tier}`);
    const sub = await this.prisma.subscription.upsert({
      where: { userId },
      create: {
        userId,
        planId: plan.id,
        status: 'active',
        provider: 'razorpay',
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      update: { planId: plan.id, status: 'active' },
    });
    return { id: sub.id, tier, status: sub.status };
  }
}
