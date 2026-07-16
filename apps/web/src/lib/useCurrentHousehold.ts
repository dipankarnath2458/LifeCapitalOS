'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';

export interface HouseholdRow {
  id: string;
  name: string;
  baseCurrency: string;
  status: string;
}
interface HouseholdList {
  total: number;
  data: HouseholdRow[];
}

const STORAGE_KEY = 'lcos_dashboard_household';

/**
 * Resolves the advisor's households and the "current family" for the dashboard.
 * Persists the selection (localStorage) so the dashboard reopens on the same family —
 * the home-page behaviour. Read-only; the API enforces scope server-side.
 */
export function useCurrentHousehold(token: string) {
  const [households, setHouseholds] = useState<HouseholdRow[] | null>(null);
  const [selectedId, setSelectedIdState] = useState<string>('');
  const [error, setError] = useState(false);

  useEffect(() => {
    apiGet<HouseholdList>('/households?take=100', token)
      .then((list) => {
        setHouseholds(list.data);
        const remembered =
          typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
        const valid = list.data.find((h) => h.id === remembered);
        setSelectedIdState(valid?.id ?? list.data[0]?.id ?? '');
      })
      .catch(() => {
        setHouseholds([]);
        setError(true);
      });
  }, [token]);

  function setSelectedId(id: string) {
    setSelectedIdState(id);
    if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, id);
  }

  const selected = (households ?? []).find((h) => h.id === selectedId) ?? null;
  return { households, selected, selectedId, setSelectedId, error };
}
