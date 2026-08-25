import { Injectable } from '@nestjs/common';
import {
  deriveHealthFacts,
  primaryAgeOf,
  simulateFinancialWhatIf,
  SCENARIO_TYPE_PARAMS,
  type CurrencyCode,
  type FinancialSnapshotPayload,
  type SimulationScenario,
} from '@lcos/core';
import { HouseholdAssumptionsService } from './household-assumptions.service';
import { HouseholdFinancialSnapshotService } from './household-financial-snapshot.service';

/**
 * Financial What-if Simulation (M3-3). A pure, **read-only / non-mutating** engine: it
 * reads an **immutable** Financial Snapshot (never household tables), builds a transient
 * virtual snapshot, and reuses the M3-1 scoring + M3-2 explanation via
 * `@lcos/core simulateFinancialWhatIf`. Nothing is persisted; the kernel is never
 * touched (ADR-013).
 *
 * ## Why this service resolves assumptions (M5.13)
 *
 * M5.12 made protection and retirement scored categories, and added a `facts` option to the
 * engine so a simulation scores them too. The engine was extended; **this caller was not**, so
 * every simulation scored a five-category baseline while the family's dashboard scored six or
 * seven. The two numbers disagreed by up to 16 points on a household that had stated it holds no
 * cover — the family would open "what if" and find a different Wealth Health Score than the one
 * on their dashboard, with nothing on either screen to explain the difference.
 *
 * That is the M5.9 defect exactly: a service that had the data available and a consumer that
 * never received it. It is fixed the same way — through the one shared resolver
 * ({@link HouseholdAssumptionsService}) and the one shared derivation (`deriveHealthFacts`), so
 * this service, the score service and the intelligence layer cannot drift apart again.
 *
 * The facts are deliberately the **same object** for the baseline and every virtual payload: no
 * scenario in the registry changes a family's cover or their retirement plan, so a scenario's
 * reported delta stays the scenario's own effect rather than an artefact of scoring the two sides
 * under different models.
 */
@Injectable()
export class HouseholdSimulationService {
  constructor(
    private readonly snapshots: HouseholdFinancialSnapshotService,
    private readonly assumptions: HouseholdAssumptionsService,
  ) {}

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
    const assumptions = await this.assumptions.resolve(householdId);
    const facts = deriveHealthFacts(payload, assumptions, {
      primaryAgeYears: primaryAgeOf(payload),
      currency: (snap.currency || 'INR') as CurrencyCode,
    });
    const result = simulateFinancialWhatIf(payload, { scenarios }, { snapshotId: snap.id, facts });
    return {
      available: true as const,
      snapshotId: snap.id,
      currency: snap.currency,
      result,
    };
  }
}
