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
    const trend = timeline.map((t) => ({ netWorthMinor: t.netWorthMinor }));

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
      assumptions,
      computedAt: new Date().toISOString(),
    });

    // Resolve the family name at the decrypted boundary — the pure object stays PII-light.
    intelligence.household.name = this.crypto.decrypt(household.name);
    intelligence.household.baseCurrency = household.baseCurrency;

    return { available: true, ...intelligence };
  }

  /** Exposed for callers/tests that want the active composing-engine version. */
  get engineVersion() {
    return FINANCIAL_INTELLIGENCE_ENGINE_VERSION;
  }
}
