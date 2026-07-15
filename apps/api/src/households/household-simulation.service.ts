import { Injectable } from '@nestjs/common';
import {
  simulateFinancialWhatIf,
  SCENARIO_TYPE_PARAMS,
  type FinancialSnapshotPayload,
  type SimulationScenario,
} from '@lcos/core';
import { HouseholdFinancialSnapshotService } from './household-financial-snapshot.service';

/**
 * Financial What-if Simulation (M3-3). A pure, **read-only / non-mutating** engine: it
 * reads an **immutable** Financial Snapshot (never household tables), builds a transient
 * virtual snapshot, and reuses the M3-1 scoring + M3-2 explanation via
 * `@lcos/core simulateFinancialWhatIf`. Nothing is persisted; the kernel is never
 * touched (ADR-013). Depends only on the snapshot read service.
 */
@Injectable()
export class HouseholdSimulationService {
  constructor(private readonly snapshots: HouseholdFinancialSnapshotService) {}

  /** Supported scenario types + their parameter keys (discoverability). */
  scenarioTypes() {
    return {
      simulationEngineVersion: 'sim-1.0.0',
      scenarioTypes: Object.entries(SCENARIO_TYPE_PARAMS).map(([type, params]) => ({ type, params })),
    };
  }

  /** Run a what-if simulation against the latest (or a given) immutable snapshot. */
  async simulate(householdId: string, snapshotId: string | undefined, scenarios: SimulationScenario[]) {
    const snap = snapshotId
      ? await this.snapshots.getById(householdId, snapshotId)
      : await this.snapshots.latest(householdId);
    if (!snap) {
      return { available: false as const, reason: 'no snapshot captured' };
    }
    const payload = snap.payload as unknown as FinancialSnapshotPayload;
    const result = simulateFinancialWhatIf(payload, { scenarios }, { snapshotId: snap.id });
    return {
      available: true as const,
      snapshotId: snap.id,
      currency: snap.currency,
      result,
    };
  }
}
