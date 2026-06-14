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

/** The built-in (code-default) feature list for a tier — used as a fallback. */
export function defaultTierFeatures(tier: PlanTier): FeatureKey[] {
  return [...TIER_FEATURES[tier]];
}

/** Coerce an arbitrary JSON value (e.g. Plan.features) into known feature keys. */
export function parseFeatureKeys(value: unknown): FeatureKey[] {
  if (!Array.isArray(value)) return [];
  const known = new Set<string>(allFeatureKeys());
  return value.filter((v): v is FeatureKey => typeof v === 'string' && known.has(v));
}

/**
 * Data-driven entitlements: like resolveEntitlements, but the per-tier feature lists come
 * from the plans table instead of the built-in map, so editing a plan changes access.
 * Higher tiers still inherit lower-tier features (cascade by tier order).
 */
export function resolveEntitlementsFromPlans(
  tier: PlanTier,
  planFeatures: Partial<Record<PlanTier, FeatureKey[]>>,
  overrides?: Partial<Record<FeatureKey, boolean>>,
): Entitlements {
  const features = new Set<FeatureKey>();
  for (const t of TIER_ORDER) {
    for (const f of planFeatures[t] ?? []) features.add(f);
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
