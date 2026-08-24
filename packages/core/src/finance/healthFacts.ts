import type { CurrencyCode } from '../money/money.js';
import type { FinancialSnapshotPayload } from './financialSnapshot.js';
import type { HealthFacts } from './financialHealth.js';
import type { IntelligenceAssumptions } from './financialIntelligence.js';
import { analyzeLifeInsuranceGap } from './insurance.js';
import { computeRetirement } from './retirement.js';

/**
 * Turn module-owned assumptions into the scalars the Wealth Health Score needs (M5.12).
 *
 * See `docs/M5_12_WEALTH_HEALTH_SCORE_V2_ARCHITECTURE.md`.
 *
 * ## Why this exists at all
 *
 * The scorer takes a frozen snapshot payload, and neither protection nor retirement is in it —
 * they are not kernel facts, they are things a family states. Two callers now need to score
 * (`HouseholdHealthScoreService` and the intelligence layer), and if each derived these figures
 * for itself the two would eventually disagree about the same family. One function, both callers.
 *
 * ## It invents no maths
 *
 * Every number here comes from a calculator that already existed — `analyzeLifeInsuranceGap` and
 * `computeRetirement`, the same two the intelligence layer composes. This file only decides *what
 * is known*, which is the part the score gets wrong if nobody decides it deliberately.
 *
 * ## Unknown stays unknown
 *
 * A missing answer yields `null`, and the scorer omits that category rather than scoring it zero.
 * Scoring an unrecorded family as uninsured would assert an absence nobody told us — #67 again,
 * except lowering the number the family is judged by.
 */
export interface HealthFactsContext {
  /**
   * Age of the member the retirement plan is for, from `primaryAgeOf(payload)`. Passed in
   * rather than derived here so both callers use one definition of "whose retirement".
   */
  primaryAgeYears: number | null;
  /** The snapshot's base currency (`meta.currency`); the payload does not carry it. */
  currency: CurrencyCode;
}

export function deriveHealthFacts(
  payload: FinancialSnapshotPayload,
  assumptions: IntelligenceAssumptions | undefined,
  ctx: HealthFactsContext,
): HealthFacts {
  return {
    protection: protectionFacts(payload, assumptions, ctx.currency),
    retirement: retirementFacts(payload, assumptions, ctx),
  };
}

function dependantsOf(payload: FinancialSnapshotPayload): number {
  return (payload.members ?? []).filter((m) => m.isDependent).length;
}

function protectionFacts(
  payload: FinancialSnapshotPayload,
  assumptions: IntelligenceAssumptions | undefined,
  currency: CurrencyCode,
): HealthFacts['protection'] {
  const ins = assumptions?.insurance;
  if (!ins) return null;

  const annualIncomeMinor = payload.cashflowSummary.incomeMinor * 12;
  const dependents = dependantsOf(payload);

  // No income and nobody depending on this family: there is no life-cover need to be short of,
  // so a cover ratio would be meaningless. Health cover still is, and is reported on its own.
  const lifeAssessable = annualIncomeMinor > 0 || dependents > 0;

  let coverRatio: number | null = null;
  if (lifeAssessable && ins.hasTermCover !== null && ins.hasTermCover !== undefined) {
    const gap = analyzeLifeInsuranceGap({
      annualIncomeMinor,
      outstandingLiabilitiesMinor: payload.debt.totalOutstandingMinor,
      existingCoverMinor: ins.existingCoverMinor,
      dependents,
      currency,
    });
    const recommended = gap.recommendedCoverMinor.minor;
    // A family that needs no cover cannot be short of it — full marks rather than a divide by
    // zero, which would otherwise read as "no protection".
    coverRatio = recommended > 0 ? ins.existingCoverMinor / recommended : 1;
  }

  const hasHealthInsurance = ins.hasHealthInsurance ?? null;
  if (coverRatio === null && hasHealthInsurance === null) return null;
  return { coverRatio, hasHealthInsurance };
}

function retirementFacts(
  payload: FinancialSnapshotPayload,
  assumptions: IntelligenceAssumptions | undefined,
  { primaryAgeYears, currency }: HealthFactsContext,
): HealthFacts['retirement'] {
  const plan = assumptions?.retirement;
  // Scored only when the family has STATED a plan. The intelligence layer falls back to
  // documented defaults so it can always show something; judging a family's headline number
  // against assumptions they never gave us is a different matter. Defaults inform, not judge.
  if (!plan) return null;
  if (primaryAgeYears === null) return null;

  const annualExpenses = payload.cashflowSummary.expenseMinor * 12;
  if (annualExpenses <= 0 && plan.desiredAnnualIncomeMinor === undefined) return null;

  const result = computeRetirement({
    currentAge: primaryAgeYears,
    retirementAge: plan.retirementAge,
    yearsInRetirement: plan.yearsInRetirement,
    currentAnnualExpensesMinor: plan.desiredAnnualIncomeMinor ?? annualExpenses,
    currentCorpusMinor: plan.currentCorpusMinor ?? Math.max(0, payload.householdEquity.reconciledEquityMinor),
    inflationRatePct: plan.inflationRatePct,
    preRetirementReturnPct: plan.preRetirementReturnPct,
    postRetirementReturnPct: plan.postRetirementReturnPct,
    ...(plan.monthlyContributionMinor !== undefined
      ? { monthlyContributionMinor: plan.monthlyContributionMinor }
      : {}),
    currency,
  });

  const required = result.requiredCorpus.minor;
  // Nothing required means nothing to fall short of.
  if (required <= 0) return { readiness: 1 };
  return { readiness: Math.max(0, result.projectedCorpusAtRetirement.minor / required) };
}
