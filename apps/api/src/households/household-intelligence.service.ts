import { Injectable, NotFoundException } from '@nestjs/common';
import { Household } from '@prisma/client';
import {
  computeHouseholdFinancialIntelligence,
  FINANCIAL_INTELLIGENCE_ENGINE_VERSION,
  type FinancialSnapshotPayload,
  type HouseholdFinancialIntelligence,
  type IntelligenceAssumptions,
} from '@lcos/core';
import { CryptoService } from '../common/crypto.service';
import { HouseholdFinancialSnapshotService } from './household-financial-snapshot.service';
import { HouseholdProtectionService } from './household-protection.service';
import { RetirementPlanService } from './retirement-plan.service';
import { HouseholdGoalsService } from './household-goals.service';

/**
 * Financial Intelligence Layer (M5) — the single reusable consumer of the Financial
 * Kernel. It reads an **immutable** Financial Snapshot (never the kernel's live tables or
 * any M2 engine repository), composes the **existing** `@lcos/core` calculators into the
 * canonical `HouseholdFinancialIntelligence` object, and returns it read-only. It mutates
 * nothing in the kernel and holds no derived facts of its own — a corrected snapshot
 * simply yields new intelligence. See docs/architecture/M5_FINANCIAL_INTELLIGENCE_LAYER.md;
 * per FUTURE_MODULE_CONTRACT.md / KERNEL_GOVERNANCE.md it depends only on
 * `HouseholdFinancialSnapshotService` (read) + `CryptoService` (PII boundary).
 */
@Injectable()
export class HouseholdIntelligenceService {
  constructor(
    private readonly snapshots: HouseholdFinancialSnapshotService,
    private readonly crypto: CryptoService,
    private readonly protection: HouseholdProtectionService,
    private readonly retirementPlans: RetirementPlanService,
    private readonly goals: HouseholdGoalsService,
  ) {}

  /**
   * Resolve the immutable snapshot to analyse: a specific `snapshotId` (must belong to the
   * household) or the latest stored snapshot. Returns null when none exists yet.
   */
  private async resolveSnapshot(householdId: string, snapshotId?: string) {
    if (snapshotId) {
      const snap = await this.snapshots.getById(householdId, snapshotId);
      if (!snap) throw new NotFoundException('Financial snapshot not found');
      return snap;
    }
    return this.snapshots.latest(householdId);
  }

  /**
   * Live intelligence — composed from the latest (or a given) **immutable** snapshot;
   * **not persisted**. Returns `{ available: false }` when the household has no snapshot
   * yet, so consumers can prompt to capture one instead of rendering empty sections.
   */
  /**
   * @param assumptions Overrides the module-owned inputs this service would otherwise load.
   *   Callers normally omit it — see the note above `resolveAssumptions`.
   */
  async current(
    household: Household,
    snapshotId?: string,
    assumptions?: IntelligenceAssumptions,
  ): Promise<
    | { available: false; reason: string }
    | ({ available: true } & HouseholdFinancialIntelligence)
  > {
    const snap = await this.resolveSnapshot(household.id, snapshotId);
    if (!snap) {
      return { available: false, reason: 'no snapshot captured' };
    }

    // Net-worth trend series (oldest→newest) from the kernel's own read API — never raw tables.
    const timeline = await this.snapshots.timeline(household.id);
    // Debt travels with each point so the layer can reconcile the series the same way it
    // reconciles the headline. `timeline` already returns both figures; this passes them
    // through rather than reshaping a kernel read API.
    const trend = timeline.map((t) => ({
      netWorthMinor: t.netWorthMinor,
      totalDebtMinor: t.totalDebtMinor,
    }));

    const resolved = assumptions ?? (await this.resolveAssumptions(household.id));

    const intelligence = computeHouseholdFinancialIntelligence({
      payload: snap.payload as unknown as FinancialSnapshotPayload,
      meta: {
        householdId: household.id,
        snapshotId: snap.id,
        snapshotSchemaVersion: snap.schemaVersion,
        engineVersion: snap.engineVersion,
        fxVersion: snap.fxVersion,
        currency: snap.currency,
        capturedAt: snap.capturedAt instanceof Date ? snap.capturedAt.toISOString() : String(snap.capturedAt),
      },
      trend,
      assumptions: resolved,
      computedAt: new Date().toISOString(),
    });

    // Resolve the family name at the decrypted boundary — the pure object stays PII-light.
    intelligence.household.name = this.crypto.decrypt(household.name);
    intelligence.household.baseCurrency = household.baseCurrency;

    return { available: true, ...intelligence };
  }

  /**
   * Module-owned inputs the snapshot does not carry (M5.9).
   *
   * Loaded **here** rather than at each call site, and that placement is the fix. The M5.9
   * defect was not a missing table — it was that `current()` accepted an `assumptions` argument
   * and every caller forgot to pass it, so `assumptions.insurance` was permanently `undefined`
   * and the layer reported protection it had never been given. Two call sites, both wrong, for
   * as long as the layer has existed.
   *
   * Resolving inside the service makes that class of omission impossible: a new consumer gets
   * the household's real inputs by calling `current()`, with nothing to remember. It is also
   * what `M5_FINANCIAL_INTELLIGENCE_LAYER.md` describes — *"load module-owned assumptions
   * (retirement/insurance) if any"* — rather than the call-site wiring sketched in §3 of the
   * M5.9 note.
   *
   * Returns `undefined` when nothing is known, which the layer reads as "not asked".
   * M5.10 adds retirement here, and M5.11 goals — which is what the note anticipated: a new
   * module-owned input is one more entry in this method, not a change at any call site.
   */
  private async resolveAssumptions(
    householdId: string,
  ): Promise<IntelligenceAssumptions | undefined> {
    const [insurance, retirement, goals] = await Promise.all([
      this.protection.assumptionsFor(householdId),
      this.retirementPlans.assumptionsFor(householdId),
      this.goals.assumptionsFor(householdId),
    ]);
    if (!insurance && !retirement && !goals) return undefined;
    return {
      ...(insurance ? { insurance } : {}),
      ...(retirement ? { retirement } : {}),
      ...(goals ? { goals } : {}),
    };
  }

  /** Exposed for callers/tests that want the active composing-engine version. */
  get engineVersion() {
    return FINANCIAL_INTELLIGENCE_ENGINE_VERSION;
  }
}
