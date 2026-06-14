import { describe, expect, it } from 'vitest';
import {
  capitalGainsTaxMinor,
  netOfTaxReturnPct,
  section80CStatus,
  EQUITY_LTCG_EXEMPTION_MINOR,
  SECTION_80C_LIMIT_MINOR,
} from './tax.js';
import { planGoal } from './goals.js';
import { computeRetirement } from './retirement.js';
import { computeLiquidity, isLiquidAssetClass } from './networth.js';

describe('tax', () => {
  it('exempts the first ₹1.25L of equity LTCG, then taxes at 12.5%', () => {
    const gain = EQUITY_LTCG_EXEMPTION_MINOR + 1_00_000_00; // ₹1L over the exemption
    const tax = capitalGainsTaxMinor(gain, 'equity', 18, 30);
    expect(tax).toBeCloseTo((1_00_000_00 * 12.5) / 100, 0);
  });

  it('taxes short-term equity at 20% and debt at slab', () => {
    expect(capitalGainsTaxMinor(1_00_000_00, 'equity', 6, 30)).toBeCloseTo((1_00_000_00 * 20) / 100, 0);
    // Debt has no special LTCG rate → slab applies regardless of holding.
    expect(capitalGainsTaxMinor(1_00_000_00, 'debt', 60, 30)).toBeCloseTo((1_00_000_00 * 30) / 100, 0);
  });

  it('returns zero tax on non-positive gains', () => {
    expect(capitalGainsTaxMinor(0, 'equity', 24, 30)).toBe(0);
    expect(capitalGainsTaxMinor(-500, 'gold', 36, 30)).toBe(0);
  });

  it('net-of-tax return is below gross', () => {
    expect(netOfTaxReturnPct(12, 12.5)).toBeCloseTo(12 * 0.875, 6);
    expect(netOfTaxReturnPct(12)).toBeLessThan(12);
  });

  it('computes Section 80C headroom with NPS filling the 80CCD(1B) bucket first', () => {
    const status = section80CStatus({ elss: 50_000_00, nps: 50_000_00 });
    // NPS fills its own ₹50k bucket; only ELSS counts toward the ₹1.5L 80C ceiling.
    expect(status.usedMinor).toBe(50_000_00);
    expect(status.npsHeadroomMinor).toBe(0);
    expect(status.headroomMinor).toBe(SECTION_80C_LIMIT_MINOR - 50_000_00);
  });
});

describe('tax-aware planning (additive, opt-in)', () => {
  it('requires a higher SIP once gains tax is applied', () => {
    const base = { targetAmountMinor: 1_00_00_000_00, currentAmountMinor: 0, monthsRemaining: 120, expectedAnnualReturnPct: 12, currency: 'INR' as const };
    const gross = planGoal(base);
    const postTax = planGoal({ ...base, gainsTaxPct: 20 });
    expect(postTax.monthlySipRequired.minor).toBeGreaterThan(gross.monthlySipRequired.minor);
  });

  it('stepped SIP starts lower than the level SIP for the same goal', () => {
    const base = { targetAmountMinor: 1_00_00_000_00, currentAmountMinor: 0, monthsRemaining: 120, expectedAnnualReturnPct: 12, currency: 'INR' as const };
    const level = planGoal(base);
    const stepped = planGoal({ ...base, annualStepUpPct: 10 });
    expect(stepped.monthlySipRequired.minor).toBeLessThan(level.monthlySipRequired.minor);
    expect(stepped.monthlySipRequired.minor).toBeGreaterThan(0);
  });

  it('retirement: post-tax growth widens the corpus gap and SIP', () => {
    const base = {
      currentAge: 35,
      retirementAge: 60,
      yearsInRetirement: 25,
      currentAnnualExpensesMinor: 12_00_000_00,
      currentCorpusMinor: 50_00_000_00,
      inflationRatePct: 6,
      preRetirementReturnPct: 12,
      postRetirementReturnPct: 7,
      currency: 'INR' as const,
    };
    const gross = computeRetirement(base);
    const postTax = computeRetirement({ ...base, effectiveGainsTaxPct: 15 });
    expect(postTax.monthlySipRequired.minor).toBeGreaterThan(gross.monthlySipRequired.minor);
  });
});

describe('liquidity bucketing', () => {
  it('excludes real estate and business from liquid assets', () => {
    expect(isLiquidAssetClass('cash')).toBe(true);
    expect(isLiquidAssetClass('equity')).toBe(true);
    expect(isLiquidAssetClass('real_estate')).toBe(false);
    expect(isLiquidAssetClass('business')).toBe(false);
  });

  it('computes liquid vs illiquid net worth', () => {
    const res = computeLiquidity(
      [
        { balanceMinor: 5_00_000_00, isLiability: false, assetClass: 'cash' },
        { balanceMinor: 95_00_000_00, isLiability: false, assetClass: 'real_estate' },
        { balanceMinor: 20_00_000_00, isLiability: true, assetClass: null },
      ],
      'INR',
    );
    expect(res.liquidAssets.minor).toBe(5_00_000_00);
    expect(res.illiquidAssets.minor).toBe(95_00_000_00);
    expect(res.liquidNetWorth.minor).toBe(5_00_000_00 - 20_00_000_00);
    expect(res.liquidRatio).toBeCloseTo(5 / 100, 4);
  });
});
