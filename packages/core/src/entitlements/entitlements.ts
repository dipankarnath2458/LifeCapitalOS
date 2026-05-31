/**
 * Entitlement engine — the single source of truth for what a user can access.
 * The API gates premium features through this; the same logic ships to web/mobile
 * so the UI can hide or badge locked features without a round-trip.
 */

export type PlanTier = 'free' | 'premium' | 'family_cfo';

export type FeatureKey =
  | 'wealth_health_check'
  | 'family_balance_sheet'
  | 'asset_allocation'
  | 'retirement_calculator'
  | 'goal_planning'
  | 'debt_payoff_basic'
  | 'ai_recommendations'
  | 'scenario_simulator'
  | 'advanced_analytics'
  | 'account_aggregation'
  | 'knowledge_vault'
  | 'advisor_consultation'
  | 'family_members_unlimited';

/** Features unlocked at each tier. Higher tiers inherit lower-tier features. */
const TIER_FEATURES: Record<PlanTier, FeatureKey[]> = {
  free: [
    'wealth_health_check',
    'family_balance_sheet',
    'asset_allocation',
    'retirement_calculator',
    'goal_planning',
    'debt_payoff_basic',
  ],
  premium: [
    'ai_recommendations',
    'scenario_simulator',
    'advanced_analytics',
    'account_aggregation',
    'knowledge_vault',
  ],
  family_cfo: ['advisor_consultation', 'family_members_unlimited'],
};

const TIER_ORDER: PlanTier[] = ['free', 'premium', 'family_cfo'];

export interface Entitlements {
  tier: PlanTier;
  features: Set<FeatureKey>;
  /** Admin/feature-flag overrides applied on top of the tier (grant or revoke). */
  overrides?: Partial<Record<FeatureKey, boolean>>;
}

export function resolveEntitlements(
  tier: PlanTier,
  overrides?: Partial<Record<FeatureKey, boolean>>,
): Entitlements {
  const features = new Set<FeatureKey>();
  for (const t of TIER_ORDER) {
    for (const f of TIER_FEATURES[t]) features.add(f);
    if (t === tier) break;
  }
  if (overrides) {
    for (const [key, enabled] of Object.entries(overrides)) {
      if (enabled) features.add(key as FeatureKey);
      else features.delete(key as FeatureKey);
    }
  }
  return { tier, features, overrides };
}

export function can(entitlements: Entitlements, feature: FeatureKey): boolean {
  return entitlements.features.has(feature);
}

/** All known feature keys — handy for admin UIs building override toggles. */
export function allFeatureKeys(): FeatureKey[] {
  return Array.from(new Set(TIER_ORDER.flatMap((t) => TIER_FEATURES[t])));
}
