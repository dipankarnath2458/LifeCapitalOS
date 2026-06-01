'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';

type Band = 'green' | 'yellow' | 'red';
interface Signal {
  key: string;
  label: string;
  status: Band;
  detail: string;
}
interface Report {
  signals: Signal[];
  overall: Band;
  redCount: number;
  yellowCount: number;
}

const DOT: Record<Band, string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-500',
  red: 'bg-rose-500',
};
const RING: Record<Band, string> = {
  green: 'ring-emerald-200 bg-emerald-50',
  yellow: 'ring-amber-200 bg-amber-50',
  red: 'ring-rose-200 bg-rose-50',
};
const HEAD: Record<Band, string> = {
  green: 'All healthy',
  yellow: 'Attention needed',
  red: 'Immediate action',
};

/** Wealth Early Warning System — traffic-light monitor. GET /insights/early-warning. */
export function EarlyWarning({ token }: { token: string }) {
  const [data, setData] = useState<Report | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    apiGet<Report>('/insights/early-warning', token).then(setData).catch(() => setErr(true));
  }, [token]);

  return (
    <div className="rounded-2xl bg-white p-6 shadow">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Wealth Early Warning</h2>
        {data && (
          <span className={`flex items-center gap-2 rounded-full px-3 py-1 text-sm ring-1 ${RING[data.overall]}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${DOT[data.overall]}`} />
            {HEAD[data.overall]}
          </span>
        )}
      </div>

      {err ? (
        <p className="text-slate-500">Could not load alerts right now.</p>
      ) : !data ? (
        <p className="text-slate-500">Scanning your finances…</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {data.signals.map((s) => (
            <li key={s.key} className={`rounded-xl p-3 ring-1 ${RING[s.status]}`}>
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${DOT[s.status]}`} />
                <span className="text-sm font-medium">{s.label}</span>
              </div>
              <p className="mt-1 text-xs text-slate-600">{s.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
