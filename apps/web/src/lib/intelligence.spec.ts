import { describe, expect, it } from 'vitest';
import { ASSET_CLASS_LABEL, assetClassLabel } from './intelligence';

/**
 * Asset-class display labels (M5.17).
 *
 * The defect these close: the engine's bucket keys were reaching the dashboard verbatim, so a
 * family who had just recorded their retirement savings read the word "Unclassified" back.
 *
 * The fix is deliberately narrow — it renames nothing in the engine and merges no bucket. These
 * tests exist to keep it that narrow: an unknown asset class must still read as unknown, because
 * it genuinely is one.
 */
describe('assetClassLabel', () => {
  it('renders the unclassified bucket as words a family can read', () => {
    expect(assetClassLabel('unclassified')).toBe('Not yet classified');
  });

  it('never presents an unknown asset class as retirement', () => {
    // The whole point of the milestone: `accountType` is not `assetClass`. Retirement money is
    // named beside the allocation, never inside it.
    expect(assetClassLabel('unclassified')).not.toMatch(/retirement/i);
    expect(Object.values(ASSET_CLASS_LABEL).join(' ')).not.toMatch(/retirement/i);
  });

  it('keeps "not classified" meaning UNKNOWN, so the honest state stays visible', () => {
    // A non-retirement account with no asset class is the same unknown, and must read the same.
    // If this ever diverges, the label has started carrying information it does not have.
    expect(assetClassLabel('unclassified')).toBe('Not yet classified');
  });

  it('labels the eight real asset classes with their established names', () => {
    expect(assetClassLabel('equity')).toBe('Equity');
    expect(assetClassLabel('debt')).toBe('Debt');
    expect(assetClassLabel('gold')).toBe('Gold');
    expect(assetClassLabel('real_estate')).toBe('Real Estate');
    expect(assetClassLabel('cash')).toBe('Cash');
    expect(assetClassLabel('crypto')).toBe('Crypto');
    expect(assetClassLabel('business')).toBe('Business');
    expect(assetClassLabel('other')).toBe('Other');
  });

  it('introduces no asset class of its own', () => {
    // The map is presentation for keys the engine already emits. A `retirement` entry here would
    // be the first step toward an asset class that must never exist.
    expect(ASSET_CLASS_LABEL.retirement).toBeUndefined();
    expect(Object.keys(ASSET_CLASS_LABEL).sort()).toEqual([
      'business',
      'cash',
      'crypto',
      'debt',
      'equity',
      'gold',
      'other',
      'real_estate',
      'unclassified',
    ]);
  });

  it('degrades readably for a key it has never seen', () => {
    // A class added to the engine tomorrow must not vanish from the screen.
    expect(assetClassLabel('managed_futures')).toBe('managed futures');
  });
});
