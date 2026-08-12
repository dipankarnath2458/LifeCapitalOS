import { authFetch, endSession, isCredentialCheck, SessionExpiredError } from './session';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

/**
 * Client-side API helpers.
 *
 * The four exported signatures are unchanged — `token` is still optional and still marks a
 * request as authenticated. What changed is what happens underneath: authenticated calls go
 * through {@link authFetch}, which transparently refreshes an expired access token once
 * (single-flight, see `session.ts`) instead of failing. A 401 that survives the refresh
 * ends the session properly — tokens cleared, redirected to /login — rather than leaving a
 * half-signed-in tab holding dead tokens.
 *
 * Unauthenticated calls (login, register, OTP, forgot-password) are untouched: no refresh,
 * no redirect, the caller still sees the thrown error and renders its own message.
 */

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

async function request<T>(path: string, init: RequestInit, token?: string): Promise<T> {
  // No token means the caller is deliberately anonymous — never refresh, never redirect.
  if (!token) {
    const res = await fetch(`${API_URL}${path}`, init);
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return res.json() as Promise<T>;
  }

  const res = await authFetch(path, init, token);
  if (res.status === 401 && !isCredentialCheck(path)) {
    endSession();
    throw new SessionExpiredError();
  }
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown, token?: string): Promise<T> {
  return request<T>(path, jsonInit('POST', body), token);
}

export async function apiGet<T>(path: string, token?: string): Promise<T> {
  return request<T>(path, {}, token);
}

export async function apiPut<T>(path: string, body: unknown, token?: string): Promise<T> {
  return request<T>(path, jsonInit('PUT', body), token);
}

/** Partial update. The household kernel exposes PATCH for accounts, debts and transactions. */
export async function apiPatch<T>(path: string, body: unknown, token?: string): Promise<T> {
  return request<T>(path, jsonInit('PATCH', body), token);
}

export async function apiDelete<T>(path: string, token?: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' }, token);
}
