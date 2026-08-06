import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Session/refresh tests.
 *
 * The behaviour under test is security- and UX-critical and has no other coverage:
 * `AuthService.refresh()` ROTATES (it revokes the presented refresh token), so a bug that
 * lets two refreshes run concurrently silently logs users out. These tests pin that down.
 *
 * `session.ts` holds module-level state (the in-flight promise, the "already ending" flag),
 * so every test re-imports the module fresh via `vi.resetModules()`.
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

let storage: MemStorage;
let location: { href: string };
let fetchMock: ReturnType<typeof vi.fn>;

async function loadSession() {
  vi.resetModules();
  return import('./session');
}

async function loadApi() {
  vi.resetModules();
  return import('./api');
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', API_URL);
  storage = memoryStorage();
  location = { href: 'http://app.test/app' };
  vi.stubGlobal('window', { localStorage: storage, location });
  vi.stubGlobal('localStorage', storage);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** A JSON Response stand-in — enough surface for the code under test. */
function json(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function seedSession(access = 'access-1', refresh = 'refresh-1') {
  storage.setItem('lcos_access', access);
  storage.setItem('lcos_refresh', refresh);
}

describe('refreshSession', () => {
  it('stores the rotated pair and reports the new access token', async () => {
    const { refreshSession, getAccessToken, getRefreshToken } = await loadSession();
    seedSession();
    fetchMock.mockResolvedValue(json(200, { accessToken: 'access-2', refreshToken: 'refresh-2' }));

    await expect(refreshSession()).resolves.toEqual({ status: 'refreshed', accessToken: 'access-2' });
    expect(getAccessToken()).toBe('access-2');
    expect(getRefreshToken()).toBe('refresh-2');
  });

  it('is SINGLE-FLIGHT: N concurrent callers cause exactly ONE /auth/refresh call', async () => {
    // This is the whole point. Rotation means a second concurrent refresh would present an
    // already-revoked token, 401, and end the session — the bug this guards against.
    const { refreshSession } = await loadSession();
    seedSession();
    let release!: (r: Response) => void;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );

    const results = Promise.all([refreshSession(), refreshSession(), refreshSession(), refreshSession()]);
    release(json(200, { accessToken: 'access-2', refreshToken: 'refresh-2' }));

    expect(await results).toEqual(Array(4).fill({ status: 'refreshed', accessToken: 'access-2' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API_URL}/auth/refresh`);
  });

  it('allows a NEW refresh after the previous one settles', async () => {
    const { refreshSession } = await loadSession();
    seedSession();
    fetchMock.mockResolvedValue(json(200, { accessToken: 'a', refreshToken: 'r' }));

    await refreshSession();
    await refreshSession();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports "expired" when there is no refresh token, without calling the API', async () => {
    const { refreshSession } = await loadSession();

    await expect(refreshSession()).resolves.toEqual({ status: 'expired' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports "expired" when the server rejects the refresh token', async () => {
    const { refreshSession } = await loadSession();
    seedSession();
    fetchMock.mockResolvedValue(json(401, { message: 'Invalid refresh token' }));

    await expect(refreshSession()).resolves.toEqual({ status: 'expired' });
  });

  it('does NOT end the session on a network error (offline is not signed out)', async () => {
    const { refreshSession, getRefreshToken } = await loadSession();
    seedSession();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(refreshSession()).resolves.toEqual({ status: 'unavailable' });
    expect(getRefreshToken()).toBe('refresh-1'); // still usable once the network returns
  });

  it('does NOT end the session on a 500 from the auth service', async () => {
    const { refreshSession } = await loadSession();
    seedSession();
    fetchMock.mockResolvedValue(json(500));

    await expect(refreshSession()).resolves.toEqual({ status: 'unavailable' });
  });

  it('adopts a pair another tab stored while our rotation was in flight', async () => {
    // Two tabs each hold refresh-1. Tab A rotates first; tab B's call 401s on the revoked
    // token. Tab B must adopt what tab A wrote instead of logging the user out.
    const { refreshSession } = await loadSession();
    seedSession();
    fetchMock.mockImplementation(async () => {
      seedSession('access-from-other-tab', 'refresh-from-other-tab');
      return json(401);
    });

    await expect(refreshSession()).resolves.toEqual({
      status: 'refreshed',
      accessToken: 'access-from-other-tab',
    });
  });
});

describe('authFetch', () => {
  it('sends the STORED access token, not a stale one captured by the caller', async () => {
    // Pages capture `token` at mount and pass it down; after a rotation that value is dead.
    const { authFetch } = await loadSession();
    seedSession('fresh-access', 'refresh-1');
    fetchMock.mockResolvedValue(json(200));

    await authFetch('/firms/me', {}, 'stale-access-from-page-mount');

    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer fresh-access');
  });

  it('refreshes once on 401 and replays the request with the new token', async () => {
    const { authFetch } = await loadSession();
    seedSession();
    fetchMock
      .mockResolvedValueOnce(json(401))
      .mockResolvedValueOnce(json(200, { accessToken: 'access-2', refreshToken: 'refresh-2' }))
      .mockResolvedValueOnce(json(200, { ok: true }));

    const res = await authFetch('/firms/me');

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const replayHeaders = (fetchMock.mock.calls[2]?.[1] as RequestInit).headers as Record<string, string>;
    expect(replayHeaders.Authorization).toBe('Bearer access-2');
  });

  it('does not retry more than once (no infinite 401 loop)', async () => {
    const { authFetch } = await loadSession();
    seedSession();
    fetchMock
      .mockResolvedValueOnce(json(401))
      .mockResolvedValueOnce(json(200, { accessToken: 'access-2', refreshToken: 'refresh-2' }))
      .mockResolvedValueOnce(json(401));

    const res = await authFetch('/firms/me');

    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does NOT refresh on a credential-check 401 (a wrong current password is not an expiry)', async () => {
    const { authFetch } = await loadSession();
    seedSession();
    fetchMock.mockResolvedValue(json(401, { message: 'Current password is incorrect' }));

    const res = await authFetch('/auth/change-password', { method: 'POST' });

    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no refresh attempt
  });

  it('shares one refresh across a burst of parallel requests', async () => {
    // The dashboard fires several calls at once; they must not each rotate the token.
    const { authFetch } = await loadSession();
    seedSession();
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (url.endsWith('/auth/refresh')) return json(200, { accessToken: 'access-2', refreshToken: 'refresh-2' });
      const auth = (init.headers as Record<string, string> | undefined)?.Authorization;
      // Only the rotated token is accepted — the original access token is "expired".
      return auth === 'Bearer access-2' ? json(200, { ok: true }) : json(401);
    });

    const responses = await Promise.all([
      authFetch('/a'),
      authFetch('/b'),
      authFetch('/c'),
      authFetch('/d'),
      authFetch('/e'),
      authFetch('/f'),
    ]);

    expect(responses.every((r) => r.status === 200)).toBe(true);
    const refreshCalls = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
  });
});

describe('endSession / signOut', () => {
  it('clears tokens and redirects once, however many callers pile in', async () => {
    const { endSession } = await loadSession();
    seedSession();

    endSession();
    location.href = 'http://app.test/somewhere-else'; // simulate a slow navigation
    endSession();
    endSession();

    expect(storage.getItem('lcos_access')).toBeNull();
    expect(storage.getItem('lcos_refresh')).toBeNull();
    expect(location.href).toBe('http://app.test/somewhere-else'); // not re-navigated
  });

  it('revokes the refresh token server-side before clearing it locally', async () => {
    const { signOut } = await loadSession();
    seedSession();
    fetchMock.mockResolvedValue(json(200, { ok: true }));

    await signOut();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_URL}/auth/logout`);
    expect(JSON.parse(init.body as string)).toEqual({ refreshToken: 'refresh-1' });
    expect(storage.getItem('lcos_access')).toBeNull();
    expect(location.href).toBe('/login');
  });

  it('still signs out locally when the revoke call fails', async () => {
    const { signOut } = await loadSession();
    seedSession();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await signOut();

    expect(storage.getItem('lcos_refresh')).toBeNull();
    expect(location.href).toBe('/login');
  });
});

describe('api wrappers', () => {
  it('leaves anonymous calls alone — no refresh, no redirect on 401', async () => {
    // A wrong password on the login form must render an error, not bounce the page.
    const { apiPost } = await loadApi();
    fetchMock.mockResolvedValue(json(401, { message: 'Invalid credentials' }));

    await expect(apiPost('/auth/login', { email: 'a@b.c', password: 'nope' })).rejects.toThrow('Request failed: 401');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(location.href).toBe('http://app.test/app');
  });

  it('ends the session when an authenticated call is still 401 after a refresh', async () => {
    const { apiGet } = await loadApi();
    seedSession();
    fetchMock
      .mockResolvedValueOnce(json(401))
      .mockResolvedValueOnce(json(401)) // refresh rejected
      .mockResolvedValue(json(401));

    await expect(apiGet('/firms/me', 'access-1')).rejects.toThrow('Session expired');
    expect(storage.getItem('lcos_access')).toBeNull();
    expect(location.href).toBe('/login');
  });

  it('transparently recovers an expired access token — the caller never sees the 401', async () => {
    const { apiGet } = await loadApi();
    seedSession();
    fetchMock
      .mockResolvedValueOnce(json(401))
      .mockResolvedValueOnce(json(200, { accessToken: 'access-2', refreshToken: 'refresh-2' }))
      .mockResolvedValueOnce(json(200, { firms: [] }));

    await expect(apiGet('/firms/me', 'access-1')).resolves.toEqual({ firms: [] });
    expect(storage.getItem('lcos_access')).toBe('access-2');
    expect(location.href).toBe('http://app.test/app'); // never redirected
  });
});
