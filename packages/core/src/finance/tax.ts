/**
 * India tax helpers — capital-gains, post-tax returns, and Section 80C / 80CCD(1B)
 * headroom. These are *educational approximations* for planning, not tax advice or a
 * filing engine: they encode the headline rules so SIP and retirement projections are
 * post-tax rather than gross. Rates reflect the regime from FY2024-25 (the July-2024
 * capital-gains changes). All amounts are in integer minor units.
 */

import type { AssetClass } from './assetAllocation.js';

/** Long-term capital-gains rate (%) by asset class, post-July-2024. */
const LTCG_RATE_PCT: Partial<Record<AssetClass, number>> = {
  equity: 12.5, // listed equity / equity MF, gains over the annual exemption
  gold: 12.5,
  real_estate: 12.5,
  crypto: 30,
};

/** Short-term capital-gains rate (%) by asset class. `null` == taxed at slab. */
const STCG_RATE_PCT: Partial<Record<AssetClass, number | null>> = {
  equity: 20, // listed equity STCG, post-July-2024
  crypto: 30,
};

/** Holding period (months) to qualify as long-term, by asset class. */
const LONG_TERM_MONTHS: Partial<Record<AssetClass, number>> = {
  equity: 12,
  gold: 24,
  real_estate: 24,
};

/** Annual LTCG exemption for listed equity (₹1,25,000), in minor units. */
export const EQUITY_LTCG_EXEMPTION_MINOR = 1_25_000_00;

/** Section 80C deduction ceiling (₹1,50,000) and 80CCD(1B) NPS top-up (₹50,000). */
export const SECTION_80C_LIMIT_MINOR = 1_50_000_00;
export const SECTION_80CCD1B_LIMIT_MINOR = 50_000_00;

/** Instruments that qualify for the ₹1.5L Section 80C deduction. */
export type Section80CInstrument = 'elss' | 'epf' | 'ppf' | 'life_insurance' | 'nps' | 'other_80c';

const SECTION_80C_INSTRUMENTS: ReadonlySet<Section80CInstrument> = new Set([
  'elss',
  'epf',
  'ppf',
  'life_insurance',
  'nps',
  'other_80c',
]);

export function isSection80CEligible(instrument: string): instrument is Section80CInstrument {
  return SECTION_80C_INSTRUMENTS.has(instrument as Section80CInstrument);
}

/**
 * Capital-gains tax (minor units) on a realised gain. `slabRatePct` is the investor's
 * marginal income-tax rate, used where the asset is taxed at slab (e.g. debt funds, or
 * short-term gains with no special rate). Returns 0 for non-positive gains.
 */
export function capitalGainsTaxMinor(
  gainMinor: number,
  assetClass: AssetClass,
  holdingMonths: number,
  slabRatePct: number,
): number {
  if (gainMinor <= 0) return 0;
  const longTermThreshold = LONG_TERM_MONTHS[assetClass];
  const isLongTerm = longTermThreshold !== undefined && holdingMonths >= longTermThreshold;

  if (isLongTerm) {
    const rate = LTCG_RATE_PCT[assetClass];
    if (rate === undefined) return (gainMinor * slabRatePct) / 100; // e.g. debt: slab
    // Listed equity enjoys an annual exemption before the LTCG rate applies.
    const taxable = assetClass === 'equity' ? Math.max(0, gainMinor - EQUITY_LTCG_EXEMPTION_MINOR) : gainMinor;
    return (taxable * rate) / 100;
  }

  const stRate = STCG_RATE_PCT[assetClass];
  if (stRate === null || stRate === undefined) return (gainMinor * slabRatePct) / 100;
  return (gainMinor * stRate) / 100;
}

/**
 * Approximate the effective annual rate of return *after* tax on the gain portion.
 * A growth investment returning `grossPct` keeps `grossPct * (1 - effectiveGainsTaxPct)`.
 * Used to make SIP / corpus projections post-tax. `effectiveGainsTaxPct` defaults to the
 * long-term equity rate, the most common growth assumption for Indian goal planning.
 */
export function netOfTaxReturnPct(grossPct: number, effectiveGainsTaxPct = LTCG_RATE_PCT.equity ?? 12.5): number {
  const keep = 1 - effectiveGainsTaxPct / 100;
  return grossPct * keep;
}

export interface Section80CStatus {
  /** Total 80C-eligible contributions counted toward the ₹1.5L ceiling (minor). */
  usedMinor: number;
  /** Remaining 80C headroom (minor), floored at 0. */
  headroomMinor: number;
  /** Remaining 80CCD(1B) NPS-specific headroom on top of 80C (minor). */
  npsHeadroomMinor: number;
}

/**
 * Section 80C headroom from a map of instrument → annual contribution (minor units).
 * NPS contributions first fill the dedicated ₹50,000 80CCD(1B) bucket, then spill into
 * the shared ₹1.5L 80C ceiling alongside ELSS/EPF/PPF/insurance.
 */
export function section80CStatus(contributionsMinor: Partial<Record<Section80CInstrument, number>>): Section80CStatus {
  const nps = Math.max(0, contributionsMinor.nps ?? 0);
  const npsInTopUp = Math.min(nps, SECTION_80CCD1B_LIMIT_MINOR);
  const npsSpillover = nps - npsInTopUp;

  let used80c = npsSpillover;
  for (const [instrument, amount] of Object.entries(contributionsMinor)) {
    if (instrument === 'nps') continue;
    if (isSection80CEligible(instrument)) used80c += Math.max(0, amount ?? 0);
  }
  used80c = Math.min(used80c, SECTION_80C_LIMIT_MINOR);

  return {
    usedMinor: used80c,
    headroomMinor: Math.max(0, SECTION_80C_LIMIT_MINOR - used80c),
    npsHeadroomMinor: Math.max(0, SECTION_80CCD1B_LIMIT_MINOR - npsInTopUp),
  };
}
