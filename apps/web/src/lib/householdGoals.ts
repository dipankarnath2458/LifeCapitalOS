import { apiDelete, apiGet, apiPatch, apiPost } from './api';

/**
 * Household goals and the net-worth trend (M5.8 PR 2).
 *
 * Design: `docs/M5_8_GOALS_CHARTS_ARCHITECTURE.md`.
 *
 * Goals move to the household — the family's goals, alongside everything else they own — rather
 * than living only on the retail `userId` path. `Goal` already carried `householdId` and `firmId`
 * from M1b, so this needed an API, not a schema change.
 *
 * **Goals now move a figure (M5.11).** A goal that is behind its funding schedule raises a Goal
 * Progress signal in the household's risk section, which the dashboard already renders and the AI
 * coach can already cite. The Financial Snapshot still carries no goals and the Wealth Health
 * Score still ignores them — both deliberate; see `docs/M5_11_GOALS_SIGNAL_ARCHITECTURE.md`.
 *
 * No arithmetic here. Amounts are minor units; the client formats and never derives.
 *
 * Every function takes the household id rather than resolving it. The first draft called
 * `/onboarding/status` inside each one, which turned a four-goal page into five extra requests
 * and tripped the API's rate limiter during the smoke suite. The caller resolves it once, with
 * `resolveHouseholdId` or straight from `DashboardState`.
 */

/**
 * Where a goal stands, as the planning service computed it (M5.11).
 *
 * Every figure here came from the API. The page renders them and derives nothing — the same rule
 * the retirement surface follows, and the one V1's in-React calculator broke.
 */
export interface GoalPlan {
  monthsRemaining: number;
  projectedCurrentMinor: number;
  gapMinor: number;
  monthlySipRequiredMinor: number;
  /** Saved so far as a fraction of target, in [0,1]. */
  progress: number;
  /** Unfunded fraction of the target after growth, in [0,1]. Bands: ≥0.15 watch, ≥0.30 behind. */
  slippage: number;
}

export interface HouseholdGoal {
  id: string;
  householdId: string | null;
  name: string;
  type: string;
  currency: string;
  targetAmountMinor: number;
  currentAmountMinor: number;
  targetDate: string;
  expectedAnnualReturnPct: number;
  plan: GoalPlan;
}

/**
 * How a goal's standing is described to a family. Presentation only — the bands are the warning
 * engine's (`earlyWarning.ts`), restated here so the page and the risk signal cannot disagree
 * about what "behind" means.
 */
export function goalStanding(plan: GoalPlan): { label: string; tone: 'good' | 'watch' | 'bad' } {
  if (plan.slippage >= 0.3) return { label: 'Behind schedule', tone: 'bad' };
  if (plan.slippage >= 0.15) return { label: 'Worth watching', tone: 'watch' };
  return { label: 'On track', tone: 'good' };
}

export interface GoalInput {
  name: string;
  type: string;
  targetAmountMinor: number;
  currentAmountMinor: number;
  targetDate: string;
}

export const GOAL_TYPES = [
  'retirement',
  'child_education',
  'child_marriage',
  'home_purchase',
  'emergency_fund',
  'travel',
  'custom',
] as const;

/** Re-exported so goals callers keep their import; the resolver itself lives in `household.ts`. */
export { resolveHousehold } from './household';

export async function listGoals(token: string, householdId: string): Promise<HouseholdGoal[]> {
  return apiGet<HouseholdGoal[]>(`/households/${householdId}/goals`, token);
}

export async function addGoal(
  token: string,
  householdId: string,
  input: GoalInput,
): Promise<HouseholdGoal> {
  return apiPost<HouseholdGoal>(`/households/${householdId}/goals`, input, token);
}

export async function updateGoal(
  token: string,
  householdId: string,
  goalId: string,
  input: Partial<GoalInput>,
): Promise<HouseholdGoal> {
  return apiPatch<HouseholdGoal>(`/households/${householdId}/goals/${goalId}`, input, token);
}

export async function removeGoal(
  token: string,
  householdId: string,
  goalId: string,
): Promise<void> {
  await apiDelete(`/households/${householdId}/goals/${goalId}`, token);
}

/** One captured snapshot, as the kernel's timeline returns it. */
export interface TimelinePoint {
  id: string;
  capturedAt: string;
  netWorthMinor: number;
  totalDebtMinor: number;
}

/**
 * The household's net-worth history.
 *
 * Read from the kernel's own timeline API — never recomputed. The caller plots
 * `netWorthMinor − totalDebtMinor`, the **reconciled** figure, for the same reason as #55 and
 * #59: a trend drawn from the gross number would contradict the headline directly above it. Both
 * fields come from the timeline, so that is a selection rather than a calculation.
 */
export async function loadTimeline(
  token: string,
  householdId: string,
): Promise<TimelinePoint[]> {
  return apiGet<TimelinePoint[]>(`/households/${householdId}/financial-snapshot/timeline`, token);
}
