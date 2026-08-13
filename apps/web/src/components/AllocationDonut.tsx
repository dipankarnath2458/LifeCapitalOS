'use client';

import { useEffect, useMemo, useState } from 'react';
import { allocationFromValues, type Allocation, type AssetClass } from '@lcos/core';
import { apiGet } from '@/lib/api';
import { Skeleton } from './Skeleton';
import { AllocationDonutChart } from './charts/AllocationDonutChart';

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
        <div className="flex items-center gap-4">
          <Skeleton className="h-48 w-48 rounded-full" />
          <Skeleton className="h-24 flex-1" />
        </div>
      ) : slices.length === 0 ? (
        <p className="text-slate-500">
          Add investment accounts with an asset class to see your allocation.
        </p>
      ) : (
        <AllocationDonutChart slices={slices} />
      )}
    </div>
  );
}
