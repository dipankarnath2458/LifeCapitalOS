'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { BAND_META, StatusBadge, StatusDot, type Band } from './Status';

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
    <section className="rounded-2xl bg-white p-6 shadow" aria-labelledby="ew-heading">
      <div className="mb-4 flex items-center justify-between">
        <h2 id="ew-heading" className="text-lg font-semibold">
          Wealth Early Warning
        </h2>
        {data && <StatusBadge band={data.overall} headline={HEAD[data.overall]} />}
      </div>

      {err ? (
        <p className="text-slate-500">Could not load alerts right now.</p>
      ) : !data ? (
        <p className="text-slate-500">Scanning your finances…</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {data.signals.map((s) => (
            <li key={s.key} className={`rounded-xl p-3 ring-1 ${BAND_META[s.status].ring}`}>
              <div className="flex items-center gap-2">
                <StatusDot band={s.status} />
                <span className="text-sm font-medium">{s.label}</span>
                <span className={`ml-auto text-xs font-medium ${BAND_META[s.status].text}`}>
                  {BAND_META[s.status].label}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-600">{s.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
