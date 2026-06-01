'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPut } from '@/lib/api';

interface Profile {
  hasTermCover?: boolean;
  hasHealthInsurance?: boolean;
  termLifeCoverMinor?: number | string;
}

/**
 * Protection editor — captures term & health insurance status so the Insurance
 * Gap and Early Warning signals reflect real data. PUT /profile.
 */
export function Protection({ token, onSaved }: { token: string; onSaved?: () => void }) {
  const [term, setTerm] = useState(false);
  const [health, setHealth] = useState(false);
  const [cover, setCover] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiGet<Profile>('/profile', token)
      .then((p) => {
        setTerm(!!p.hasTermCover);
        setHealth(!!p.hasHealthInsurance);
        if (p.termLifeCoverMinor) setCover(String(Number(p.termLifeCoverMinor) / 100));
      })
      .catch(() => {});
  }, [token]);

  async function save() {
    await apiPut('/profile', {
      hasTermCover: term,
      hasHealthInsurance: health,
      termLifeCoverMinor: Math.round(parseFloat(cover || '0') * 100),
    }, token);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    onSaved?.();
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow">
      <h2 className="mb-1 text-lg font-semibold">Protection</h2>
      <p className="mb-4 text-sm text-slate-500">
        Tell us about your insurance so we can flag gaps accurately.
      </p>
      <div className="space-y-3">
        <label className="flex items-center justify-between">
          <span className="text-sm">I have term life insurance</span>
          <input type="checkbox" checked={term} onChange={(e) => setTerm(e.target.checked)} />
        </label>
        {term && (
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="Term cover amount (₹)"
            value={cover}
            onChange={(e) => setCover(e.target.value)}
          />
        )}
        <label className="flex items-center justify-between">
          <span className="text-sm">I have health insurance</span>
          <input type="checkbox" checked={health} onChange={(e) => setHealth(e.target.checked)} />
        </label>
        <button
          onClick={save}
          className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
        >
          {saved ? 'Saved ✓' : 'Save protection details'}
        </button>
      </div>
    </div>
  );
}
