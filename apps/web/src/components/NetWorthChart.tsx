'use client';

import { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiGet, apiPost } from '@/lib/api';

interface Snapshot {
  assetsMinor: number;
  liabilitiesMinor: number;
  netWorthMinor: number;
  currency: string;
  capturedAt: string;
}

const inrCompact = (minor: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(minor / 100);

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });

/** Net-worth over time from /net-worth/timeline, with a button to capture a snapshot. */
export function NetWorthChart({ token }: { token: string }) {
  const [data, setData] = useState<Snapshot[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setData(await apiGet<Snapshot[]>('/net-worth/timeline', token));
    } catch {
      setData([]);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function capture() {
    setBusy(true);
    try {
      await apiPost('/net-worth/snapshot', {}, token);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const points = (data ?? []).map((s) => ({ date: fmtDate(s.capturedAt), net: s.netWorthMinor / 100 }));

  return (
    <div className="rounded-2xl bg-white p-6 shadow">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Net Worth Over Time</h2>
        <button
          onClick={capture}
          disabled={busy}
          className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Capture snapshot'}
        </button>
      </div>
      {data === null ? (
        <p className="text-slate-500">Loading…</p>
      ) : points.length < 2 ? (
        <p className="text-slate-500">
          Capture a snapshot now and again over time to see your net-worth trend.
        </p>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0f766e" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#0f766e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#94a3b8" />
              <YAxis
                tickFormatter={(v: number) => inrCompact(v * 100)}
                tick={{ fontSize: 12 }}
                stroke="#94a3b8"
                width={64}
              />
              <Tooltip formatter={(v: number) => inrCompact(v * 100)} labelClassName="text-slate-500" />
              <Area type="monotone" dataKey="net" stroke="#0f766e" strokeWidth={2} fill="url(#nwFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
