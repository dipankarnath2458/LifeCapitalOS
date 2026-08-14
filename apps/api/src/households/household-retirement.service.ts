import { ForbiddenException, Injectable } from '@nestjs/common';
import { Household } from '@prisma/client';
import {
  projectRetirementScenarios,
  type HouseholdFinancialIntelligence,
  type RetirementInput,
  type RetirementScenario,
} from '@lcos/core';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/decorators';
import { FirmContext } from '../firms/firm-context.decorators';
import { HouseholdIntelligenceService } from './household-intelligence.service';
import { RetirementPlanService } from './retirement-plan.service';
import { RetirementWhatIfDto, UpdateRetirementPlanDto } from './household-retirement.dto';

type RetirementSection = HouseholdFinancialIntelligence['retirement'];

/**
 * Retirement Planning (M5.10) — the first Planning Experience.
 *
 * Design: `docs/M5_10_RETIREMENT_PLANNING_ARCHITECTURE.md`.
 *
 * ## Where the projection comes from
 *
 * **Not from here.** This service reads the `retirement` section of the Financial Intelligence
 * Layer, which is the single place the projection is composed. Assembling a second
 * `RetirementInput` here would be a figure with two definitions — the defect class of #55 and
 * #59 — so the only thing this service builds an input for is what-if, and it builds it from
 * the layer's own output rather than from the snapshot again.
 *
 * ## What-if is not a second engine
 *
 * `projectRetirementScenarios` maps over `computeRetirement`, the same pure function the layer
 * uses. `simulateFinancialWhatIf` remains the engine for position-shaped scenarios; the boundary
 * is §13 of the architecture note.
 */
