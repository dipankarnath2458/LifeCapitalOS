import { Injectable } from '@nestjs/common';
import { RetirementPlan } from '@prisma/client';
import {
  DEFAULT_INTELLIGENCE_ASSUMPTIONS,
  type FinancialSnapshotPayload,
  type IntelligenceAssumptions,
} from '@lcos/core';
import { PrismaService } from '../prisma/prisma.service';
import { HouseholdFinancialSnapshotService } from './household-financial-snapshot.service';

/** Where a resolved planning figure came from. Returned to the client, not inferred by it. */
export type FieldSource = 'stated' | 'derived' | 'default';

export interface ResolvedField<T> {
  value: T;
  source: FieldSource;
}

/** Every assumption the projection uses, each with its provenance. */
export interface ResolvedRetirementAssumptions {
  retirementAge: ResolvedField<number>;
  lifeExpectancy: ResolvedField<number>;
  desiredAnnualIncomeMinor: ResolvedField<number>;
  currentCorpusMinor: ResolvedField<number>;
  inflationRatePct: ResolvedField<number>;
  preRetirementReturnPct: ResolvedField<number>;
  postRetirementReturnPct: ResolvedField<number>;
  /** `null` when never stated. There is no honest default for what a family saves. */
  monthlyContributionMinor: ResolvedField<number> | null;
}

/**
 * The household's retirement plan — the store, and the resolution of its assumptions (M5.10).
 *
 * Design: `docs/M5_10_RETIREMENT_PLANNING_ARCHITECTURE.md`.
 *
 * ## Why this is a separate, thin service
 *
 * `HouseholdIntelligenceService` depends on this to fill `assumptions.retirement`, and the
 * planning experience (`HouseholdRetirementService`) depends on **both**. Splitting the store
 * out is what keeps that from being a dependency cycle, and it means the projection has exactly
 * one computation path — the intelligence layer — rather than two that could drift apart.
 *
 * ## No arithmetic lives here
 *
 * Every figure this service returns is either read from the plan, summed from the snapshot, or
 * a documented constant. The projection itself belongs to `@lcos/core`.
 */
