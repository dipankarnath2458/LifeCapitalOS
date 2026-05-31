const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

function token(): string | null {
  return typeof window !== 'undefined' ? localStorage.getItem('lcos_admin_token') : null;
}

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 401 || res.status === 403) {
    if (typeof window !== 'undefined') window.location.href = '/';
    throw new Error('Unauthorized');
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

export async function login(email: string, password: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    // Network/CORS failure — usually NEXT_PUBLIC_API_URL is unset/wrong or the API is down.
    throw new Error(`Cannot reach the API at ${API_URL}. Check NEXT_PUBLIC_API_URL and CORS.`);
  }
  if (res.status === 401) throw new Error('Invalid email or password.');
  if (res.status >= 500) {
    throw new Error(`API error ${res.status}. The server likely cannot reach the database (check DATABASE_URL).`);
  }
  if (!res.ok) throw new Error(`Login failed (HTTP ${res.status}).`);
  const data = (await res.json()) as { accessToken: string };
  localStorage.setItem('lcos_admin_token', data.accessToken);
}

/** Lightweight connectivity probe so the login screen can show API/DB status. */
export async function apiHealth(): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${API_URL}/health`);
    if (!res.ok) return { ok: false, detail: `API responded HTTP ${res.status}` };
    const body = (await res.json()) as { status?: string; db?: string };
    return { ok: body.db === 'up', detail: `api:${body.status ?? '?'} db:${body.db ?? '?'}` };
  } catch {
    return { ok: false, detail: `unreachable at ${API_URL}` };
  }
}
