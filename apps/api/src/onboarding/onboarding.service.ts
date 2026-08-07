import { Injectable, Logger } from '@nestjs/common';
import { FirmRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/decorators';

export interface PersonalWorkspace {
  firmId: string;
  householdId: string;
  /** True when this call created the workspace; false when one already existed. */
  provisioned: boolean;
}

/**
 * Consumer onboarding — provisioning a personal household.
 *
 * ## Why a consumer needs a household at all
 *
 * ADR-010's retail/advisory duality is only partial. `Account`, `Transaction`, `Debt`,
 * `Budget` and `NetWorthSnapshot` are dual-keyed (`userId` OR `householdId`), but
 * **`FinancialSnapshot`, `Entity` and `FinancialHealthScore` are household-only**, with
 * `householdId` and `firmId` NOT NULL.
 *
 * The Financial Snapshot is the canonical read model that the Financial Intelligence Layer,
 * the health-score engine and every future AI feature consume. A consumer confined to the
 * retail (`userId`) path therefore cannot have a snapshot — and so cannot have a Wealth
 * Health Check, a health score, or AI insights.
 *
 * ## The two ways to fix that, and why this is the one
 *
 * The alternative was to relax `FinancialSnapshot`/`Entity` to be dual-keyed. That means
 * changing the frozen `schemaVersion 1` snapshot contract plus `HouseholdScopeGuard` and
 * the RLS lockdown — a redesign of the Financial Kernel, which is explicitly frozen.
 *
 * Instead each consumer gets a **personal firm**: one Firm, one OWNER Membership, one
 * Household. No schema change, no kernel change, and the consumer immediately inherits
 * every household-scoped engine that already exists and is already tested.
 *
 * The "firm" is an internal tenancy artifact. **A consumer must never see the word.** It is
 * not a fiction either — a single-family office is exactly what this models.
 */
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  /** The caller's existing workspace, or null when they have none. */
  async findWorkspace(userId: string): Promise<PersonalWorkspace | null> {
    const membership = await this.prisma.membership.findFirst({
      where: { userId, status: 'active' },
      orderBy: { invitedAt: 'asc' },
    });
    if (!membership) return null;

    const household = await this.prisma.household.findFirst({
      where: { firmId: membership.firmId, status: 'active' },
      orderBy: { createdAt: 'asc' },
    });
    if (!household) return null;

    return { firmId: membership.firmId, householdId: household.id, provisioned: false };
  }

  /**
   * Ensures the caller has a household, creating one if they do not.
   *
   * **Idempotent by contract.** A consumer double-clicking "Get started", or a retry after a
   * dropped response, must not end up with two households — which would silently split their
   * financial data across two snapshots with no way to merge them. Callers may call this
   * freely; the second call returns the first result with `provisioned: false`.
   *
   * Also deliberately safe for an ADVISOR who already belongs to a firm: they already have a
   * workspace, so this returns it rather than provisioning a second, personal one.
   */
  async ensurePersonalHousehold(
    actor: AuthUser,
    input: { familyName?: string; baseCurrency?: string },
    ip?: string,
  ): Promise<PersonalWorkspace> {
    // Fast path: the overwhelmingly common case is an already-onboarded user, and it should
    // not pay for a lock.
    const existing = await this.findWorkspace(actor.id);
    if (existing) return existing;

    const householdName = await this.resolveHouseholdName(actor, input.familyName);
    // Upper-cased: currency codes are compared and formatted as ISO 4217 elsewhere, and a
    // stored "inr" would silently mismatch every "INR" in the kernel.
    const baseCurrency = input.baseCurrency?.toUpperCase() ?? 'INR';

    // One transaction: a firm without a membership would lock the user out of their own
    // data, and a membership without a household would leave onboarding half-done with no
    // way for the user to retry into a consistent state.
    const workspace = await this.prisma.$transaction(async (tx) => {
      // Serialise per user. Without this, two concurrent submits BOTH pass the check above
      // under READ COMMITTED and BOTH create a household — splitting the family's accounts
      // across one and their snapshot across the other, with no error and no way to merge.
      // A regression test drives two simultaneous requests at this method.
      //
      // An advisory lock rather than a unique constraint because there is no natural unique
      // key here: an advisor may legitimately hold memberships in several firms, so
      // `Membership.userId` cannot be made unique. The lock is released when the
      // transaction ends, committed or not.
      //
      // `$executeRaw`, not `$queryRaw`: pg_advisory_xact_lock returns `void`, and Prisma
      // cannot deserialize a void column — it throws before ever taking the lock.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`onboarding:${actor.id}`})::bigint)`;

      // Re-check INSIDE the lock — the whole point of taking it.
      const raced = await tx.membership.findFirst({
        where: { userId: actor.id, status: 'active' },
        orderBy: { invitedAt: 'asc' },
      });
      if (raced) {
        const household = await tx.household.findFirst({
          where: { firmId: raced.firmId, status: 'active' },
          orderBy: { createdAt: 'asc' },
        });
        if (household) return { firmId: raced.firmId, householdId: household.id, raced: true };
      }

      const firm = await tx.firm.create({
        data: {
          // Internal only — never rendered to a consumer. Named for whoever operates the
          // support console and needs to tell personal workspaces apart from real firms.
          name: `Personal · ${actor.email ?? actor.id}`,
          baseCurrency,
          reviewCadence: 'quarterly',
        },
      });
      await tx.membership.create({
        data: { firmId: firm.id, userId: actor.id, firmRole: FirmRole.OWNER, status: 'active' },
      });
      const household = await tx.household.create({
        data: {
          firmId: firm.id,
          name: this.crypto.encrypt(householdName)!,
          // A consumer advises themselves; this keeps "my household" queries working the
          // same way they do for an advisor-assigned household.
          advisorId: actor.id,
          baseCurrency,
        },
      });
      // Household scoping reads User.activeFirmId server-side, so the consumer's very first
      // request after onboarding resolves without a separate firm-switch round trip.
      await tx.user.update({ where: { id: actor.id }, data: { activeFirmId: firm.id } });
      return { firmId: firm.id, householdId: household.id, raced: false };
    });

    // The loser of a race did not provision anything, and must not claim it did or emit a
    // second audit entry for a household it did not create.
    if (workspace.raced) {
      return { firmId: workspace.firmId, householdId: workspace.householdId, provisioned: false };
    }

    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'onboarding.personal_household_provisioned',
      entityType: 'Household',
      entityId: workspace.householdId,
      firmId: workspace.firmId,
      metadata: { firmId: workspace.firmId },
      ip,
    });

    return { ...workspace, provisioned: true };
  }

  /**
   * Household name, in preference order: what the user typed, their profile name, a neutral
   * fallback. Never throws — a decryption failure must not block onboarding, because the
   * name is cosmetic and the household is not.
   */
  private async resolveHouseholdName(actor: AuthUser, familyName?: string): Promise<string> {
    const typed = familyName?.trim();
    if (typed) return typed;

    try {
      const profile = await this.prisma.profile.findUnique({ where: { userId: actor.id } });
      const fullName = profile?.fullName ? this.crypto.decrypt(profile.fullName)?.trim() : null;
      if (fullName) return `${fullName.split(/\s+/).slice(-1)[0]} household`;
    } catch (err) {
      this.logger.warn(`Could not derive household name from profile: ${String(err)}`);
    }
    return 'My household';
  }
}
