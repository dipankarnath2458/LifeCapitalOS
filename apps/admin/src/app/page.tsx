'use client';

import { useEffect, useState } from 'react';
import { apiHealth, login } from '@/lib/api';

export default function AdminLogin() {
  const [email, setEmail] = useState('roshan.manuel@gmail.com');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<string | null>(null);

  useEffect(() => {
    apiHealth().then((h) => setHealth(h.ok ? null : `API status: ${h.detail}`));
  }, []);

  async function submit() {
    setError(null);
    try {
      await login(email, password);
      window.location.href = '/dashboard';
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow">
        <h1 className="mb-1 text-2xl font-bold text-brand">Admin Panel</h1>
        <p className="mb-6 text-sm text-slate-500">Sign in with an elevated account.</p>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="mb-4 w-full rounded-lg border border-slate-200 px-3 py-2"
        />
        <button
          onClick={submit}
          className="w-full rounded-xl bg-brand px-4 py-3 font-semibold text-white hover:bg-brand-dark"
        >
          Sign in
        </button>
        {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}
        {health && <p className="mt-2 text-xs text-amber-600">{health}</p>}
      </div>
    </main>
  );
}
