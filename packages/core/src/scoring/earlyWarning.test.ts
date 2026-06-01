import { describe, expect, it } from 'vitest';
import { computeEarlyWarning } from './earlyWarning.js';
import { computeWealthDna, WEALTH_DNA_QUESTIONS } from '../assessment/wealthDna.js';

describe('early warning system', () => {
  const healthy = {
    allocationPct: { equity: 40, debt: 30, gold: 15, cash: 15 },
    monthlyExpensesMinor: 50_000_00,
    emergencyFundMinor: 3_00_000_00, // 6 months
    liquidAssetsMinor: 4_00_000_00,
    totalAssetsMinor: 1_00_00_000_00,
    totalLiabilitiesMinor: 10_00_000_00,
    annualIncomeMinor: 24_00_000_00,
    monthlyDebtPaymentMinor: 20_000_00,
    hasTermCover: true,
    hasHealthInsurance: true,
    dependents: 2,
    goalSlippage: [0.05],
  };

  it('flags a healthy family green overall', () => {
    const r = computeEarlyWarning(healthy);
    expect(r.signals.length).toBe(6);
    expect(r.overall).toBe('green');
    expect(r.redCount).toBe(0);
  });

  it('raises red flags for concentration, thin liquidity and no insurance', () => {
    const r = computeEarlyWarning({
      ...healthy,
      allocationPct: { real_estate: 85, cash: 15 },
      emergencyFundMinor: 0,
      liquidAssetsMinor: 50_000_00, // 1 month
      hasTermCover: false,
      hasHealthInsurance: false,
    });
    expect(r.overall).toBe('red');
    const byKey = Object.fromEntries(r.signals.map((s) => [s.key, s.status]));
    expect(byKey.concentration).toBe('red');
    expect(byKey.liquidity).toBe('red');
    expect(byKey.insurance).toBe('red');
  });
});

describe('wealth DNA', () => {
  it('returns the dominant archetype with traits and blind spots', () => {
    const answers = WEALTH_DNA_QUESTIONS.map(() => 'builder' as const);
    const r = computeWealthDna(answers);
    expect(r.archetype).toBe('builder');
    expect(r.title).toMatch(/Builder/);
    expect(r.traits.length).toBeGreaterThan(0);
    expect(r.blindSpots.length).toBeGreaterThan(0);
    expect(r.scores.builder).toBe(WEALTH_DNA_QUESTIONS.length);
  });

  it('is deterministic and picks the highest-scoring archetype', () => {
    const r = computeWealthDna(['protector', 'protector', 'protector', 'builder', 'explorer']);
    expect(r.archetype).toBe('protector');
  });
});
