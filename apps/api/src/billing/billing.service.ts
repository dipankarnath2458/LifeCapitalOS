import { Injectable, Logger } from '@nestjs/common';
import {
  defaultTierFeatures,
  parseFeatureKeys,
  resolveEntitlementsFromPlans,
  type FeatureKey,
  type PlanTier,
} from '@lcos/core';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { RazorpayService } from './razorpay.service';

const PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * BillingService — resolves a user's effective entitlements from their plan tier
 * plus any per-user feature overrides set in the admin panel, and drives the Razorpay
 * subscription lifecycle. In sandbox mode subscriptions activate immediately; in live
 * mode a Razorpay order is created and the webhook confirms payment.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly razorpay: RazorpayService,
    private readonly audit: AuditService,
  ) {}

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

    // Source per-tier features from the plans table so admins can change access by
    // editing a plan. Fall back to the code defaults for any tier with no features set.
    const plans = await this.prisma.plan.findMany();
    const planFeatures: Partial<Record<PlanTier, FeatureKey[]>> = {};
    for (const t of ['free', 'premium', 'family_cfo'] as PlanTier[]) {
      const plan = plans.find((p) => p.tier === t);
      const parsed = plan ? parseFeatureKeys(plan.features) : [];
      planFeatures[t] = parsed.length > 0 ? parsed : defaultTierFeatures(t);
    }

    const resolved = resolveEntitlementsFromPlans(tier, planFeatures, overrides);
    return { tier, features: Array.from(resolved.features) };
  }

  async plans() {
    const rows = await this.prisma.plan.findMany({ where: { active: true } });
    return rows.map((p) => ({ ...p, priceMinor: Number(p.priceMinor) }));
  }

  /**
   * Start a subscription. Free tier and sandbox mode activate immediately. In live mode
   * a Razorpay order is created and the subscription is left pending until the webhook
   * confirms payment; the returned `order` is what the client hands to Razorpay Checkout.
   */
  async subscribe(userId: string, tier: PlanTier) {
    const plan = await this.prisma.plan.findUnique({ where: { tier } });
    if (!plan) throw new Error(`Plan not found: ${tier}`);

    const priceMinor = Number(plan.priceMinor);
    const goLive = this.razorpay.live && tier !== 'free' && priceMinor > 0;

    if (!goLive) {
      const sub = await this.prisma.subscription.upsert({
        where: { userId },
        create: {
          userId,
          planId: plan.id,
          status: 'active',
          provider: 'razorpay',
          currentPeriodEnd: new Date(Date.now() + PERIOD_MS),
        },
        update: { planId: plan.id, status: 'active', currentPeriodEnd: new Date(Date.now() + PERIOD_MS) },
      });
      return { id: sub.id, tier, status: sub.status };
    }

    const order = await this.razorpay.createOrder(priceMinor, plan.currency, { userId, tier });
    const sub = await this.prisma.subscription.upsert({
      where: { userId },
      create: { userId, planId: plan.id, status: 'trialing', provider: 'razorpay', providerSubscriptionId: order.id },
      update: { planId: plan.id, status: 'trialing', providerSubscriptionId: order.id },
    });
    return {
      id: sub.id,
      tier,
      status: 'pending_payment',
      order: { id: order.id, amount: order.amount, currency: order.currency, keyId: this.razorpay.keyId },
    };
  }

  /** Cancel the user's subscription; entitlements fall back to the free tier. */
  async cancel(userId: string) {
    await this.prisma.subscription.updateMany({ where: { userId }, data: { status: 'canceled' } });
    await this.audit.log({ actorId: userId, action: 'subscription.canceled', entityType: 'subscription', entityId: userId });
    return { status: 'canceled' };
  }

  /**
   * Apply a verified Razorpay webhook event. Confirms payment (activating the
   * subscription) or records a failure/cancellation. Idempotent by design — replaying
   * the same event simply re-asserts the resulting status.
   */
  async applyWebhookEvent(event: RazorpayWebhookEvent): Promise<void> {
    const orderId = extractOrderId(event);
    if (!orderId) {
      this.logger.warn(`Webhook ${event.event} had no resolvable order id; ignoring.`);
      return;
    }
    const sub = await this.prisma.subscription.findFirst({ where: { providerSubscriptionId: orderId } });
    if (!sub) {
      this.logger.warn(`Webhook ${event.event} for unknown order ${orderId}; ignoring.`);
      return;
    }

    if (event.event === 'order.paid' || event.event === 'payment.captured') {
      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: { status: 'active', currentPeriodEnd: new Date(Date.now() + PERIOD_MS) },
      });
      await this.audit.log({ actorId: sub.userId, action: 'subscription.activated', entityType: 'subscription', entityId: sub.id });
    } else if (event.event === 'payment.failed') {
      await this.prisma.subscription.update({ where: { id: sub.id }, data: { status: 'past_due' } });
      await this.audit.log({ actorId: sub.userId, action: 'subscription.payment_failed', entityType: 'subscription', entityId: sub.id });
    }
  }
}

export interface RazorpayWebhookEvent {
  event: string;
  payload?: {
    order?: { entity?: { id?: string } };
    payment?: { entity?: { id?: string; order_id?: string } };
  };
}

/** Resolve the Razorpay order id from the various event payload shapes. */
function extractOrderId(event: RazorpayWebhookEvent): string | undefined {
  return event.payload?.order?.entity?.id ?? event.payload?.payment?.entity?.order_id;
}
