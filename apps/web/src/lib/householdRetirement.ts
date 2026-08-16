import { apiGet, apiPost, apiPut } from './api';

/**
 * Retirement planning (M5.10).
 *
 * Design: `docs/M5_10_RETIREMENT_PLANNING_ARCHITECTURE.md`.
 *
 * **No arithmetic in this file, and none in the page that uses it.** Every figure below is one
 * the planning service returned. The V1 `RetirementCalculator` component computes in React from
 * typed-in numbers and persists nothing; that is the pattern this milestone replaces, and it
 * stays on `/dashboard` untouched as the safety net.
 *
 * `null` is a value here, not a missing field: `monthlyContributionMinor` is `null` when the
 * family has never stated it, which is why the projection can be unavailable while the rest of
 * the section is fine.
 */

export type FieldSource = 'stated' | 'derived' | 'default';
export interface ResolvedField<T = number> {
  value: T;
  source: FieldSource;
}

export interface ResolvedAssumptions {
  retirementAge: ResolvedField;
  lifeExpectancy: ResolvedField;
  desiredAnnualIncomeMinor: ResolvedField;
  currentCorpusMinor: ResolvedField;
  inflationRatePct: ResolvedField;
  preRetirementReturnPct: ResolvedField;
  postRetirementReturnPct: ResolvedField;
  /** `null` = never stated. There is no honest default for what a family saves. */
  monthlyContributionMinor: ResolvedField | null;
}

export type RetirementStatus = 'on_track' | 'watch' | 'at_risk';

export interface RetirementProjection {
  monthlyContributionMinor: number;
  projectedFromCurrentMinor: number;
  projectedFromContributionsMinor: number;
  projectedCorpusAtRetirementMinor: number;
  surplusOrShortfallMinor: number;
  status: RetirementStatus;
}

export interface RetirementData {
  currentCorpusMinor: number;
  requiredCorpusMinor: number;
  fundingGapMinor: number;
  readinessPct: number;
  onTrack: boolean;
  monthlySipRequiredMinor: number;
  usingDefaultAssumptions: boolean;
  inflatedAnnualIncomeMinor: number;
  retirementAge: number;
  planningToAge: number;
  projection:
    | { available: true; confidence: string; data: RetirementProjection }
    | { available: false; reason: string };
}

export type RetirementOverview =
  | { available: false; reason: string }
  | {
      available: true;
      currency: string;
      snapshotId: string;
      /** Whose retirement this projects — the oldest non-dependant. `null` with no birth date. */
      subject: { memberId: string; ageYears: number | null; relation: string } | null;
      assumptions: ResolvedAssumptions;
      retirement:
        | { available: true; confidence: string; data: RetirementData }
        | { available: false; reason: string };
      recommendations: { key: string; title: string; rationale: string }[];
    };

export interface PlanInput {
  retirementAge?: number;
  lifeExpectancy?: number;
  desiredAnnualIncomeMinor?: number;
  monthlyContributionMinor?: number;
  currentCorpusMinor?: number;
}

export type ScenarioType =
  | 'retire_earlier'
  | 'retire_later'
  | 'increase_contribution'
  | 'increase_corpus'
  | 'change_income_target';

export interface ScenarioOutcome {
  type: ScenarioType;
  status: RetirementStatus;
  requiredCorpusMinor: number;
  projectedCorpusAtRetirementMinor: number;
  surplusOrShortfallMinor: number;
  /** Change in surplus versus the family's current plan. Positive is better off. */
  deltaSurplusMinor: number;
}

export type WhatIfResult =
  | { available: false; reason: string }
  | { available: true; currency: string; outcomes: ScenarioOutcome[] };

export const loadRetirement = (token: string, householdId: string) =>
  apiGet<RetirementOverview>(`/households/${householdId}/retirement`, token);

/** Only the fields present are written; an omitted one keeps its stored answer. */
export const saveRetirementPlan = (token: string, householdId: string, input: PlanInput) =>
  apiPut<ResolvedAssumptions>(`/households/${householdId}/retirement`, input, token);

/** Deterministic and read-only — running a scenario changes nothing about the plan. */
export const runWhatIf = (
  token: string,
  householdId: string,
  scenarios: { type: ScenarioType; years?: number; amountMinor?: number }[],
) => apiPost<WhatIfResult>(`/households/${householdId}/retirement/what-if`, { scenarios }, token);

/** How the family sees each status. Presentation only — the status itself is the service's. */
export const STATUS_LABEL: Record<RetirementStatus, string> = {
  on_track: 'On track',
  watch: 'Worth watching',
  at_risk: 'At risk',
};
