'use client';

import { useState } from 'react';
import { apiGet } from '@/lib/api';

interface Opinion {
  current: Record<string, number>;
  recommended: Record<string, number>;
  drift: Record<string, number>;
  findings: string[];
  review: string;
  ai: boolean;
}

const LABEL: Record<string, string> = {
  equity: 'Equity',
  debt: 'Debt',
  gold: 'Gold',
  real_estate: 'Real Estate',
  cash: 'Cash',
  crypto: 'Crypto',
  business: 'Business',
  other: 'Other',
};

/** AI Second Opinion — portfolio allocation review. Calls GET /api/ai/second-opinion. */
export function SecondOpinion({ token }: { token: string }) {
  const [data, setData] = useState<Opinion | null>(null);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);

  async function run() {
    setBusy(true);
    try {
      setData(await apiGet<Opinion>('/ai/second-opinion', token));
    } catch (e) {
      if (e instanceof Error && e.message.includes('403')) setLocked(true);
    } finally {
      setBusy(false);
    }
  }

  if (locked) {
    return (
      <div className="rounded-2xl bg-white p-6 shadow">
        <h2 className="text-lg font-semibold">AI Second Opinion</h2>
        <p className="mt-2 text-sm text-slate-600">A Premium feature — upgrade to unlock.</p>
        <a
          href="/billing"
          className="mt-3 inline-block rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark"
        >
          See plans
        </a>
      </div>
    );
  }

  const rows = data
    ? Object.keys(LABEL).filter((k) => (data.current[k] ?? 0) > 0 || (data.recommended[k] ?? 0) > 0)
    : [];

  return (
    <div className="rounded-2xl bg-white p-6 shadow">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-lg font-semibold">AI Second Opinion</h2>
        <button
          onClick={run}
          disabled={busy}
          className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {busy ? 'Reviewing…' : data ? 'Re-run' : 'Review my portfolio'}
        </button>
      </div>
      <p className="mb-4 text-sm text-slate-500">
        A review of your asset allocation vs the recommended mix for your risk profile.
      </p>

      {!data ? (
        <p className="text-slate-500">Add investment accounts, then run a review.</p>
      ) : (
        <div className="space-y-5">
          <div>
            {rows.map((k) => (
              <div key={k} className="mb-2">
                <div className="flex justify-between text-sm">
                  <span>{LABEL[k]}</span>
                  <span className="text-slate-500">
                    {data.current[k] ?? 0}% <span className="text-slate-300">/</span>{' '}
                    {data.recommended[k] ?? 0}% target
                  </span>
                </div>
                <div className="flex h-2 overflow-hidden rounded bg-slate-100">
                  <div className="bg-brand" style={{ width: `${data.current[k] ?? 0}%` }} />
                </div>
              </div>
            ))}
          </div>

          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            {data.findings.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>

          <div className="rounded-xl bg-slate-50 p-4 text-sm whitespace-pre-wrap text-slate-800">
            {data.review}
          </div>
          {!data.ai && (
            <p className="text-xs text-amber-600">
              Showing the rules-based review. Set ANTHROPIC_API_KEY to enable the AI narrative.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
