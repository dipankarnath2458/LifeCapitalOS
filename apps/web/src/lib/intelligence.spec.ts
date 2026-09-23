import { describe, expect, it } from 'vitest';
import { ASSET_CLASS_LABEL, assetClassLabel, MISSING_LABEL, missingItem } from './intelligence';

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

/**
 * What a family is still missing (M5.20).
 *
 * The defect these close: `meta.dataCompleteness.missing` carries the engine's own identifiers,
 * and the dashboard printed them verbatim — a panel headed "Make this more accurate" telling a
 * family they were missing `memberAges`, with nowhere to go. Two failures this codebase has
 * already fixed separately: an engine key as copy (M5.17), and an instruction with no path
 * (M5.18).
 *
 * These tests keep the fix presentation-only: it invents no gap, hides none, and every gap it
 * names it can also point at.
 */
describe('missingItem', () => {
  /** Every key `computeHouseholdFinancialIntelligence` can push, read from its source. */
  const ENGINE_KEYS = [
    'income',
    'expenses',
    'assets',
    'memberAges',
    'insurancePolicies',
    'retirementAssumptions',
  ];

  it('covers every key the engine can report, so none reaches a family raw', () => {
    // If the engine gains a seventh, this fails and the map learns about it — which is the point
    // of asserting the whole set rather than spot-checking three of them.
    expect(Object.keys(MISSING_LABEL).sort()).toEqual([...ENGINE_KEYS].sort());
  });

  it('never shows a family an engine identifier', () => {
    // The M5.17 lesson, in a second place. No camelCase, no underscores, nothing that reads
    // like a variable.
    for (const key of ENGINE_KEYS) {
      const { label } = missingItem(key);
      expect(label).not.toBe(key);
      expect(label).not.toMatch(/[a-z][A-Z]/); // camelCase
      expect(label).not.toMatch(/_/);
    }
  });

  it('points every gap at a page that actually records it', () => {
    // The M5.18 lesson: an invitation with nowhere to go is worse than no invitation. Each
    // destination was checked against the page that captures that fact.
    expect(missingItem('income').href).toBe('/wealth-health');
    expect(missingItem('expenses').href).toBe('/wealth-health');
    expect(missingItem('assets').href).toBe('/wealth-health');
    expect(missingItem('memberAges').href).toBe('/household/family');
    expect(missingItem('insurancePolicies').href).toBe('/household/protection');
    expect(missingItem('retirementAssumptions').href).toBe('/household/retirement');

    // And each names the action, so the link is not a bare "click here".
    for (const key of ENGINE_KEYS) {
      expect(missingItem(key).cta).toBeTruthy();
    }
  });

  it('degrades readably for a key it has never seen, without inventing a destination', () => {
    // A gap added to the engine tomorrow must still reach the family. Sending them to a page
    // that does not record it would be worse than sending them nowhere.
    const unknown = missingItem('taxRegime');
    expect(unknown.label).toBe('tax regime');
    expect(unknown.href).toBeUndefined();
    expect(unknown.cta).toBeUndefined();
  });

  it('introduces no gap of its own', () => {
    // Presentation only. The engine decides what is missing; this decides how to say it. A key
    // here that the engine never emits would be a gap invented by the web layer.
    for (const key of Object.keys(MISSING_LABEL)) {
      expect(ENGINE_KEYS).toContain(key);
    }
  });
});
