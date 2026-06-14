'use client';

import { useEffect, useMemo, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { allocationFromValues, type Allocation, type AssetClass } from '@lcos/core';
import { apiGet } from '@/lib/api';

interface Account {
  id: string;
  balanceMinor: number;
  isLiability: boolean;
  assetClass?: AssetClass | null;
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

// Teal-family palette so the donut reads as one coherent chart.
const COLORS = ['#0f766e', '#0d9488', '#14b8a6', '#2dd4bf', '#5eead4', '#99f6e4', '#f59e0b', '#94a3b8'];

/** Current asset allocation, computed client-side from accounts via @lcos/core. */
export function AllocationDonut({ token }: { token: string }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);

  useEffect(() => {
    apiGet<Account[]>('/accounts', token)
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }, [token]);

  const slices = useMemo(() => {
    if (!accounts) return [];
    const byClass: Allocation = {};
    for (const a of accounts) {
      if (a.isLiability || !a.assetClass) continue;
      byClass[a.assetClass] = (byClass[a.assetClass] ?? 0) + a.balanceMinor;
    }
    if (Object.keys(byClass).length === 0) return [];
    const pct = allocationFromValues(byClass);
    return Object.entries(pct)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => ({ name: LABEL[k] ?? k, value: v }));
  }, [accounts]);

  return (
    <div className="rounded-2xl bg-white p-6 shadow">
      <h2 className="mb-4 text-lg font-semibold">Asset Allocation</h2>
      {accounts === null ? (
        <p className="text-slate-500">Loading…</p>
      ) : slices.length === 0 ? (
        <p className="text-slate-500">
          Add investment accounts with an asset class to see your allocation.
        </p>
      ) : (
        <div className="flex flex-col items-center gap-4 sm:flex-row">
          <div className="h-48 w-48 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={slices} dataKey="value" nameKey="name" innerRadius={48} outerRadius={80} paddingAngle={2}>
                  {slices.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => `${v}%`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="flex-1 space-y-1 text-sm">
            {slices.map((s, i) => (
              <li key={s.name} className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
                  {s.name}
                </span>
                <span className="text-slate-500">{s.value}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
