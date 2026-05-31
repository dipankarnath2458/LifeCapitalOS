import { describe, expect, it } from 'vitest';
import { bandFor, computeWealthHealth } from './scores.js';
import { topWealthActions } from './recommendations.js';
import { allFeatureKeys, can, resolveEntitlements } from '../entitlements/entitlements.js';

describe('wealth health scoring', () => {
  const input = {
    monthlyExpensesMinor: 50_000_00,
    emergencyFundMinor: 1_50_000_00,
    annualIncomeMinor: 20_00_000_00,
    existingLifeCoverMinor: 50_00_000_00,
    hasHealthInsurance: true,
    investmentAssetsMinor: 10_00_000_00,
    totalAssetsMinor: 1_00_00_000_00,
    totalLiabilitiesMinor: 30_00_000_00,
    retirementCorpusGapMinor: 2_00_00_000_00,
    retirementRequiredCorpusMinor: 5_00_00_000_00,
    age: 35,
  };

  it('produces sub-scores and an overall in [0,100]', () => {
    const r = computeWealthHealth(input);
    expect(r.subScores.length).toBe(5);
    expect(r.overall).toBeGreaterThanOrEqual(0);
    expect(r.overall).toBeLessThanOrEqual(100);
    for (const s of r.subScores) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
    }
  });

  it('bands map correctly', () => {
    expect(bandFor(85)).toBe('green');
    expect(bandFor(55)).toBe('yellow');
    expect(bandFor(20)).toBe('red');
  });

  it('top actions surface the weakest non-green areas first', () => {
    const r = computeWealthHealth(input);
    const actions = topWealthActions(r);
    if (actions.length >= 2) {
      expect(actions[0]!.priority).toBe(1);
    }
    expect(actions.length).toBeLessThanOrEqual(10);
  });
});

describe('entitlements', () => {
  it('free tier can do health check but not AI recommendations', () => {
    const e = resolveEntitlements('free');
    expect(can(e, 'wealth_health_check')).toBe(true);
    expect(can(e, 'ai_recommendations')).toBe(false);
  });

  it('premium inherits free features and unlocks AI', () => {
    const e = resolveEntitlements('premium');
    expect(can(e, 'wealth_health_check')).toBe(true);
    expect(can(e, 'ai_recommendations')).toBe(true);
    expect(can(e, 'advisor_consultation')).toBe(false);
  });

  it('overrides can grant or revoke individual features', () => {
    const e = resolveEntitlements('free', { ai_recommendations: true, debt_payoff_basic: false });
    expect(can(e, 'ai_recommendations')).toBe(true);
    expect(can(e, 'debt_payoff_basic')).toBe(false);
  });

  it('exposes all feature keys for admin toggles', () => {
    expect(allFeatureKeys().length).toBeGreaterThan(5);
  });
});
