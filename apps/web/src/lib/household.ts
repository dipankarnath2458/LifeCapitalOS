import { apiGet, apiPost } from './api';

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