@Injectable()
export class HouseholdRetirementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly plans: RetirementPlanService,
    private readonly intelligence: HouseholdIntelligenceService,
  ) {}

  /**
   * The acting user must be a member of this household **as themselves**.
   *
   * A retirement plan is a statement of intent — when you want to stop working, the life you
   * want. An advisor cannot hold that intent on a client's behalf. Same boundary as household
   * goals (M5.8 PR 2) and protection (M5.9).
   */
  private async assertOwnHousehold(actor: AuthUser, householdId: string) {
    const self = await this.prisma.householdMember.findFirst({
      where: { householdId, userId: actor.id },
    });
    if (!self) {
      throw new ForbiddenException(
        'A retirement plan can only be set by a member of this household. ' +
          'Advisor-set plans are not supported yet.',
      );
    }
  }

  /**
   * Who the projection is about.
   *
   * The oldest non-dependant, matching the layer's own `primaryAgeOf`. Named explicitly so the
   * surface can say whose retirement this is rather than leaving a couple to guess — decision 3
   * of the approved architecture.
   */
  private subjectOf(intel: HouseholdFinancialIntelligence) {
    const withAge = intel.household.members.filter((m) => m.ageYears !== null);
    const adults = withAge.filter((m) => !m.isDependent);
    const pool = adults.length > 0 ? adults : withAge;
    return pool.reduce<(typeof pool)[number] | null>(
      (oldest, m) => (oldest === null || m.ageYears! > oldest.ageYears! ? m : oldest),
      null,
    );
  }

  /** The plan, its resolved assumptions with provenance, and the projection. */
  async overview(household: Household) {
    const intel = await this.intelligence.current(household);
    if (!intel.available) {
      return { available: false as const, reason: intel.reason };
    }
    const assumptions = await this.plans.resolve(household.id);
    const subject = this.subjectOf(intel);

    return {
      available: true as const,
      currency: household.baseCurrency,
      snapshotId: intel.meta.snapshotId,
      /** Whose retirement this projects. `null` when no member has a date of birth. */
      subject: subject && {
        memberId: subject.memberId,
        ageYears: subject.ageYears,
        relation: subject.relation,
      },
      assumptions,
      /** Straight from the intelligence layer — never recomputed here. */
      retirement: intel.retirement,
      recommendations: this.recommendationsFor(intel.retirement, assumptions),
    };
  }

  async upsert(
    actor: AuthUser,
    firm: FirmContext,
    householdId: string,
    dto: UpdateRetirementPlanDto,
    ip?: string,
  ) {
    await this.assertOwnHousehold(actor, householdId);

    // Each field is written only when present, so an omitted field keeps its stored answer
    // rather than being reset to "not stated".
    const data = {
      ...(dto.retirementAge !== undefined ? { retirementAge: dto.retirementAge } : {}),
      ...(dto.lifeExpectancy !== undefined ? { lifeExpectancy: dto.lifeExpectancy } : {}),
      ...(dto.desiredAnnualIncomeMinor !== undefined
        ? { desiredAnnualIncomeMinor: BigInt(dto.desiredAnnualIncomeMinor) }
        : {}),
      ...(dto.monthlyContributionMinor !== undefined
        ? { monthlyContributionMinor: BigInt(dto.monthlyContributionMinor) }
        : {}),
      ...(dto.currentCorpusMinor !== undefined
        ? { currentCorpusMinor: BigInt(dto.currentCorpusMinor) }
        : {}),
      ...(dto.inflationRatePct !== undefined ? { inflationRatePct: dto.inflationRatePct } : {}),
      ...(dto.preRetirementReturnPct !== undefined
        ? { preRetirementReturnPct: dto.preRetirementReturnPct }
        : {}),
      ...(dto.postRetirementReturnPct !== undefined
        ? { postRetirementReturnPct: dto.postRetirementReturnPct }
        : {}),
    };

    await this.prisma.retirementPlan.upsert({
      where: { householdId },
      create: { householdId, firmId: firm.firmId, ...data },
      update: data,
    });

    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'household.retirement.upsert',
      entityType: 'RetirementPlan',
      entityId: householdId,
      // Field names only — a family's retirement intent is not audit-trail material.
      metadata: { firmId: firm.firmId, householdId, fields: Object.keys(dto) },
      ip,
    });

    return this.plans.resolve(householdId);
  }

  /**
   * Deterministic what-if.
   *
   * **Persists nothing.** The base input is rebuilt from the layer's own resolved figures, so a
   * scenario can never disagree with the projection it is compared against.
   */
  async whatIf(household: Household, dto: RetirementWhatIfDto) {
    const intel = await this.intelligence.current(household);
    if (!intel.available) return { available: false as const, reason: intel.reason };
    if (!intel.retirement.available) {
      return { available: false as const, reason: intel.retirement.reason };
    }
    const subject = this.subjectOf(intel);
    if (!subject || subject.ageYears === null) {
      return { available: false as const, reason: 'No member age available to project retirement.' };
    }
    const r = intel.retirement.data;
    const a = await this.plans.resolve(household.id);

    const base: RetirementInput = {
      currentAge: subject.ageYears,
      retirementAge: r.retirementAge,
      yearsInRetirement: Math.max(1, r.planningToAge - r.retirementAge),
      currentAnnualExpensesMinor: a.desiredAnnualIncomeMinor.value,
      currentCorpusMinor: r.currentCorpusMinor,
      inflationRatePct: a.inflationRatePct.value,
      preRetirementReturnPct: a.preRetirementReturnPct.value,
      postRetirementReturnPct: a.postRetirementReturnPct.value,
      currency: household.baseCurrency as RetirementInput['currency'],
      ...(a.monthlyContributionMinor !== null
        ? { monthlyContributionMinor: a.monthlyContributionMinor.value }
        : {}),
    };

    const scenarios: RetirementScenario[] = dto.scenarios.map((s) => ({
      type: s.type,
      params: {
        ...(s.years !== undefined ? { years: s.years } : {}),
        ...(s.amountMinor !== undefined ? { amountMinor: s.amountMinor } : {}),
      },
    }));

    return {
      available: true as const,
      currency: household.baseCurrency,
      snapshotId: intel.meta.snapshotId,
      outcomes: projectRetirementScenarios(base, scenarios).map((o) => ({
        type: o.scenario.type,
        params: o.scenario.params,
        status: o.status,
        requiredCorpusMinor: o.result.requiredCorpus.minor,
        projectedCorpusAtRetirementMinor: o.result.projectedCorpusAtRetirement.minor,
        surplusOrShortfallMinor: o.result.surplusOrShortfall.minor,
        deltaSurplusMinor: o.deltaSurplusMinor,
      })),
    };
  }

  /**
   * Explainable next steps, derived from the projection — never invented.
   *
   * Each recommendation names the figure it came from, so a family can trace it. Deliberately
   * few: this is the first Planning Experience, not an advice engine, and the Super Human
   * Advisor™ workflow is explicitly out of scope for M5.10.
   */
  private recommendationsFor(
    section: RetirementSection,
    assumptions: Awaited<ReturnType<RetirementPlanService['resolve']>>,
  ) {
    if (!section.available) return [];
    const out: { key: string; title: string; rationale: string }[] = [];
    const d = section.data;

    if (assumptions.monthlyContributionMinor === null) {
      out.push({
        key: 'state_contribution',
        title: 'Tell us what you save for retirement each month',
        rationale:
          'Without it we can tell you what you need, but not where you are heading. It is the ' +
          'single figure the answer depends on most.',
      });
    }

    if (d.projection.available && d.projection.data.status !== 'on_track') {
      out.push({
        key: 'increase_contribution',
        title: `Increase your monthly retirement saving`,
        rationale:
          `Closing the gap by your retirement age needs about ` +
          `${d.monthlySipRequiredMinor / 100} per month at the returns assumed here.`,
      });
      out.push({
        key: 'retire_later',
        title: 'Consider working a little longer',
        rationale:
          'Each extra year compounds what you already hold and shortens what it has to fund. ' +
          'Try it under "what if" before deciding.',
      });
    }

    if (d.usingDefaultAssumptions) {
      out.push({
        key: 'state_plan',
        title: 'Set your own retirement age and target income',
        rationale:
          'This projection currently uses standard assumptions. Your own figures will change ' +
          'the answer, often substantially.',
      });
    }

    return out;
  }
}
