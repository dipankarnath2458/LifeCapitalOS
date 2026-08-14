import { apiGet, apiPost } from './api';
import { HOUSEHOLD_ID_KEY } from './session';

export interface OnboardingStatus {
  hasHousehold: boolean;
  firmId: string | null;
  householdId: string | null;
}

export interface ProvisionedWorkspace {
  firmId: string;
  householdId: string;
  provisioned: boolean;
}

/**
 * The consumer's household — the container every financial engine requires.
 *
 * ADR-010's retail/advisory duality is only partial: `FinancialSnapshot`, `Entity` and
 * `FinancialHealthScore` are household-only. A consumer without a household can hold
 * accounts but can have no snapshot, and therefore no health score and no AI insights.
 * See `docs/architecture/M5-5_CONSUMER_ACTIVATION.md`.
 *
 * Every consumer surface that needs those capabilities goes through here.
 */

/** What the caller already has. Never throws — callers use this to decide, not to fail. */
export async function getOnboardingStatus(token: string): Promise<OnboardingStatus | null> {
  return apiGet<OnboardingStatus>('/onboarding/status', token).catch(() => null);
}

/**
 * The caller's household, resolved **once per session** rather than once per page.
 *
 * `null` means they have never onboarded — a state to handle, not an error.
 *
 * ## Why this is cached
 *
 * `/onboarding/status` is rate limited like every route (120/60s per route per IP), and it is
 * the single most-called endpoint in the product because *every* V2 surface needs the household
 * id before it can ask for anything else. M5.8 PR 2 already had to stop callers re-resolving it
 * per operation; adding one more surface in M5.10 pushed it over the limit again, and a 429 here
 * is not a slow page — it makes `hasOwnHousehold` read false and lands a consumer in the Advisor
 * Workspace.
 *
 * A consumer's own household id does not change while they are signed in, so caching it for the
 * tab is correct rather than merely convenient. Only a real id is cached: `null` means "not
 * onboarded yet", which genuinely can change mid-session and must be re-checked. `clearTokens`
 * drops it, so it can never outlive the session it belongs to.
 */
export function rememberHouseholdId(id: string): void {
  if (typeof window !== 'undefined') sessionStorage.setItem(HOUSEHOLD_ID_KEY, id);
}

export async function resolveHouseholdId(token: string): Promise<string | null> {
  const cached = typeof window !== 'undefined' ? sessionStorage.getItem(HOUSEHOLD_ID_KEY) : null;
  if (cached) return cached;

  const status = await getOnboardingStatus(token);
  const id = status?.householdId ?? null;
  if (id) rememberHouseholdId(id);
  return id;
}

/**
 * Ensures the caller has a household, creating one only if they do not.
 *
 * Safe to call from anywhere and as often as needed: the server is idempotent by contract
 * and serialises concurrent callers, so this cannot produce a second household — which
 * would split a family's accounts and their snapshot apart with no way to merge them.
 *
 * Deliberately safe for an advisor too: they already have a workspace, so the server
 * returns it rather than provisioning a personal one alongside it.
 */
export async function ensureHousehold(
  token: string,
  input: { familyName?: string; baseCurrency?: string } = {},
): Promise<ProvisionedWorkspace> {
  return apiPost<ProvisionedWorkspace>('/onboarding/household', input, token);
}
