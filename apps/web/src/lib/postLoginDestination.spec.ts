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
