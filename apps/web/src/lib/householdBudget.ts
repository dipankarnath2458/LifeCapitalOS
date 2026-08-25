import { apiGet, apiPost } from './api';

/**
 * The monthly budget, for the consumer (M5.13).
 *
 * Design: `docs/M5_13_WHATIF_AND_BUDGET_ARCHITECTURE.md`.
 *
 * **No arithmetic in this file, and none in the page that uses it.** Every remaining balance,
 * utilisation and over-budget flag below is one `evaluateBudget` returned through the API. The
 * only computation here is a unit conversion and the current month's label.
 *
 * ## What "actual" means here, and why the page says so
 *
 * Actual spend is never stored — it is aggregated live from the cashflow ledger for the month.
 * For a consumer that ledger is currently written by the Wealth Health Check, which records the
 * month's total spending as a single `living` line. So a family's real spending is present in
 * full, but it arrives as one category rather than several, and a budget set against categories
 * they have never used would compare their envelopes to nothing.
 *
 * The API already tells us this rather than hiding it: `uncategorized` lists spend that no
 * envelope covers. The page surfaces it prominently instead of silently reporting a family as
 * under budget because their spending sits outside the categories they budgeted. Recording
 * categorised spending is a separate decision — see §6 of the design note.
 */

/** One category envelope as the family set it, with the month's spend against it. */
export interface BudgetLineStatus {
  category: string;
  limitMinor: number;
  spentMinor: number;
  remainingMinor: number;
  /** `spent / limit`, as a ratio. `0` when the limit is zero. */
  utilization: number;
  overBudget: boolean;
}

/** Spend the ledger holds that no envelope covers. Never folded into the totals silently. */
export interface UncategorizedSpend {
  category: string;
  spentMinor: number;
}

export interface BudgetMonth {
  periodMonth: string;
  currency: string;
  /** `false` when the family has never set a budget for this month — not a budget of zero. */
  exists: boolean;
  /** `null` when no overall cap was set. `null` is "not asked", never "no cap needed". */
  totalBudgetMinor: number | null;
  totalSpentMinor: number;
  totalRemainingMinor: number | null;
  overTotal: boolean;
  lines: BudgetLineStatus[];
  uncategorized: UncategorizedSpend[];
}

export interface BudgetInput {
  periodMonth: string;
  totalAmountMinor?: number;
  lines: { category: string; amountMinor: number }[];
}

/** The current month as `YYYY-MM` (UTC), matching how the API defaults and stores it. */
export function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** `2026-08` → `August 2026`, for a heading a family reads rather than parses. */
export function monthLabel(periodMonth: string): string {
  const [y, m] = periodMonth.split('-');
  const year = Number(y);
  const monthIndex = Number(m) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) return periodMonth;
  const name = new Date(Date.UTC(year, monthIndex, 1)).toLocaleString('en-IN', {
    month: 'long',
    timeZone: 'UTC',
  });
  return `${name} ${year}`;
}

export const rupeesToMinor = (v: string) => Math.round((parseFloat(v) || 0) * 100);
export const minorToRupees = (m: number) => String(m / 100);

export async function loadBudget(
  token: string,
  householdId: string,
  month?: string,
): Promise<BudgetMonth> {
  const q = month ? `?month=${encodeURIComponent(month)}` : '';
  return apiGet<BudgetMonth>(`/households/${householdId}/budget${q}`, token);
}

/**
 * Save the month's envelopes. The API replaces the whole set, so the caller always sends the
 * complete list — a partial send would silently delete the envelopes it omitted.
 */
export async function saveBudget(
  token: string,
  householdId: string,
  input: BudgetInput,
): Promise<BudgetMonth> {
  return apiPost<BudgetMonth>(`/households/${householdId}/budget`, input, token);
}

/**
 * The categories offered when adding an envelope. Free text is still allowed — these exist so a
 * family is not made to invent a taxonomy, and `living` is first because it is the category the
 * Wealth Health Check already writes their spending to.
 */
export const SUGGESTED_CATEGORIES = [
  'living',
  'rent',
  'groceries',
  'utilities',
  'transport',
  'education',
  'healthcare',
  'entertainment',
  'travel',
  'other',
];
