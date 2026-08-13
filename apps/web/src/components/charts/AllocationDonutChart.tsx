'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

/**
 * The allocation donut itself — **drawing only, no fetching and no arithmetic**.
 *
 * Extracted from `AllocationDonut` so V1 and V2 render the *same* chart rather than two
 * implementations that drift. V1's component keeps its retail fetching and its client-side
 * allocation maths; V2 passes slices straight from the Financial Intelligence Layer, which has
 * already computed the percentages server-side.
 *
 * That asymmetry is the whole reason this split exists. The V1 component could not simply be
 * mounted in V2: it fetches `/accounts` (retail, `userId`-keyed), which is empty for a V2
 * consumer, and it computes the allocation in the browser, which V2 forbids.
 */

export interface DonutSlice {
  /** Display label, already humanised by the caller. */
  name: string;
  /** Percentage, 0–100. */
  value: number;
}

/** Teal-family palette so the donut reads as one coherent chart. Unchanged from V1. */
export const DONUT_COLORS = [
  '#0f766e',
  '#0d9488',
  '#14b8a6',
  '#2dd4bf',
  '#5eead4',
  '#99f6e4',
  '#f59e0b',
  '#94a3b8',
];

export function AllocationDonutChart({ slices }: { slices: DonutSlice[] }) {
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="h-48 w-48 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius={48}
              outerRadius={80}
              paddingAngle={2}
            >
              {slices.map((_, i) => (
                <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
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
              <span
                className="inline-block h-3 w-3 rounded-sm"
                style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }}
              />
              {s.name}
            </span>
            <span className="text-muted-foreground">{s.value}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
