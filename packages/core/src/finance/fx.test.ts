import { describe, expect, it } from 'vitest';
import {
  convertMinor,
  convertMoney,
  DEFAULT_USD_PER_UNIT,
  StaticFxRateProvider,
  sumInBaseCurrency,
} from './fx.js';
import { fromMinor, money } from '../money/money.js';

const rates = new StaticFxRateProvider();

describe('fx rate provider', () => {
  it('returns 1 for same-currency conversion', () => {
    expect(rates.rate('INR', 'INR')).toBe(1);
    expect(rates.rate('USD', 'USD')).toBe(1);
  });

  it('derives cross rates via USD', () => {
    // 1 INR is worth DEFAULT_USD_PER_UNIT.INR USD.
    expect(rates.rate('INR', 'USD')).toBeCloseTo(DEFAULT_USD_PER_UNIT.INR, 10);
    // 1 USD is worth 1 / usdPerUnit.INR rupees.
    expect(rates.rate('USD', 'INR')).toBeCloseTo(1 / DEFAULT_USD_PER_UNIT.INR, 6);
  });

  it('throws for an unknown/unpriced currency pair', () => {
    const partial = new StaticFxRateProvider({ EUR: 0 });
    expect(() => partial.rate('EUR', 'USD')).toThrow(/No FX rate/);
  });

  it('honours constructor overrides', () => {
    const custom = new StaticFxRateProvider({ INR: 0.01 });
    expect(custom.rate('INR', 'USD')).toBeCloseTo(0.01, 10);
  });
});

describe('convertMoney', () => {
  it('is an exact identity for the same currency', () => {
    const m = money(1000, 'INR');
    expect(convertMoney(m, 'INR', rates)).toBe(m);
  });

  it('converts INR to USD at the table rate', () => {
    // ₹1,000.00 = 100000 minor INR → USD at 0.012 = 1200 minor = $12.00
    const usd = convertMoney(money(1000, 'INR'), 'USD', rates);
    expect(usd.currency).toBe('USD');
    expect(usd.minor).toBe(1200);
  });

  it('round-trips within minor-unit rounding tolerance', () => {
    const original = money(100, 'USD'); // $100.00 = 10000 minor
    const toInr = convertMoney(original, 'INR', rates);
    const back = convertMoney(toInr, 'USD', rates);
    expect(Math.abs(back.minor - original.minor)).toBeLessThanOrEqual(1);
  });

  it('handles a zero amount', () => {
    expect(convertMoney(fromMinor(0, 'EUR'), 'INR', rates).minor).toBe(0);
  });
});

describe('convertMinor', () => {
  it('rounds same-currency values without applying a rate', () => {
    expect(convertMinor(1234.6, 'INR', 'INR', rates)).toBe(1235);
  });

  it('matches convertMoney for cross-currency', () => {
    expect(convertMinor(100000, 'INR', 'USD', rates)).toBe(
      convertMoney(money(1000, 'INR'), 'USD', rates).minor,
    );
  });
});

describe('sumInBaseCurrency', () => {
  it('sums mixed currencies into the base currency', () => {
    // ₹1,000 (100000 INR minor) + $10 (1000 USD minor) → INR base.
    const total = sumInBaseCurrency([money(1000, 'INR'), money(10, 'USD')], 'INR', rates);
    const usdInInr = Math.round(1000 * rates.rate('USD', 'INR'));
    expect(total.currency).toBe('INR');
    expect(total.minor).toBe(100000 + usdInInr);
  });

  it('is a plain sum when all amounts share the base currency', () => {
    const total = sumInBaseCurrency([money(1000, 'INR'), money(500, 'INR')], 'INR', rates);
    expect(total.minor).toBe(150000);
  });

  it('returns zero in the base currency for an empty list', () => {
    const total = sumInBaseCurrency([], 'USD', rates);
    expect(total).toEqual(fromMinor(0, 'USD'));
  });
});