@Injectable()
export class RetirementPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshots: HouseholdFinancialSnapshotService,
  ) {}

  /**
   * Documented planning defaults, used when a family has not stated their own.
   *
   * Unlike Protection — where "we never asked" cannot honestly become "no cover" — a retirement
   * age and a market inflation rate DO have defensible conventions. The difference is that every
   * default is reported as such (`source: 'default'`), so an assumption of ours is never
   * presented as a decision of theirs. The one field with no honest default is the contribution.
   */
  private static readonly DEFAULTS = {
    ...DEFAULT_INTELLIGENCE_ASSUMPTIONS.retirement,
    /** The age the plan funds to — the layer's default age plus its default horizon. */
    lifeExpectancy:
      DEFAULT_INTELLIGENCE_ASSUMPTIONS.retirement.retirementAge +
      DEFAULT_INTELLIGENCE_ASSUMPTIONS.retirement.yearsInRetirement,
  };

  async find(householdId: string): Promise<RetirementPlan | null> {
    return this.prisma.retirementPlan.findUnique({ where: { householdId } });
  }

  /**
   * Investable assets from the immutable snapshot, excluding residential property.
   *
   * Decision 1 of the approved architecture. The layer's own fallback is *reconciled net worth*,
   * which includes the family home — nobody sells the house to buy groceries at 70, so planning
   * a retirement against it overstates the corpus. This reads the snapshot's own allocation and
   * drops `real_estate`; it is a selection, not a calculation.
   *
   * Returns `null` when there is no snapshot to read, so the caller can leave the layer on its
   * existing fallback rather than substituting a zero.
   */
  private async investableCorpusMinor(householdId: string): Promise<number | null> {
    const snap = await this.snapshots.latest(householdId);
    if (!snap) return null;
    const payload = snap.payload as unknown as FinancialSnapshotPayload;
    return payload.assetAllocation
      .filter((a) => a.assetClass !== 'real_estate')
      .reduce((sum, a) => sum + a.baseValueMinor, 0);
  }

  /** Today's annual spend, from the snapshot — the lifestyle a family funds by default. */
  private async currentAnnualExpensesMinor(householdId: string): Promise<number | null> {
    const snap = await this.snapshots.latest(householdId);
    if (!snap) return null;
    const payload = snap.payload as unknown as FinancialSnapshotPayload;
    const monthly = payload.cashflowSummary.expenseMinor;
    return monthly > 0 ? monthly * 12 : null;
  }

  /**
   * Every assumption with its provenance — what the planning surface renders.
   *
   * `null` for the contribution is load-bearing: it is the one figure with no honest default,
   * so it stays absent rather than becoming a zero the family never chose.
   */
  async resolve(householdId: string): Promise<ResolvedRetirementAssumptions> {
    const plan = await this.find(householdId);
    const d = RetirementPlanService.DEFAULTS;

    const retirementAge = plan?.retirementAge ?? d.retirementAge;
    const lifeExpectancy = plan?.lifeExpectancy ?? d.lifeExpectancy;

    const derivedCorpus = await this.investableCorpusMinor(householdId);
    const derivedIncome = await this.currentAnnualExpensesMinor(householdId);

    const field = <T>(stated: T | null | undefined, fallback: T, source: FieldSource) =>
      stated !== null && stated !== undefined
        ? { value: stated, source: 'stated' as const }
        : { value: fallback, source };

    return {
      retirementAge: field(plan?.retirementAge, retirementAge, 'default'),
      lifeExpectancy: field(plan?.lifeExpectancy, lifeExpectancy, 'default'),
      desiredAnnualIncomeMinor: field(
        plan?.desiredAnnualIncomeMinor === null || plan?.desiredAnnualIncomeMinor === undefined
          ? null
          : Number(plan.desiredAnnualIncomeMinor),
        derivedIncome ?? 0,
        'derived',
      ),
      currentCorpusMinor: field(
        plan?.currentCorpusMinor === null || plan?.currentCorpusMinor === undefined
          ? null
          : Number(plan.currentCorpusMinor),
        derivedCorpus ?? 0,
        'derived',
      ),
      inflationRatePct: field(plan?.inflationRatePct, d.inflationRatePct, 'default'),
      preRetirementReturnPct: field(plan?.preRetirementReturnPct, d.preRetirementReturnPct, 'default'),
      postRetirementReturnPct: field(
        plan?.postRetirementReturnPct,
        d.postRetirementReturnPct,
        'default',
      ),
      monthlyContributionMinor:
        plan?.monthlyContributionMinor === null || plan?.monthlyContributionMinor === undefined
          ? null
          : { value: Number(plan.monthlyContributionMinor), source: 'stated' },
    };
  }

  /**
   * The plan in the shape the Financial Intelligence Layer declares.
   *
   * Returns `undefined` when the household has **no plan at all**, which leaves the layer on its
   * pre-M5.10 behaviour exactly — no shipped figure moves for a family that has not planned.
   * Once a plan exists, the derived corpus (§5.1) replaces the net-worth proxy through the
   * `currentCorpusMinor` override that already existed.
   */
  async assumptionsFor(householdId: string): Promise<IntelligenceAssumptions['retirement']> {
    const plan = await this.find(householdId);
    if (!plan) return undefined;

    const r = await this.resolve(householdId);
    return {
      retirementAge: r.retirementAge.value,
      // The horizon is expressed as an age to plan to; the engine wants a duration.
      yearsInRetirement: Math.max(1, r.lifeExpectancy.value - r.retirementAge.value),
      inflationRatePct: r.inflationRatePct.value,
      preRetirementReturnPct: r.preRetirementReturnPct.value,
      postRetirementReturnPct: r.postRetirementReturnPct.value,
      currentCorpusMinor: r.currentCorpusMinor.value,
      desiredAnnualIncomeMinor: r.desiredAnnualIncomeMinor.value,
      // Omitted entirely when unstated — the layer reads its absence as "not asked" and reports
      // the projection unavailable rather than assuming this family saves nothing.
      ...(r.monthlyContributionMinor !== null
        ? { monthlyContributionMinor: r.monthlyContributionMinor.value }
        : {}),
    };
  }
}
