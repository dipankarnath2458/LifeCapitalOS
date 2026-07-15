import { Injectable } from '@nestjs/common';
import {
  explainFinancialHealth,
  type CategoryScore,
  type FinancialHealthScore,
  type FinancialSnapshotPayload,
} from '@lcos/core';
import { HouseholdHealthScoreService } from './household-health-score.service';
import { HouseholdFinancialSnapshotService } from './household-financial-snapshot.service';

/** The serialized score shape returned by HouseholdHealthScoreService (current/getById/latest). */
interface ScoreView {
  snapshotId: string;
  scoreModelVersion: string;
  currency: string;
  overall: number;
  band: string;
  categories: unknown;
  drivers: unknown;
}

/**
 * Explainable Financial Health Engine (M3-2). A pure **read-only** explanation layer: it
 * obtains an existing `FinancialHealthScore` from the M3-1 service (it does **not**
 * compute one), reads the referenced immutable snapshot for financial-impact context,
 * and returns the deterministic `HealthExplanation` from `@lcos/core`. It mutates
 * nothing, persists nothing, and touches no kernel/engine data.
 */
@Injectable()
export class HouseholdHealthExplanationService {
  constructor(
    private readonly scores: HouseholdHealthScoreService,
    private readonly snapshots: HouseholdFinancialSnapshotService,
  ) {}

  /** Reconstruct the core score object from a serialized view (no recomputation). */
  private toCore(view: ScoreView): FinancialHealthScore {
    return {
      modelVersion: view.scoreModelVersion,
      overall: view.overall,
      band: view.band as FinancialHealthScore['band'],
      categories: view.categories as CategoryScore[],
      drivers: view.drivers as FinancialHealthScore['drivers'],
    };
  }

  /** Explain the live current score (from the latest, or a given, immutable snapshot). */
  async current(householdId: string, snapshotId?: string) {
    const view = await this.scores.current(householdId, snapshotId);
    if (!view.available) return { available: false as const, reason: 'no snapshot captured' };
    const snap = await this.snapshots.getById(householdId, view.snapshotId);
    const payload = snap?.payload as unknown as FinancialSnapshotPayload | undefined;
    const explanation = explainFinancialHealth(this.toCore(view as unknown as ScoreView), payload);
    return {
      available: true as const,
      snapshotId: view.snapshotId,
      currency: view.currency,
      explanation,
    };
  }

  /** Explain the latest persisted score (null → not available). */
  async latest(householdId: string) {
    const view = await this.scores.latest(householdId);
    if (!view) return { available: false as const, reason: 'no score saved' };
    const snap = await this.snapshots.getById(householdId, view.snapshotId);
    const payload = snap?.payload as unknown as FinancialSnapshotPayload | undefined;
    const explanation = explainFinancialHealth(this.toCore(view as unknown as ScoreView), payload);
    return {
      available: true as const,
      scoreId: view.id,
      snapshotId: view.snapshotId,
      currency: view.currency,
      explanation,
    };
  }

  /** Explain a specific persisted score (404 via the score service if not found). */
  async byId(householdId: string, scoreId: string) {
    const view = await this.scores.getById(householdId, scoreId);
    const snap = await this.snapshots.getById(householdId, view.snapshotId);
    const payload = snap?.payload as unknown as FinancialSnapshotPayload | undefined;
    const explanation = explainFinancialHealth(this.toCore(view as unknown as ScoreView), payload);
    return {
      available: true as const,
      scoreId: view.id,
      snapshotId: view.snapshotId,
      currency: view.currency,
      explanation,
    };
  }
}
