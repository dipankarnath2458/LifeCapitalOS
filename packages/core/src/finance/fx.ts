/**
 * Foreign-exchange boundary (risk R-FX).
 *
 * The balance-sheet calculators (`computeNetWorth`, `computeLiquidity`) assume every
 * amount is already expressed in the household's base currency — FX is handled *here*,
 * upstream, before aggregation. `money.ts` deliberately throws on mixed-currency
 * arithmetic, so this module is the single sanctioned way to combine amounts held in
 * different currencies.
 *
 * Rates are supplied by a `FxRateProvider` so the source (a static/config table now, a
 * live provider later) is swappable without touching call sites. All supported
 * currencies use 100 minor units per major unit, so conversion is applied directly to
 * minor units using the major-unit rate.
 */

import { CurrencyCode, fromMinor, Money } from '../money/money.js';

/** Supplies exchange rates. `rate(from, to)` = major units of `to` per 1 major unit of `from`. */
export interface FxRateProvider {
  /** Conversion factor from `from` to `to`. Must return 1 when `from === to`. */
  rate(from: CurrencyCode, to: CurrencyCode): number;
}

/**
 * Indicative value of 1 major unit of each currency expressed in USD. These are static
 * defaults for development and deterministic tests — **not** a live feed. Replace via the
 * `StaticFxRateProvider` constructor, or plug a live provider implementing `FxRateProvider`.
 */
export const DEFAULT_USD_PER_UNIT: Readonly<Record<CurrencyCode, number>> = {
  USD: 1,
  INR: 0.012,
  EUR: 1.08,
  GBP: 1.27,
  AED: 0.27,
  SGD: 0.74,
};

/**
 * A fixed-rate provider backed by a table of "USD per 1 unit" values. Cross rates are
 * derived via USD: rate(from, to) = usdPer[from] / usdPer[to].
 */
export class StaticFxRateProvider implements FxRateProvider {
  private readonly usdPerUnit: Record<CurrencyCode, number>;

  constructor(overrides?: Partial<Record<CurrencyCode, number>>) {
    this.usdPerUnit = { ...DEFAULT_USD_PER_UNIT, ...overrides };
  }

  rate(from: CurrencyCode, to: CurrencyCode): number {
    if (from === to) return 1;
    const fromUsd = this.usdPerUnit[from];
    const toUsd = this.usdPerUnit[to];
    if (!fromUsd || !toUsd) {
      throw new Error(`No FX rate available for ${from}->${to}`);
    }
    return fromUsd / toUsd;
  }
}

/**
 * Convert a `Money` amount into `to`, rounding to the nearest minor unit. Same-currency
 * conversion is an exact identity (no rounding). Conversions are not guaranteed to be
 * perfectly reversible because of minor-unit rounding.
 */
export function convertMoney(amount: Money, to: CurrencyCode, rates: FxRateProvider): Money {
  if (amount.currency === to) return amount;
  const converted = Math.round(amount.minor * rates.rate(amount.currency, to));
  return fromMinor(converted, to);
}

/** Convert a raw minor-unit amount between currencies, returning minor units of `to`. */
export function convertMinor(
  minor: number,
  from: CurrencyCode,
  to: CurrencyCode,
  rates: FxRateProvider,
): number {
  if (from === to) return Math.round(minor);
  return Math.round(minor * rates.rate(from, to));
}

/**
 * Sum a list of amounts held in possibly different currencies into a single `Money` in
 * `base`. This is the sanctioned multi-currency aggregation used before net-worth /
 * cashflow / debt roll-ups.
 */
export function sumInBaseCurrency(
  amounts: Money[],
  base: CurrencyCode,
  rates: FxRateProvider,
): Money {
  let totalMinor = 0;
  for (const a of amounts) {
    totalMinor += convertMinor(a.minor, a.currency, base, rates);
  }
  return fromMinor(totalMinor, base);
}
