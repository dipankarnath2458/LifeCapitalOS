import { CurrencyCode, fromMinor, Money, toMajor } from '../money/money.js';
import type { AssetClass } from './assetAllocation.js';

export interface NetWorthAccount {
  balanceMinor: number;
  currency: CurrencyCode;
  isLiability: boolean;
}

export interface NetWorthResult {
  assets: Money;
  liabilities: Money;
  netWorth: Money;
  /** Net worth / assets, a simple solvency ratio in [0,1]. 0 when no assets. */
  solvencyRatio: number;
}

/**
 * Family Balance Sheet — aggregate net worth from a flat list of accounts.
 * All accounts are assumed pre-converted to `baseCurrency` (FX handled upstream).
 */
export function computeNetWorth(
  accounts: NetWorthAccount[],
  baseCurrency: CurrencyCode,
): NetWorthResult {
  let assetMinor = 0;
  let liabilityMinor = 0;
  for (const a of accounts) {
    if (a.isLiability) {
      liabilityMinor += Math.abs(a.balanceMinor);
    } else {
      assetMinor += a.balanceMinor;
    }
  }
  const netMinor = assetMinor - liabilityMinor;
  return {
    assets: fromMinor(assetMinor, baseCurrency),
    liabilities: fromMinor(liabilityMinor, baseCurrency),
    netWorth: fromMinor(netMinor, baseCurrency),
    solvencyRatio: assetMinor > 0 ? netMinor / assetMinor : 0,
  };
}

/** Financial Independence Ratio = passive-capable assets / annual expenses. */
export function financialIndependenceRatio(netWorth: Money, annualExpenses: Money): number {
  const expensesMajor = toMajor(annualExpenses);
  if (expensesMajor <= 0) return 0;
  return toMajor(netWorth) / expensesMajor;
}

/**
 * Asset classes treated as readily spendable. Real estate, business equity and physical
 * gold are deliberately excluded — they can't be liquidated in a crisis without loss/time,
 * so counting them as emergency-ready overstates resilience.
 */
const LIQUID_ASSET_CLASSES: ReadonlySet<AssetClass> = new Set(['cash', 'equity', 'debt']);

export function isLiquidAssetClass(assetClass: AssetClass | null | undefined): boolean {
  return assetClass != null && LIQUID_ASSET_CLASSES.has(assetClass);
}

export interface LiquidityAccount {
  balanceMinor: number;
  isLiability: boolean;
  assetClass?: AssetClass | null;
}

export interface LiquidityResult {
  liquidAssets: Money;
  illiquidAssets: Money;
  /** Liquid assets minus all liabilities. */
  liquidNetWorth: Money;
  /** Liquid assets / total assets, in [0,1]. 0 when no assets. */
  liquidRatio: number;
}

/**
 * Split the balance sheet into liquid vs illiquid so resilience metrics (FI ratio,
 * emergency-fund coverage) stop treating a house as spendable. FX assumed handled upstream.
 */
export function computeLiquidity(
  accounts: LiquidityAccount[],
  baseCurrency: CurrencyCode,
): LiquidityResult {
  let liquidMinor = 0;
  let illiquidMinor = 0;
  let liabilityMinor = 0;
  for (const a of accounts) {
    if (a.isLiability) {
      liabilityMinor += Math.abs(a.balanceMinor);
      continue;
    }
    if (isLiquidAssetClass(a.assetClass)) liquidMinor += a.balanceMinor;
    else illiquidMinor += a.balanceMinor;
  }
  const totalAssets = liquidMinor + illiquidMinor;
  return {
    liquidAssets: fromMinor(liquidMinor, baseCurrency),
    illiquidAssets: fromMinor(illiquidMinor, baseCurrency),
    liquidNetWorth: fromMinor(liquidMinor - liabilityMinor, baseCurrency),
    liquidRatio: totalAssets > 0 ? liquidMinor / totalAssets : 0,
  };
}
