'use client';

import { Select } from '@/ui';
import type { HouseholdRow } from '@/lib/useCurrentHousehold';

/** Picks the current family for the dashboard. Selection is persisted by the hook. */
export function HouseholdSelector({
  households,
  selectedId,
  onChange,
}: {
  households: HouseholdRow[];
  selectedId: string;
  onChange: (id: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-subtle">
      <span className="sr-only">Select family</span>
      <Select
        aria-label="Select family"
        value={selectedId}
        onChange={(e) => onChange(e.target.value)}
      >
        {households.map((h) => (
          <option key={h.id} value={h.id}>
            {h.name}
          </option>
        ))}
      </Select>
    </label>
  );
}
