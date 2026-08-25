import { apiGet, apiPost, ApiError } from './api';
import { HOUSEHOLD_ID_KEY } from './session';

export interface OnboardingStatus {
  hasHousehold: boolean;
  firmId: string | null;
  householdId: string | null;
  /** True when the caller belongs to a household **as themselves** — their money, not a client's. */
  hasOwnHousehold: boolean;
  ownHouseholdId: string | null;
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
 *
 * ---
 *
 * ## Gap 7: why this file returns a union rather than `string | null`
 *
 * There are **three** materially different answers to "does this family have a household?", and
 * for a long time this module could express only two:
 *
 * | Truth | What the family should see |
 * |---|---|
 * | They have one | Their finances |
 * | They have never onboarded | An invitation to set one up |
 * | **We could not find out** | "We could not load this — try again" |
 *
 * The old `resolveHouseholdId` returned `string | null` and folded the last two together
 * (`status?.householdId ?? null`). So when `/onboarding/status` returned **429** — which it does
 * under ordinary request pressure, because it is the most-called route in the product and is
 * rate limited per route per IP — six consumer surfaces told a family with a fully populated
 * household that they had none, and invited them to onboard again.
 *
 * That is the `unknown → false` failure this codebase has fixed repeatedly elsewhere: it is why
 * `Section<T>` carries a `reason`, why `monthlyContributionMinor` is nullable, and why M5.12
 * omits an unscored category instead of scoring it zero. The rule is the same here — **an error
 * is not a fact about the family.**
 *
 * `loadDashboard` in `intelligence.ts` already got this right, distinguishing `{ kind: 'error' }`
 * from `{ kind: 'needs-onboarding' }`. This module generalises that shape so no caller has to
 * remember to make the distinction for itself.
 *
 * ## Why the id is cached, and why caching is the rate-limit fix
 *
 * A consumer's own household id cannot change while they are signed in, so caching it for the
 * tab is correct rather than merely convenient. `clearTokens` drops it, so it can never outlive
 * the session it belongs to, and **only a real id is ever cached** — "not onboarded" genuinely
 * can change mid-session and must be re-checked, and "we could not tell" must never be stored as
 * if it were an answer.
 *
 * The cache existed before Gap 7 but only *one* of the seven call sites used it: `loadDashboard`,
 * `householdMembers` and `familyCfo` each called the endpoint directly, and the last two did so
 * **once per operation** rather than once per page — adding a family member re-asked whether the
 * family had a household. Routing every caller through {@link resolveHousehold} is therefore the
 * primary fix for the rate-limit pressure. Raising the limit would have hidden the amplification
 * rather than removed it.
 */

/** Why a household could not be resolved. Never surfaced raw — callers map it to their own copy. */
export type UnavailableReason =
  /** HTTP 429. Transient by construction: the window rolls. */
  | 'rate-limited'
  /** Anything else — offline, DNS, 5xx, a malformed body. */
  | 'network';

export type OnboardingStatusResult =
  | { kind: 'ok'; status: OnboardingStatus }
  | { kind: 'unavailable'; reason: UnavailableReason };

export type HouseholdResolution =
  /** They have a household, and this is its id. */
  | { kind: 'resolved'; householdId: string }
  /** They have genuinely never onboarded. A state to handle, not an error. */
  | { kind: 'none' }
  /** We could not find out. **Never** to be rendered as "you have no household". */
  | { kind: 'unavailable'; reason: UnavailableReason };

/**
 * Asks the API what the caller already has.
 *
 * **Never throws, and never silently loses the reason.** A failure is reported as
 * `{ kind: 'unavailable' }` rather than as an absence of data.
 *
 * Deliberately does **not** retry. A 429 means the client is already asking too often; retrying
 * on a timer would turn a rate limit into a retry storm and delay the honest answer to the
 * family. The transient case is surfaced to the UI, which offers a "try again" the *person*
 * chooses to press.
 */
export async function fetchOnboardingStatus(token: string): Promise<OnboardingStatusResult> {
  try {
    const status = await apiGet<OnboardingStatus>('/onboarding/status', token);
    return { kind: 'ok', status };
  } catch (err) {
    return {
      kind: 'unavailable',
      reason: err instanceof ApiError && err.status === 429 ? 'rate-limited' : 'network',
    };
  }
}

/** Caches a real household id for the tab. Only ever called with an id the API confirmed. */
export function rememberHouseholdId(id: string): void {
  if (typeof window !== 'undefined') sessionStorage.setItem(HOUSEHOLD_ID_KEY, id);
}

/**
 * The caller's household, resolved **once per session** rather than once per page — and once per
 * page rather than once per operation.
 *
 * The single place household resolution happens. Callers switch on `kind`; none of them repeats
 * the "is this a missing household or a failed request?" decision, because that is exactly the
 * decision six of them previously got wrong.
 */
export async function resolveHousehold(token: string): Promise<HouseholdResolution> {
  const cached = typeof window !== 'undefined' ? sessionStorage.getItem(HOUSEHOLD_ID_KEY) : null;
  if (cached) return { kind: 'resolved', householdId: cached };

  const result = await fetchOnboardingStatus(token);
  if (result.kind === 'unavailable') return result;

  const id = result.status.householdId;
  if (!id) return { kind: 'none' };
  rememberHouseholdId(id);
  return { kind: 'resolved', householdId: id };
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
  const workspace = await apiPost<ProvisionedWorkspace>('/onboarding/household', input, token);
  // The id is now known and cannot change for this session, so the page the user lands on next
  // should not have to ask for it again.
  rememberHouseholdId(workspace.householdId);
  return workspace;
}
