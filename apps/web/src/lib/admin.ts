const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

/** Roles that may see the admin panel (mirrors the API's RolesGuard on /admin/*). */
export const ADMIN_ROLES = ['ADMIN', 'SUPERADMIN', 'SUPPORT', 'ANALYST'];

export function isAdminRole(role?: string | null): boolean {
  return !!role && ADMIN_ROLES.includes(role);
}

function token(): string | null {
  return typeof window !== 'undefined' ? localStorage.getItem('lcos_access') : null;
}

/**
 * Admin requests reuse the signed-in user's session. A 401 means not signed in
 * (back to login); a 403 means signed in but not an admin (back to the app). The
 * API enforces the same rule server-side, so this is UX, not the security boundary.
 */
async function handle<T>(res: Response): Promise<T> {
  if (typeof window !== 'undefined') {
    if (res.status === 401) {
      window.location.href = '/login';
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
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  return handle<T>(res);
}

export async function adminSend<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return handle<T>(res);
}
