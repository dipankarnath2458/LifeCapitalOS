/**
 * Browser session: token storage, single-flight refresh, and the authenticated fetch
 * every client-side API call goes through.
 *
 * Why this exists
 * ---------------
 * Access tokens live 15 minutes (`JWT_ACCESS_TTL`). Before this module the refresh token
 * was written at login and never used, so every signed-in user was ejected to /login a
 * quarter of an hour after signing in.
 *
 * Why refresh MUST be single-flight
 * ---------------------------------
 * `AuthService.refresh()` **rotates**: it revokes the presented refresh token and issues a
 * new pair. The dashboard fires several requests in parallel, so N concurrent refreshes
 * would each revoke the token the others are holding and the user would be logged out
 * anyway. One in-flight refresh is shared by every caller that needs it.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

const ACCESS_KEY = 'lcos_access';
const REFRESH_KEY = 'lcos_refresh';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export type RefreshResult =
  /** A new pair was issued and stored. */
  | { status: 'refreshed'; accessToken: string }
  /** No refresh token, or the server rejected it. The session is over — sign in again. */
  | { status: 'expired' }
  /** Network/server fault. The session may still be valid, so do NOT sign the user out. */
  | { status: 'unavailable' };

/* ------------------------------------------------------------------ storage */

function store(): Storage | null {
  // Guarded for SSR and for browsers that block storage (Safari private mode throws).
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function getAccessToken(): string | null {
  return store()?.getItem(ACCESS_KEY) ?? null;
}

export function getRefreshToken(): string | null {
  return store()?.getItem(REFRESH_KEY) ?? null;
}

/**
 * The household id resolved for this session, cached by `lib/household`.
 *
 * The key lives here so the module that CLEARS session state and the module that writes it
 * cannot drift apart — a stale key would silently leave one family's id readable to the next
 * person signing in on the same browser.
 */
export const HOUSEHOLD_ID_KEY = 'lcos_household_id';

export function setTokens(tokens: TokenPair): void {
  const s = store();
  if (!s) return;
  s.setItem(ACCESS_KEY, tokens.accessToken);
  s.setItem(REFRESH_KEY, tokens.refreshToken);
}

export function clearTokens(): void {
  const s = store();
  if (!s) return;
  s.removeItem(ACCESS_KEY);
  s.removeItem(REFRESH_KEY);
  // The cached household id belongs to the session that just ended. Leaving it behind would
  // hand the next person to sign in on this browser someone else's household id.
  s.removeItem(HOUSEHOLD_ID_KEY);
}

let ending = false;

/**
 * The session is unrecoverable: drop the tokens and send the user to sign in.
 * Idempotent — a burst of parallel 401s must not fire a burst of navigations.
 */
export function endSession(): void {
  clearTokens();
  if (typeof window === 'undefined' || ending) return;
  ending = true;
  window.location.href = '/login';
}

/* ------------------------------------------------------------------ refresh */

let inFlight: Promise<RefreshResult> | null = null;

/** Shared single-flight wrapper around {@link performRefresh}. */
export function refreshSession(): Promise<RefreshResult> {
  if (inFlight) return inFlight;
  inFlight = performRefresh().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function performRefresh(): Promise<RefreshResult> {
  const presented = getRefreshToken();
  if (!presented) return { status: 'expired' };

  let res: Response;
  try {
    res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: presented }),
    });
  } catch {
    // Offline or DNS/TLS failure — the refresh token is probably still good.
    return { status: 'unavailable' };
  }

  if (res.status === 401 || res.status === 403) {
    // Rotation means another tab may have spent this token microseconds ago and stored a
    // fresh pair. If storage moved on under us, trust that pair rather than logging out.
    const current = getRefreshToken();
    const access = getAccessToken();
    if (current && current !== presented && access) return { status: 'refreshed', accessToken: access };
    return { status: 'expired' };
  }
  if (!res.ok) return { status: 'unavailable' };

  let tokens: Partial<TokenPair>;
  try {
    tokens = (await res.json()) as Partial<TokenPair>;
  } catch {
    return { status: 'unavailable' };
  }
  if (!tokens.accessToken || !tokens.refreshToken) return { status: 'unavailable' };

  setTokens(tokens as TokenPair);
  return { status: 'refreshed', accessToken: tokens.accessToken };
}

/* ------------------------------------------------------------------- fetch */

/** Thrown when a request could not be authenticated even after a refresh attempt. */
export class SessionExpiredError extends Error {
  constructor() {
    super('Session expired');
    this.name = 'SessionExpiredError';
  }
}

function withAuth(init: RequestInit, token: string | null): RequestInit {
  if (!token) return init;
  return { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } };
}

/**
 * Endpoints where a 401 means "the credential you just submitted was wrong", not "your
 * session ended". Refreshing or signing the user out on these would be actively harmful:
 * a mistyped *current* password on the change-password form would log them out.
 */
const CREDENTIAL_CHECK_PATHS = [
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/otp/verify',
  '/auth/change-password',
  '/auth/reset-password',
];

export function isCredentialCheck(path: string): boolean {
  return CREDENTIAL_CHECK_PATHS.some((p) => path === p || path.startsWith(`${p}?`));
}

/**
 * Fetch an API path with the *current* session token, refreshing once on a 401.
 *
 * Callers may pass a token they captured earlier (the pre-existing `apiGet(path, token)`
 * signature does). That captured value goes stale the moment a refresh rotates the pair,
 * so the stored token wins whenever one exists: there is only ever one session in the tab,
 * and localStorage is its source of truth. `fallbackToken` is used only when nothing is
 * stored, which keeps the old signatures working in non-browser contexts.
 *
 * Returns the raw Response so callers keep their own status handling (admin pages, for
 * example, treat 403 differently from 401).
 */
export async function authFetch(path: string, init: RequestInit = {}, fallbackToken?: string): Promise<Response> {
  const token = getAccessToken() ?? fallbackToken ?? null;
  const first = await fetch(`${API_URL}${path}`, withAuth(init, token));
  if (first.status !== 401 || isCredentialCheck(path)) return first;

  const result = await refreshSession();
  if (result.status !== 'refreshed') return first;

  return fetch(`${API_URL}${path}`, withAuth(init, result.accessToken));
}

/**
 * Sign out. Revokes the refresh token server-side first — without this, signing out only
 * cleared localStorage and left a token valid for `JWT_REFRESH_TTL_DAYS` (30) in the
 * database. Best-effort: a failed call must never trap the user in a signed-in shell, so
 * the local clear + redirect happen either way.
 */
export async function signOut(): Promise<void> {
  const refreshToken = getRefreshToken();
  if (refreshToken) {
    try {
      await authFetch('/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      /* offline or API down — fall through to the local sign-out */
    }
  }
  endSession();
}
