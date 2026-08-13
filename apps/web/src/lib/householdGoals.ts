import { apiDelete, apiGet, apiPatch, apiPost } from './api';
import { getOnboardingStatus } from './household';

/**
 * Household goals and the net-worth trend (M5.8 PR 2).
 *
 * Design: `docs/M5_8_GOALS_CHARTS_ARCHITECTURE.md`.
 *
 * Goals move to the household — the family's goals, alongside everything else they own — rather
 * than living only on the retail `userId` path. `Goal` already carried `householdId` and `firmId`
 * from M1b, so this needed an API, not a schema change.
 *
 * **Goals still move no figure.** The Financial Snapshot has no goals section, so a goal changes
 * nothing in the dashboard, the score or the AI grounding. Said plainly because "native goals"
 * reads like "goals now count", and they do not — see §3 of the design note.
 *
 * No arithmetic here. Amounts are minor units; the client formats and never derives.
 *
 * Every function takes the household id rather than resolving it. The first draft called
 * `/onboarding/status` inside each one, which turned a four-goal page into five extra requests
 * and tripped the API's rate limiter during the smoke suite. The caller resolves it once, with
 * `resolveHouseholdId` or straight from `DashboardState`.
 */

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

/**
 * The caller's household, resolved once. `null` means they have never onboarded — a state the
 * page must handle rather than treat as an error.
 */
export async function resolveHouseholdId(token: string): Promise<string | null> {
  const status = await getOnboardingStatus(token);
  return status?.householdId ?? null;
}

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
