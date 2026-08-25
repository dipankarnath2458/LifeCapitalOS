import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Gap 7 — household resolution must preserve three states, not two.
 *
 * ## The bug this suite exists to prevent from returning
 *
 * `resolveHouseholdId` returned `string | null` and computed it as `status?.householdId ?? null`.
 * That single `??` folded two unrelated facts into one value:
 *
 * - the family has never onboarded, and
 * - **we could not find out**, because `/onboarding/status` answered 429.
 *
 * Six consumer surfaces read that `null` as the first and rendered "Let's set up your household
 * first" to families whose households were fully populated. The endpoint is the most-called route
 * in the product and is rate limited per route per IP, so this was not hypothetical: it was
 * reproduced deterministically in the M5.13 browser suite (134 calls, limit 120/60s, four 429s).
 *
 * The rule these tests encode is the one this codebase applies everywhere else — in `Section<T>`,
 * in nullable `monthlyContributionMinor`, in M5.12's omitted categories: **an error is not a fact
 * about the family.**
 *
 * ## Why these tests bite
 *
 * Every case here distinguishes `{ kind: 'none' }` from `{ kind: 'unavailable' }`. Against the old
 * implementation both were `null`, so the failure cases below cannot pass by accident — there was
 * no value the old code could return that satisfies them.
 */

const API_URL = 'http://api.test/api';

interface MemStorage extends Storage {
  map: Map<string, string>;
}

function memoryStorage(): MemStorage {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as MemStorage;
}

let local: MemStorage;
let session: MemStorage;
let fetchMock: ReturnType<typeof vi.fn>;

