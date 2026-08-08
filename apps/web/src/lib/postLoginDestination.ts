import { apiGet } from './api';

/**
 * Where a user goes after signing in.
 *
 * Before this, `/login` sent **everyone** to `/app` unconditionally — so consumers landed
 * in the Advisor Workspace and saw "No firm yet — ask a firm owner to invite you", which is
 * a dead end for a consumer product.
 *
 * The axis that matters is **firm membership, not `User.role`.** `/app` gates on
 * `GET /firms/me`, not on the role column, so an `ADVISOR`-roled user with no membership
 * would still hit the empty state. Routing on role would send them somewhere they cannot
 * use. Membership is what the destination actually requires, so membership is what decides.
 */

export const ADVISOR_HOME = '/app';
/**
 * Retail home. V1 UI, restored deliberately — see `app/dashboard/page.tsx`. Repoint this at
 * the V2 consumer dashboard when M5.5 ships; nothing else needs to change.
 */
export const CONSUMER_HOME = '/dashboard';

export interface FirmMembershipSummary {
  activeFirmId: string | null;
  firms: unknown[];
}

/** From `GET /onboarding/status`. `hasOwnHousehold` means "this is my money, not a client's". */
export interface OwnHouseholdSummary {
  hasOwnHousehold: boolean;
}

/**
 * Pure decision, separated from the fetch so it can be tested without a network.
 *
 * `null` means "we could not tell" — a network failure or a malformed response. That case
 * deliberately resolves to the CONSUMER home, not the advisor one: sending a consumer to a
 * firm-gated page they cannot use is a dead end, whereas an advisor sent to the retail
 * dashboard still has a working page and can navigate on. Fail toward the destination that
 * works for more people.
 */
export function chooseDestination(
  me: FirmMembershipSummary | null,
  own: OwnHouseholdSummary | null = null,
): string {
  // A consumer belongs to a household AS THEMSELVES. Since every consumer is now given a
  // personal firm at onboarding, firm membership alone says only "you belong to some firm"
  // — which is true of consumers and advisors alike, and sent consumers to the Advisor
  // Workspace. Own-household membership is the thing that actually distinguishes them, and
  // it is checked FIRST for exactly that reason.
  if (own?.hasOwnHousehold) return CONSUMER_HOME;
  if (me && Array.isArray(me.firms) && me.firms.length > 0) return ADVISOR_HOME;
  return CONSUMER_HOME;
}

/**
 * Resolves the destination for the signed-in user.
 *
 * Never throws: a failure here must not strand someone on the login screen holding valid
 * tokens. It falls back to the consumer home, which every authenticated user can load.
 */
export async function resolvePostLoginDestination(token: string): Promise<string> {
  const [me, own] = await Promise.all([
    apiGet<FirmMembershipSummary>('/firms/me', token).catch(() => null),
    apiGet<OwnHouseholdSummary>('/onboarding/status', token).catch(() => null),
  ]);
  return chooseDestination(me, own);
}
