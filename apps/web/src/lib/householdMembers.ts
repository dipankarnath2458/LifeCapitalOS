import { apiDelete, apiGet, apiPatch, apiPost } from './api';
import { getOnboardingStatus } from './household';

/**
 * Household members — the V2 family client (M5.8 PR 1).
 *
 * Design: `docs/M5_8_FAMILY_ARCHITECTURE.md`.
 *
 * ## Why this exists when a family page already did
 *
 * V1's family page writes `FamilyMember`, keyed on `userId`. The Financial Snapshot reads
 * `HouseholdMember`, keyed on `householdId`. Two stores, and only the second one is read — so a
 * consumer who added their spouse and children in V1 changed nothing: not the dependants count
 * behind their recommended life cover, not the ages behind their retirement projection.
 *
 * This writes the table the snapshot actually reads.
 *
 * ## Date of birth is the point
 *
 * V1's form had no date-of-birth field, and onboarding creates the self-member without one. With
 * no age anywhere in the household, the retirement section reports `available: false` — so no
 * consumer in the product has ever seen a retirement projection. Capturing a date of birth is what
 * turns it on.
 *
 * No arithmetic happens here. The kernel composes the snapshot and `@lcos/core` computes; this
 * collects and displays.
 */

export interface HouseholdMemberRecord {
  id: string;
  householdId: string;
  /**
   * Set when this member has a sign-in for the household.
   *
   * It is also the post-login routing signal, which is why the API refuses to delete such a
   * member and why the UI hides the control. See `household-members.service.ts`.
   */
  userId: string | null;
  name: string;
  relation: string;
  dateOfBirth: string | null;
  isDependent: boolean;
  householdRole: string;
}

export interface MemberInput {
  name: string;
  relation: string;
  /** `YYYY-MM-DD`, or null when not given. Absent means retirement cannot be projected. */
  dateOfBirth?: string | null;
  isDependent: boolean;
}

/** True when this member has a sign-in — the row the API will not let you delete. */
export const hasPortalLogin = (m: HouseholdMemberRecord) => m.userId !== null;

async function householdId(token: string): Promise<string | null> {
  const status = await getOnboardingStatus(token);
  return status?.householdId ?? null;
}

export async function listMembers(token: string): Promise<HouseholdMemberRecord[] | null> {
  const id = await householdId(token);
  if (!id) return null;
  return apiGet<HouseholdMemberRecord[]>(`/households/${id}/members`, token);
}

export async function addMember(token: string, input: MemberInput): Promise<HouseholdMemberRecord> {
  const id = await householdId(token);
  if (!id) throw new Error('No household');
  return apiPost<HouseholdMemberRecord>(`/households/${id}/members`, body(input), token);
}

export async function updateMember(
  token: string,
  memberId: string,
  input: Partial<MemberInput>,
): Promise<HouseholdMemberRecord> {
  const id = await householdId(token);
  if (!id) throw new Error('No household');
  return apiPatch<HouseholdMemberRecord>(`/households/${id}/members/${memberId}`, body(input), token);
}

export async function removeMember(token: string, memberId: string): Promise<void> {
  const id = await householdId(token);
  if (!id) throw new Error('No household');
  await apiDelete(`/households/${id}/members/${memberId}`, token);
}

/**
 * Omits a blank date of birth rather than sending an empty string, which the API would reject as
 * a malformed date. Absent and blank mean the same thing to a person filling in a form.
 */
function body(input: Partial<MemberInput>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.name !== undefined) out.name = input.name;
  if (input.relation !== undefined) out.relation = input.relation;
  if (input.isDependent !== undefined) out.isDependent = input.isDependent;
  if (input.dateOfBirth) out.dateOfBirth = input.dateOfBirth;
  return out;
}

/** ISO date → the `YYYY-MM-DD` a date input expects. Display only. */
export const toDateInput = (iso: string | null): string => (iso ? iso.slice(0, 10) : '');