async function loadHousehold() {
  vi.resetModules();
  return import('./household');
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', API_URL);
  local = memoryStorage();
  session = memoryStorage();
  vi.stubGlobal('window', {
    localStorage: local,
    sessionStorage: session,
    location: { href: 'http://app.test/household' },
  });
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', session);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  // A live access token, so `authFetch` sends the request rather than trying to refresh.
  local.setItem('lcos_access', 'access-1');
  local.setItem('lcos_refresh', 'refresh-1');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function json(status: number, body: unknown = {}): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const STATUS_WITH_HOUSEHOLD = {
  hasHousehold: true,
  firmId: 'firm-1',
  householdId: 'hh-1',
  hasOwnHousehold: true,
  ownHouseholdId: 'hh-1',
};

const STATUS_WITHOUT_HOUSEHOLD = {
  hasHousehold: false,
  firmId: null,
  householdId: null,
  hasOwnHousehold: false,
  ownHouseholdId: null,
};

describe('A. a real household resolves to HAS_HOUSEHOLD', () => {
  it('returns the id', async () => {
    const { resolveHousehold } = await loadHousehold();
    fetchMock.mockResolvedValue(json(200, STATUS_WITH_HOUSEHOLD));

    await expect(resolveHousehold('t')).resolves.toEqual({ kind: 'resolved', householdId: 'hh-1' });
  });

  it('caches the id so the session does not ask again', async () => {
    const { resolveHousehold } = await loadHousehold();
    fetchMock.mockResolvedValue(json(200, STATUS_WITH_HOUSEHOLD));

    await resolveHousehold('t');
    await resolveHousehold('t');
    await resolveHousehold('t');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(session.getItem('lcos_household_id')).toBe('hh-1');
  });
});

describe('B. no household resolves to NO_HOUSEHOLD', () => {
  it('reports `none`, distinctly from a failure', async () => {
    const { resolveHousehold } = await loadHousehold();
    fetchMock.mockResolvedValue(json(200, STATUS_WITHOUT_HOUSEHOLD));

    await expect(resolveHousehold('t')).resolves.toEqual({ kind: 'none' });
  });

  it('does NOT cache "no household" — it can change mid-session', async () => {
    // Caching this would strand someone who onboards in another tab, and would also mean a
    // wrong answer outlived the request that produced it.
    const { resolveHousehold } = await loadHousehold();
    fetchMock.mockResolvedValue(json(200, STATUS_WITHOUT_HOUSEHOLD));

    await resolveHousehold('t');
    await resolveHousehold('t');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(session.getItem('lcos_household_id')).toBeNull();
  });
});

describe('C. an API failure resolves to UNAVAILABLE, never to NO_HOUSEHOLD', () => {
  for (const status of [500, 503, 404]) {
    it(`HTTP ${status} is unavailable, not "no household"`, async () => {
      const { resolveHousehold } = await loadHousehold();
      fetchMock.mockResolvedValue(json(status, {}));

      const result = await resolveHousehold('t');
      expect(result).toEqual({ kind: 'unavailable', reason: 'network' });
      expect(result.kind).not.toBe('none');
    });
  }

  it('a thrown network error is unavailable, not "no household"', async () => {
    const { resolveHousehold } = await loadHousehold();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await resolveHousehold('t');
    expect(result).toEqual({ kind: 'unavailable', reason: 'network' });
    expect(result.kind).not.toBe('none');
  });

  it('never caches a failure as if it were an answer', async () => {
    const { resolveHousehold } = await loadHousehold();
    fetchMock.mockResolvedValue(json(500, {}));

    await resolveHousehold('t');

    expect(session.getItem('lcos_household_id')).toBeNull();
  });
});

describe('D. HTTP 429 resolves to UNAVAILABLE, never to NO_HOUSEHOLD', () => {
  // The case that produced the bug in the wild, kept separate from C so a regression here is
  // unmistakable in the test output.
  it('is reported as rate-limited, not as an absent household', async () => {
    const { resolveHousehold } = await loadHousehold();
    fetchMock.mockResolvedValue(json(429, { message: 'ThrottlerException: Too Many Requests' }));

    const result = await resolveHousehold('t');

    expect(result).toEqual({ kind: 'unavailable', reason: 'rate-limited' });
    expect(result.kind).not.toBe('none');
  });

  it('is distinguishable from every other failure, so it can be handled and observed', async () => {
    const { resolveHousehold } = await loadHousehold();

    fetchMock.mockResolvedValue(json(429, {}));
    const throttled = await resolveHousehold('t');
    session.clear();

    fetchMock.mockResolvedValue(json(500, {}));
    const broken = await resolveHousehold('t');

    expect(throttled).not.toEqual(broken);
  });

  it('does NOT retry — a rate limit must not become a retry storm', async () => {
    // Retrying on a timer would keep the limiter's window open and delay the honest answer.
    // The person presses "Try again"; the client never hammers on its own.
    const { resolveHousehold } = await loadHousehold();
    fetchMock.mockResolvedValue(json(429, {}));

    await resolveHousehold('t');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('recovers once the window rolls, without a reload', async () => {
    const { resolveHousehold } = await loadHousehold();

    fetchMock.mockResolvedValue(json(429, {}));
    expect((await resolveHousehold('t')).kind).toBe('unavailable');

    fetchMock.mockResolvedValue(json(200, STATUS_WITH_HOUSEHOLD));
    await expect(resolveHousehold('t')).resolves.toEqual({ kind: 'resolved', householdId: 'hh-1' });
  });
});

describe('the status reader keeps the reason rather than discarding it', () => {
  it('reports ok with the full status when the call succeeds', async () => {
    const { fetchOnboardingStatus } = await loadHousehold();
    fetchMock.mockResolvedValue(json(200, STATUS_WITH_HOUSEHOLD));

    await expect(fetchOnboardingStatus('t')).resolves.toEqual({
      kind: 'ok',
      status: STATUS_WITH_HOUSEHOLD,
    });
  });

  it('never throws, so no caller has to guard it with a try', async () => {
    const { fetchOnboardingStatus } = await loadHousehold();
    fetchMock.mockRejectedValue(new Error('boom'));

    await expect(fetchOnboardingStatus('t')).resolves.toEqual({
      kind: 'unavailable',
      reason: 'network',
    });
  });
});

describe('G. resolution does not amplify requests', () => {
  it('provisioning caches the new id, so the next page does not re-ask', async () => {
    const { ensureHousehold, resolveHousehold } = await loadHousehold();
    fetchMock.mockResolvedValue(
      json(201, { firmId: 'firm-1', householdId: 'hh-9', provisioned: true }),
    );

    await ensureHousehold('t');
    const calls = fetchMock.mock.calls.length;

    await expect(resolveHousehold('t')).resolves.toEqual({ kind: 'resolved', householdId: 'hh-9' });
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('ten surfaces in one session cost ONE status call between them', async () => {
    // The amplification that caused the rate limiting: the cache existed, but only one of the
    // seven call sites used it, and two of those re-resolved once per *operation*.
    const { resolveHousehold } = await loadHousehold();
    fetchMock.mockResolvedValue(json(200, STATUS_WITH_HOUSEHOLD));

    for (let i = 0; i < 10; i++) await resolveHousehold('t');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
