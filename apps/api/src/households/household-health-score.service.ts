import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FinancialHealthScore, Prisma } from '@prisma/client';
import {
  computeFinancialHealthScore,
  FINANCIAL_HEALTH_MODEL_VERSION,
  type FinancialSnapshotPayload,
} from '@lcos/core';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/decorators';
import { FirmContext } from '../firms/firm-context.decorators';
import { HouseholdFinancialSnapshotService } from './household-financial-snapshot.service';

/**
 * Financial Health Score (M3-1). A **consumer** of the Financial Kernel: it reads an
 * **immutable** Financial Snapshot (never the kernel's live tables), runs the **pure**
 * `@lcos/core` scoring function, and persists results in its **own** table. It mutates
 * nothing in the kernel and depends only on `HouseholdFinancialSnapshotService` (read),
 * Prisma (own table), and audit — per FUTURE_MODULE_CONTRACT.md / KERNEL_GOVERNANCE.md.
 */
@Injectable()
export class HouseholdHealthScoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshots: HouseholdFinancialSnapshotService,
    private readonly audit: AuditService,
  ) {}

  private serialize(s: FinancialHealthScore) {
    return {
      id: s.id,
      householdId: s.householdId,
      snapshotId: s.snapshotId,
      schemaVersion: s.schemaVersion,
      scoreModelVersion: s.scoreModelVersion,
      overall: s.overall,
      band: s.band,
      currency: s.currency,
      categories: s.categories,
      drivers: s.drivers,
      computedAt: s.computedAt,
    };
  }

  /**
   * Resolve the immutable snapshot to score: a specific `snapshotId` (must belong to the
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

  /** Compute the score from a snapshot's payload (pure core). */
  private score(payload: FinancialSnapshotPayload) {
    return computeFinancialHealthScore(payload);
  }

  /**
   * Live preview — compute from the latest (or given) **immutable** snapshot; **not
   * persisted**. Returns `{ available: false }` when the household has no snapshot yet.
   */
  async current(householdId: string, snapshotId?: string) {
    const snap = await this.resolveSnapshot(householdId, snapshotId);
    if (!snap) {
      return { available: false as const, reason: 'no snapshot captured' };
    }
    const result = this.score(snap.payload as unknown as FinancialSnapshotPayload);
    return {
      available: true as const,
      live: true as const,
      householdId,
      snapshotId: snap.id,
      schemaVersion: snap.schemaVersion,
      scoreModelVersion: result.modelVersion,
      currency: snap.currency,
      computedAt: new Date(),
      overall: result.overall,
      band: result.band,
      categories: result.categories,
      drivers: result.drivers,
    };
  }

  /** Compute and **persist** a score tied to an immutable snapshot. */
  async capture(
    actor: AuthUser,
    firm: FirmContext,
    householdId: string,
    snapshotId?: string,
    ip?: string,
  ) {
    const snap = await this.resolveSnapshot(householdId, snapshotId);
    if (!snap) {
      throw new BadRequestException(
        'No Financial Snapshot exists for this household — capture one first.',
      );
    }
    const result = this.score(snap.payload as unknown as FinancialSnapshotPayload);
    const row = await this.prisma.financialHealthScore.create({
      data: {
        householdId,
        firmId: firm.firmId,
        snapshotId: snap.id,
        schemaVersion: snap.schemaVersion,
        scoreModelVersion: result.modelVersion,
        overall: result.overall,
        band: result.band,
        currency: snap.currency,
        categories: result.categories as unknown as Prisma.InputJsonValue,
        drivers: result.drivers as unknown as Prisma.InputJsonValue,
        computedById: actor.id,
      },
    });
    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'household.health-score.capture',
      entityType: 'FinancialHealthScore',
      entityId: row.id,
      metadata: { firmId: firm.firmId, householdId, snapshotId: snap.id, overall: result.overall },
      ip,
    });
    return this.serialize(row);
  }

  /** Latest persisted score (null if none). */
  async latest(householdId: string) {
    const row = await this.prisma.financialHealthScore.findFirst({
      where: { householdId },
      orderBy: { computedAt: 'desc' },
    });
    return row ? this.serialize(row) : null;
  }

  /** Persisted score history, oldest→newest (headline figures for trend). */
  async timeline(householdId: string) {
    const rows = await this.prisma.financialHealthScore.findMany({
      where: { householdId },
      orderBy: { computedAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      snapshotId: r.snapshotId,
      overall: r.overall,
      band: r.band,
      scoreModelVersion: r.scoreModelVersion,
      computedAt: r.computedAt,
    }));
  }

  /** A specific persisted score, scoped to the household. */
  async getById(householdId: string, scoreId: string) {
    const row = await this.prisma.financialHealthScore.findUnique({ where: { id: scoreId } });
    if (!row || row.householdId !== householdId) {
      throw new NotFoundException('Health score not found');
    }
    return this.serialize(row);
  }

  /** Exposed for callers/tests that want the active model version. */
  get modelVersion() {
    return FINANCIAL_HEALTH_MODEL_VERSION;
  }
}
