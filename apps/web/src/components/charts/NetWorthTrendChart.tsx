'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * The net-worth trend area chart — **drawing only, no fetching and no write path**.
 *
 * Extracted from `NetWorthChart` so V1 and V2 render the same chart. V1's component keeps its
 * retail timeline fetch *and its "Capture snapshot" button*; V2 passes points from the household
 * snapshot timeline and has no button.
 *
 * The button is why this split was necessary rather than merely tidy. `/household` is read-only by
 * design — an existing e2e asserts that viewing it captures no snapshot — so mounting V1's
 * component there would have put a snapshot-writing control on a page that must not write.
 */

export interface TrendPoint {
  /** Formatted date label, prepared by the caller. */
  date: string;
  /** Net worth in MAJOR units — the chart's axis and tooltip both format from this. */
  net: number;
}

const inrCompact = (major: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(major);

/** ISO timestamp → the short date the axis shows. */
export const formatTrendDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });

export function NetWorthTrendChart({ points }: { points: TrendPoint[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0f766e" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#0f766e" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#94a3b8" />
          <YAxis
            tickFormatter={(v: number) => inrCompact(v)}
            tick={{ fontSize: 12 }}
            stroke="#94a3b8"
            width={64}
          />
          <Tooltip formatter={(v: number) => inrCompact(v)} labelClassName="text-slate-500" />
          <Area type="monotone" dataKey="net" stroke="#0f766e" strokeWidth={2} fill="url(#nwFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
