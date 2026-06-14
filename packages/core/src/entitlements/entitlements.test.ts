import { describe, expect, it } from 'vitest';
import {
  defaultTierFeatures,
  parseFeatureKeys,
  resolveEntitlements,
  resolveEntitlementsFromPlans,
} from './entitlements.js';

describe('parseFeatureKeys', () => {
  it('keeps known keys and drops junk', () => {
    expect(parseFeatureKeys(['ai_recommendations', 'nonsense', 42, null])).toEqual(['ai_recommendations']);
    expect(parseFeatureKeys('not-an-array')).toEqual([]);
  });
});

describe('resolveEntitlementsFromPlans', () => {
  const planFeatures = {
    free: defaultTierFeatures('free'),
    premium: defaultTierFeatures('premium'),
    family_cfo: defaultTierFeatures('family_cfo'),
  };

  it('matches the built-in resolver when plan features equal the defaults', () => {
    for (const tier of ['free', 'premium', 'family_cfo'] as const) {
      const fromPlans = resolveEntitlementsFromPlans(tier, planFeatures);
      const builtin = resolveEntitlements(tier);
      expect([...fromPlans.features].sort()).toEqual([...builtin.features].sort());
    }
  });

  it('higher tiers inherit lower-tier plan features', () => {
    const ent = resolveEntitlementsFromPlans('family_cfo', planFeatures);
    expect(ent.features.has('wealth_health_check')).toBe(true); // from free
    expect(ent.features.has('ai_recommendations')).toBe(true); // from premium
    expect(ent.features.has('advisor_consultation')).toBe(true); // from family_cfo
  });

  it('editing a plan changes access — removing a feature revokes it for that tier and above', () => {
    const edited = { ...planFeatures, premium: ['scenario_simulator'] as const as any };
    const ent = resolveEntitlementsFromPlans('premium', edited);
    expect(ent.features.has('ai_recommendations')).toBe(false);
    expect(ent.features.has('scenario_simulator')).toBe(true);
  });

  it('per-user overrides still apply on top', () => {
    const ent = resolveEntitlementsFromPlans('free', planFeatures, { ai_recommendations: true });
    expect(ent.features.has('ai_recommendations')).toBe(true);
  });
});
