import { authFetch, endSession } from './session';

/** Roles that may see the admin panel (mirrors the API's RolesGuard on /admin/*). */
export const ADMIN_ROLES = ['ADMIN', 'SUPERADMIN', 'SUPPORT', 'ANALYST'];

export function isAdminRole(role?: string | null): boolean {
  return !!role && ADMIN_ROLES.includes(role);
}

/**
 * Admin requests reuse the signed-in user's session, so they go through {@link authFetch}
 * and get the same single-flight token refresh as the rest of the app — an admin sitting on
 * a page for 15 minutes should not be bounced to /login.
 *
 * A 401 that survives the refresh means not signed in (end the session); a 403 means signed
 * in but not an admin (back to the app). The API enforces the same rule server-side, so this
 * is UX, not the security boundary.
 */
async function handle<T>(res: Response): Promise<T> {
  if (typeof window !== 'undefined') {
    if (res.status === 401) {
      // Clears the dead tokens too — the old code left them behind, so the next page load
      // looked signed in and failed again.
      endSession();
      throw new Error('Unauthorized');
    }
    if (res.status === 403) {
      window.location.href = '/dashboard';
      throw new Error('Forbidden');
    }
  }
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function adminGet<T>(path: string): Promise<T> {
  return handle<T>(await authFetch(path));
}

export async function adminSend<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await authFetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return handle<T>(res);
}
