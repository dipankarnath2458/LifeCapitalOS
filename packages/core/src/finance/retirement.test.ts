import { describe, expect, it } from 'vitest';
import {
  computeRetirement,
  projectRetirementScenarios,
  retirementStatus,
  type RetirementInput,
} from './retirement.js';

/**
 * Retirement planning (M5.10).
 *
 * See `docs/M5_10_RETIREMENT_PLANNING_ARCHITECTURE.md`.
 *
 * The pre-M5.10 engine answered *"what would I need to save?"* and never *"given what I am
 * saving, where do I land?"* — so "am I on track" could not be answered honestly. These tests
 * cover the additive contribution projection, and pin the existing behaviour so the extension
 * cannot have moved anything the V1 retail path or the dashboard already reported.
 */
describe('retirement planning (M5.10)', () => {
  /** A 35-year-old, ₹12L a year of expenses, ₹50L already invested. */
  const base: RetirementInput = {
    currentAge: 35,
    retirementAge: 60,
    yearsInRetirement: 25,
    currentAnnualExpensesMinor: 12_00_000_00,
    currentCorpusMinor: 50_00_000_00,
    inflationRatePct: 6,
    preRetirementReturnPct: 11,
    postRetirementReturnPct: 7,
    currency: 'INR',
  };

  describe('the contribution projection', () => {
    it('omitting a contribution reproduces the pre-M5.10 result exactly', () => {
      // The regression pin. V1's retail path and the existing dashboard panel both call this
      // without a contribution; nothing they read may move.
      const r = computeRetirement(base);

      expect(r.projectedCorpusFromContributions.minor).toBe(0);
      expect(r.projectedCorpusAtRetirement.minor).toBe(r.projectedCorpusFromCurrent.minor);
      // The figures that existed before M5.10, asserted as a group so any drift shows up here.
      expect({
        required: r.requiredCorpus.minor,
        fromCurrent: r.projectedCorpusFromCurrent.minor,
        gap: r.corpusGap.minor,
        sip: r.monthlySipRequired.minor,
        onTrack: r.onTrack,
        // Captured from the pre-M5.10 implementation itself (`git show HEAD~:…`), not
        // hand-computed, and verified identical across 15 age/corpus combinations before being
        // frozen here.
      }).toEqual({
        required: 115_29_96_61_91,
        fromCurrent: 67_92_73_19_01,
        gap: 47_37_23_42_89,
        sip: 30_05_605,
        onTrack: false,
      });
    });

    it('contributing the required SIP closes the gap exactly — the inverse round trip', () => {
      // `futureValueOfSip` is written as the inverse of `sipForTarget`. If the two ever drift
      // apart, the product would tell a family to save an amount that does not reach the target
      // it was calculated from.
      const r = computeRetirement(base);
      const withSip = computeRetirement({
        ...base,
        monthlyContributionMinor: r.monthlySipRequired.minor,
      });

      // Within a few rupees on a ₹47 crore figure — `fromMinor` rounds at each step.
      expect(withSip.projectedCorpusFromContributions.minor).toBeCloseTo(r.corpusGap.minor, -3);
      expect(withSip.surplusOrShortfall.minor).toBeCloseTo(0, -3);
      expect(retirementStatus(withSip.surplusOrShortfall.minor, withSip.requiredCorpus.minor)).toBe(
        'on_track',
      );
    });

    it('a stated contribution of zero is arithmetically the same as none — and means more', () => {
      // Deliberate: the DISTINCTION between "not asked" and "saving nothing" is preserved by the
      // caller, never by this function inventing a difference. Both project the same corpus; only
      // one of them is a finding about the family.
      const none = computeRetirement(base);
      const stated = computeRetirement({ ...base, monthlyContributionMinor: 0 });
      expect(stated).toEqual(none);
    });

    it('surplus is signed — a well-funded family gets a positive number, not a floored zero', () => {
      const rich = computeRetirement({ ...base, currentCorpusMinor: 50_00_00_000_00 });
      expect(rich.surplusOrShortfall.minor).toBeGreaterThan(0);
      // `corpusGap` stays floored at 0 by its existing definition; the two must not be confused.
      expect(rich.corpusGap.minor).toBe(0);
      expect(rich.onTrack).toBe(true);
    });
  });

  describe('determinism and boundaries', () => {
    it('is deterministic — the same input yields an identical result', () => {
      const input = { ...base, monthlyContributionMinor: 50_000_00 };
      expect(computeRetirement(input)).toEqual(computeRetirement(input));
    });

    it('already at retirement age projects no growth and no contributions', () => {
      const r = computeRetirement({
        ...base,
        currentAge: 60,
        monthlyContributionMinor: 50_000_00,
      });
      expect(r.projectedCorpusFromContributions.minor).toBe(0);
      expect(r.projectedCorpusFromCurrent.minor).toBe(base.currentCorpusMinor);
    });

    it('a zero return still accumulates the contributions themselves', () => {
      const r = computeRetirement({
        ...base,
        preRetirementReturnPct: 0,
        monthlyContributionMinor: 10_000_00,
      });
      // 25 years x 12 months x ₹10,000, with no growth.
      expect(r.projectedCorpusFromContributions.minor).toBe(10_000_00 * 300);
    });

    it('a negative contribution cannot drain the projection', () => {
      const r = computeRetirement({ ...base, monthlyContributionMinor: -50_000_00 });
      expect(r.projectedCorpusFromContributions.minor).toBe(0);
    });
  });

  describe('status thresholds', () => {
    it('classifies surplus, a near miss, and a real shortfall', () => {
      expect(retirementStatus(1, 1_00_00_000)).toBe('on_track');
      expect(retirementStatus(0, 1_00_00_000)).toBe('on_track');
      expect(retirementStatus(-5_00_000, 1_00_00_000)).toBe('watch'); // 5% short
      expect(retirementStatus(-10_00_000, 1_00_00_000)).toBe('watch'); // exactly the 10% band
      expect(retirementStatus(-10_00_001, 1_00_00_000)).toBe('at_risk'); // one paisa past it
    });

    it('absorbs rounding noise without absorbing a real shortfall', () => {
      // The tolerance exists so a family contributing exactly the recommended SIP is not told
      // "watch" because of sub-rupee rounding. It must stay far too small to hide anything real.
      const required = 1_00_00_000;
      expect(retirementStatus(-1, required)).toBe('on_track'); // one paisa: noise
      expect(retirementStatus(-Math.round(required * 1e-7), required)).toBe('on_track');
      // A hundredth of one percent short is already a finding, not noise.
      expect(retirementStatus(-Math.round(required * 1e-4), required)).toBe('watch');
    });

    it('a shortfall with no required corpus is at risk, never a silent pass', () => {
      expect(retirementStatus(-1, 0)).toBe('at_risk');
    });
  });

  describe('what-if scenarios', () => {
    const input = { ...base, monthlyContributionMinor: 40_000_00 };

    it('retiring later improves the outcome; retiring earlier worsens it', () => {
      const [later, earlier] = projectRetirementScenarios(input, [
        { type: 'retire_later', params: { years: 5 } },
        { type: 'retire_earlier', params: { years: 5 } },
      ]);

      expect(later!.deltaSurplusMinor).toBeGreaterThan(0);
      expect(earlier!.deltaSurplusMinor).toBeLessThan(0);
    });

    it('shifting the retirement age holds LIFE EXPECTANCY constant, not the drawdown', () => {
      // Working five more years does not make you live five years longer. Moving the age alone
      // would inflate the target without shortening what it must fund, reporting "retire later"
      // as more expensive than it is. Asserted against the equivalent hand-built input, so a
      // transform that moves only the age fails here.
      const [later] = projectRetirementScenarios(input, [
        { type: 'retire_later', params: { years: 5 } },
      ]);
      expect(later!.result).toEqual(
        computeRetirement({ ...input, retirementAge: 65, yearsInRetirement: 20 }),
      );

      const [earlier] = projectRetirementScenarios(input, [
        { type: 'retire_earlier', params: { years: 5 } },
      ]);
      expect(earlier!.result).toEqual(
        computeRetirement({ ...input, retirementAge: 55, yearsInRetirement: 30 }),
      );
    });

    it('saving more always helps, and never changes what is required', () => {
      const required = computeRetirement(input).requiredCorpus.minor;
      const [more] = projectRetirementScenarios(input, [
        { type: 'increase_contribution', params: { amountMinor: 25_000_00 } },
      ]);
      expect(more!.deltaSurplusMinor).toBeGreaterThan(0);
      // Contributions change what you HAVE, never what you NEED. If this ever fails, the two
      // sides of the projection have been wired together wrongly.
      expect(more!.result.requiredCorpus.minor).toBe(required);
    });

    it('a lower income target lowers what is required', () => {
      const [cheaper] = projectRetirementScenarios(input, [
        { type: 'change_income_target', params: { amountMinor: 6_00_000_00 } },
      ]);
      expect(cheaper!.result.requiredCorpus.minor).toBeLessThan(
        computeRetirement(input).requiredCorpus.minor,
      );
      expect(cheaper!.deltaSurplusMinor).toBeGreaterThan(0);
    });

    it('scenarios are independent — each applies to the untouched base', () => {
      // Order-independence matters because the surface renders them as a list. If they
      // compounded, the third card would silently include the first two.
      const scenarios = [
        { type: 'retire_later' as const, params: { years: 5 } },
        { type: 'increase_contribution' as const, params: { amountMinor: 25_000_00 } },
      ];
      const forward = projectRetirementScenarios(input, scenarios);
      const reversed = projectRetirementScenarios(input, [...scenarios].reverse());

      expect(forward[0]!.deltaSurplusMinor).toBe(reversed[1]!.deltaSurplusMinor);
      expect(forward[1]!.deltaSurplusMinor).toBe(reversed[0]!.deltaSurplusMinor);
    });

    it('cannot retire before the age you already are', () => {
      const [absurd] = projectRetirementScenarios(input, [
        { type: 'retire_earlier', params: { years: 99 } },
      ]);
      expect(absurd!.result.projectedCorpusFromCurrent.minor).toBe(input.currentCorpusMinor);
    });
  });
});
