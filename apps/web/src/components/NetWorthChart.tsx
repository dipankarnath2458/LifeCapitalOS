'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { Skeleton } from './Skeleton';
import { formatTrendDate, NetWorthTrendChart } from './charts/NetWorthTrendChart';

interface Snapshot {
  assetsMinor: number;
  liabilitiesMinor: number;
  netWorthMinor: number;
  currency: string;
  capturedAt: string;
}

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

  const points = (data ?? []).map((s) => ({ date: formatTrendDate(s.capturedAt), net: s.netWorthMinor / 100 }));

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
        <Skeleton className="h-64 w-full" />
      ) : points.length < 2 ? (
        <p className="text-slate-500">
          Capture a snapshot now and again over time to see your net-worth trend.
        </p>
      ) : (
        <NetWorthTrendChart points={points} />
      )}
    </div>
  );
}
