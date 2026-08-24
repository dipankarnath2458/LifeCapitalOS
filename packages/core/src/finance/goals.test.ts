import { describe, expect, it } from 'vitest';
import { goalSlippage, monthsUntil, planGoal, planGoalAsOf } from './goals.js';

/**
 * Goal slippage (M5.11) — one definition of "how far behind is this goal".
 *
 * See `docs/M5_11_GOALS_SIGNAL_ARCHITECTURE.md`.
 *
 * Before this milestone the number existed in two places in the API and in neither place in
 * this package: the retail goal list and the retail early-warning input each carried a private
 * copy of the month arithmetic, and the slippage fraction was computed inline. A household copy
 * was about to become the third. These tests pin the extracted definition AND prove it is
 * arithmetically the same one V1 has been feeding the warning engine, so the two generations
 * cannot report a family as differently off-track.
 */
describe('goal slippage (M5.11)', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const base = {
    targetAmountMinor: 50_00_000_00,
    currentAmountMinor: 5_00_000_00,
    expectedAnnualReturnPct: 10,
    currency: 'INR' as const,
  };

  describe('monthsUntil', () => {
    it('measures the horizon in whole months', () => {
      expect(monthsUntil(now, new Date('2027-01-01T00:00:00.000Z'))).toBe(12);
      expect(monthsUntil(now, new Date('2031-01-01T00:00:00.000Z'))).toBe(60);
    });

    it('floors at one month, so an overdue goal is out of time rather than undefined', () => {
      // Not zero: zero months would divide by zero in the SIP. One month says "the whole
      // remaining gap is due now", which is what passing the date means.
      expect(monthsUntil(now, now)).toBe(1);
      expect(monthsUntil(now, new Date('2020-01-01T00:00:00.000Z'))).toBe(1);
    });

    it('is the exact formula the two API call sites already used', () => {
      // Character-for-character the expression removed from `goals.module.ts` and
      // `financial-snapshot.service.ts`. If this drifts, V1's reported horizon moves.
      const inline = (from: Date, to: Date) =>
        Math.max(1, Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24 * 30.44)));
      for (const iso of ['2026-03-15', '2028-07-01', '2035-12-31', '2025-06-01', '2026-01-02']) {
        const to = new Date(`${iso}T00:00:00.000Z`);
        expect(monthsUntil(now, to)).toBe(inline(now, to));
      }
    });
  });

  describe('goalSlippage', () => {
    it('is the unfunded fraction of the target after growth', () => {
      const plan = planGoal({ ...base, monthsRemaining: 60 });
      // The inline expression this replaced, asserted against the extracted one.
      expect(goalSlippage(plan, base.targetAmountMinor)).toBe(
        plan.gap.minor / base.targetAmountMinor,
      );
    });

    it('is 1 for a goal with nothing saved, and 0 for one already funded', () => {
      const nothing = planGoal({ ...base, currentAmountMinor: 0, monthsRemaining: 12 });
      expect(goalSlippage(nothing, base.targetAmountMinor)).toBe(1);

      const funded = planGoal({
        ...base,
        currentAmountMinor: base.targetAmountMinor,
        monthsRemaining: 12,
      });
      expect(goalSlippage(funded, base.targetAmountMinor)).toBe(0);
    });

    it('a goal with no target cannot be behind — and never divides by zero', () => {
      const plan = planGoal({ ...base, targetAmountMinor: 0, monthsRemaining: 12 });
      expect(goalSlippage(plan, 0)).toBe(0);
      expect(Number.isFinite(goalSlippage(plan, 0))).toBe(true);
    });

    it('stays inside [0,1] so the warning bands cannot be overshot', () => {
      // The engine bands at 0.15 and 0.30 and takes the MAX across goals. A value above 1
      // would still only say "red", but it would surface in a detail string as "340% behind",
      // which is not a sentence to show a family.
      const overfunded = planGoal({
        ...base,
        currentAmountMinor: base.targetAmountMinor * 10,
        monthsRemaining: 120,
      });
      expect(goalSlippage(overfunded, base.targetAmountMinor)).toBe(0);
      expect(goalSlippage({ ...overfunded, gap: { ...overfunded.gap, minor: 1e12 } }, 100)).toBe(1);
    });
  });

  describe('planGoalAsOf', () => {
    it('is planGoal plus the horizon and the slippage, with no clock of its own', () => {
      const targetDate = new Date('2031-01-01T00:00:00.000Z');
      const asOf = planGoalAsOf({ ...base, targetDate }, now);
      const direct = planGoal({ ...base, monthsRemaining: 60 });

      expect(asOf.monthsRemaining).toBe(60);
      expect(asOf.plan).toEqual(direct);
      expect(asOf.slippage).toBe(goalSlippage(direct, base.targetAmountMinor));
    });

    it('moves with the date, not with wall-clock time', () => {
      const targetDate = new Date('2031-01-01T00:00:00.000Z');
      const early = planGoalAsOf({ ...base, targetDate }, new Date('2026-01-01T00:00:00.000Z'));
      const late = planGoalAsOf({ ...base, targetDate }, new Date('2030-01-01T00:00:00.000Z'));

      // Less time to grow the same savings means more of the target is unfunded.
      expect(late.slippage).toBeGreaterThan(early.slippage);
      expect(late.monthsRemaining).toBeLessThan(early.monthsRemaining);
    });

    it('is deterministic', () => {
      const g = { ...base, targetDate: new Date('2031-01-01T00:00:00.000Z') };
      expect(planGoalAsOf(g, now)).toEqual(planGoalAsOf(g, now));
    });

    it('carries the optional tax and step-up inputs through untouched', () => {
      const targetDate = new Date('2031-01-01T00:00:00.000Z');
      const plain = planGoalAsOf({ ...base, targetDate }, now);
      const taxed = planGoalAsOf({ ...base, targetDate, gainsTaxPct: 20 }, now);

      // A post-tax return grows today's savings less, so more of the target is unfunded.
      expect(taxed.slippage).toBeGreaterThan(plain.slippage);
      expect(taxed.plan.monthlySipRequired.minor).toBeGreaterThan(plain.plan.monthlySipRequired.minor);
    });
  });
});
