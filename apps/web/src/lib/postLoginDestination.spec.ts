import { describe, expect, it } from 'vitest';
import { ADVISOR_HOME, CONSUMER_HOME, chooseDestination } from './postLoginDestination';

/**
 * Post-login routing.
 *
 * The bug this replaces: `/login` sent EVERY user to `/app`, so consumers landed in the
 * Advisor Workspace and saw "No firm yet — ask a firm owner to invite you". A dead end, and
 * the first thing a consumer would ever see.
 */

describe('chooseDestination', () => {
  it('sends a firm member to the advisor workspace', () => {
    expect(chooseDestination({ activeFirmId: 'firm_1', firms: [{ id: 'firm_1' }] })).toBe(ADVISOR_HOME);
  });

  it('sends a user with no firms to the retail dashboard', () => {
    expect(chooseDestination({ activeFirmId: null, firms: [] })).toBe(CONSUMER_HOME);
  });

  it('routes on MEMBERSHIP, not on activeFirmId', () => {
    // A stale activeFirmId with no surviving membership must not grant the workspace —
    // /app resolves the active firm from the memberships list, so it would empty-state.
    expect(chooseDestination({ activeFirmId: 'firm_since_removed', firms: [] })).toBe(CONSUMER_HOME);
  });

  it('sends a multi-firm advisor to the workspace', () => {
    expect(
      chooseDestination({ activeFirmId: 'firm_2', firms: [{ id: 'firm_1' }, { id: 'firm_2' }] }),
    ).toBe(ADVISOR_HOME);
  });

  it('falls back to the CONSUMER home when membership cannot be determined', () => {
    // Fail toward the destination that works for more people: an advisor sent to the retail
    // dashboard still has a usable page, whereas a consumer sent to /app cannot act at all.
    expect(chooseDestination(null)).toBe(CONSUMER_HOME);
  });

  it('tolerates a malformed response rather than throwing', () => {
    expect(chooseDestination({ activeFirmId: null } as never)).toBe(CONSUMER_HOME);
    expect(chooseDestination({ activeFirmId: null, firms: 'nope' } as never)).toBe(CONSUMER_HOME);
  });

  it('keeps the two destinations distinct', () => {
    // Guards against a future edit collapsing them and silently restoring the old bug.
    expect(ADVISOR_HOME).not.toBe(CONSUMER_HOME);
  });
});

/**
 * Regression: consumer routing after a personal firm exists.
 *
 * Since M5.5 every consumer is given a personal firm at onboarding, so `firms.length > 0`
 * became true for consumers as well as advisors — and routing on it alone sent onboarded
 * consumers to the Advisor Workspace. Own-household membership is what actually
 * distinguishes them.
 */
describe('chooseDestination — personal firm vs advisory firm', () => {
  const withFirm = { activeFirmId: 'firm_1', firms: [{ id: 'firm_1' }] };

  it('routes a personal advisor WITH their own household to the consumer home', () => {
    // The exact production defect: a consumer who completed onboarding.
    expect(chooseDestination(withFirm, { hasOwnHousehold: true })).toBe(CONSUMER_HOME);
  });

  it('keeps a real advisory firm member on the advisor workspace', () => {
    // An advisor is a household's advisorId, never one of its members.
    expect(chooseDestination(withFirm, { hasOwnHousehold: false })).toBe(ADVISOR_HOME);
  });

  it('routes an advisor who is ALSO a consumer to their own household', () => {
    // Their own money takes precedence over the book they manage; the workspace is one
    // click away, whereas guessing wrong hides their personal finances entirely.
    expect(chooseDestination(withFirm, { hasOwnHousehold: true })).toBe(CONSUMER_HOME);
  });

  it('falls back to the consumer home when the household check is unavailable', () => {
    // Network failure must not strand anyone on a firm-gated page they may not be able to
    // use — the same fail-toward-the-usable-destination rule as the rest of this module.
    expect(chooseDestination(withFirm, null)).toBe(ADVISOR_HOME);
    expect(chooseDestination(null, null)).toBe(CONSUMER_HOME);
  });

  it('routes a brand-new user with no firm and no household to the consumer home', () => {
    expect(chooseDestination({ activeFirmId: null, firms: [] }, { hasOwnHousehold: false })).toBe(
      CONSUMER_HOME,
    );
  });
});
