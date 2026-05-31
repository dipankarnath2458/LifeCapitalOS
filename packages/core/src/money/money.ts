/**
 * Money utilities. We store monetary amounts as integer minor units (paise for INR,
 * cents for USD) to avoid floating-point drift, and only convert to major units at
 * the presentation boundary.
 */

export type CurrencyCode = 'INR' | 'USD' | 'EUR' | 'GBP' | 'AED' | 'SGD';

export interface Money {
  /** Amount in minor units (e.g. paise). Always an integer. */
  readonly minor: number;
  readonly currency: CurrencyCode;
}

const MINOR_UNITS_PER_MAJOR = 100;

export function money(major: number, currency: CurrencyCode): Money {
  return { minor: Math.round(major * MINOR_UNITS_PER_MAJOR), currency };
}

export function fromMinor(minor: number, currency: CurrencyCode): Money {
  return { minor: Math.round(minor), currency };
}

export function toMajor(m: Money): number {
  return m.minor / MINOR_UNITS_PER_MAJOR;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { minor: a.minor + b.minor, currency: a.currency };
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { minor: a.minor - b.minor, currency: a.currency };
}

export function sumMoney(items: Money[], currency: CurrencyCode): Money {
  return items.reduce((acc, m) => addMoney(acc, m), fromMinor(0, currency));
}

export function scaleMoney(m: Money, factor: number): Money {
  return { minor: Math.round(m.minor * factor), currency: m.currency };
}

const LOCALE_BY_CURRENCY: Record<CurrencyCode, string> = {
  INR: 'en-IN',
  USD: 'en-US',
  EUR: 'en-IE',
  GBP: 'en-GB',
  AED: 'en-AE',
  SGD: 'en-SG',
};

export function formatMoney(m: Money): string {
  return new Intl.NumberFormat(LOCALE_BY_CURRENCY[m.currency], {
    style: 'currency',
    currency: m.currency,
    maximumFractionDigits: 0,
  }).format(toMajor(m));
}
