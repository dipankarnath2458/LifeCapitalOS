import { apiGet, apiPatch } from './api';

/**
 * Household protection (M5.9).
 *
 * Design: `docs/M5_9_PROTECTION_ARCHITECTURE.md`.
 *
 * The household id is a parameter, resolved once by the caller — the same rule the goals client
 * follows since re-fetching `/onboarding/status` per call tripped the API's rate limiter.
 *
 * **`null` is a value here, not a missing field.** It means the question has not been answered,
 * and it is distinct from `false` ("we have no cover"). Nothing in this file may coerce one to
 * the other; the whole milestone exists because those two states were once the same value.
 */

export interface MemberProtection {
  memberId: string;
  name: string | null;
  relation: string;
  isDependent: boolean;
  /** `null` = not asked. */
  hasTermCover: boolean | null;
  hasHealthInsurance: boolean | null;
  termLifeCoverMinor: number | null;
  /** Field names this member still owes an answer to. */
  unanswered: string[];
}

export interface ProtectionOverview {
  members: MemberProtection[];
  /** `null` until every member has answered — never a zero-filled stand-in. */
  summary: {
    existingCoverMinor: number;
    hasTermCover: boolean;
    hasHealthInsurance: boolean;
  } | null;
  coverTracked: boolean;
  unansweredMemberIds: string[];
}

export interface ProtectionInput {
  hasTermCover?: boolean;
  hasHealthInsurance?: boolean;
  termLifeCoverMinor?: number;
}

export async function loadProtection(
  token: string,
  householdId: string,
): Promise<ProtectionOverview> {
  return apiGet<ProtectionOverview>(`/households/${householdId}/protection`, token);
}

/**
 * Records one member's answers.
 *
 * Only the fields present are written; an omitted field keeps its stored answer rather than
 * resetting it to "not asked".
 */
export async function saveMemberProtection(
  token: string,
  householdId: string,
  memberId: string,
  input: ProtectionInput,
): Promise<MemberProtection> {
  return apiPatch<MemberProtection>(
    `/households/${householdId}/protection/members/${memberId}`,
    input,
    token,
  );
}
