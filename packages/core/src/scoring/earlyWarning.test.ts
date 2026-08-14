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

  /**
   * Unknown protection is not absent protection.
   *
   * `no term cover, no health cover` is a factual claim, and `risk.topRisks` reaches the AI
   * Family CFO as settled fact it may not contradict. Because the V2 layer supplied no
   * protection data at all, every household with any income was being told it had none.
   *
   * `null` therefore means "not asked" and produces no signal, while `false` — a fact the
   * family gave us — still produces the red it always did.
   */
  describe('unknown cover (null) versus a stated absence (false)', () => {
    const keys = (r: ReturnType<typeof computeEarlyWarning>) => r.signals.map((s) => s.key);

    it('A. unknown cover makes no claim at all — no signal, no detail to quote', () => {
      const r = computeEarlyWarning({ ...healthy, hasTermCover: null, hasHealthInsurance: null });

      expect(keys(r)).not.toContain('insurance');
      // The detail string is the sentence that reached families. It must not exist anywhere.
      expect(r.signals.map((s) => s.detail).join(' ')).not.toMatch(/no term cover|no health cover/);
      // Counts are derived from the emitted signals, so they cannot disagree with the list.
      expect(r.redCount).toBe(r.signals.filter((s) => s.status === 'red').length);
      expect(r.yellowCount).toBe(r.signals.filter((s) => s.status === 'yellow').length);
      expect(r.signals.length).toBe(5);
    });

    it('A. one unknown answer is still unknown — a half-answered family is not assessed', () => {
      const r = computeEarlyWarning({ ...healthy, hasTermCover: true, hasHealthInsurance: null });
      expect(keys(r)).not.toContain('insurance');
    });

    it('B. an explicit "no cover" still raises the red it always did', () => {
      const r = computeEarlyWarning({ ...healthy, hasTermCover: false, hasHealthInsurance: false });
      const signal = r.signals.find((s) => s.key === 'insurance');

      expect(signal).toBeDefined();
      expect(signal!.status).toBe('red');
      // The claim is correct here: they told us.
      expect(signal!.detail).toBe('no term cover, no health cover');
    });

    it('B. one stated gap is a yellow, not a red', () => {
      const r = computeEarlyWarning({ ...healthy, hasTermCover: true, hasHealthInsurance: false });
      const signal = r.signals.find((s) => s.key === 'insurance');
      expect(signal!.status).toBe('yellow');
      expect(signal!.detail).toBe('term cover ✓, no health cover');
    });

    it('C. confirmed cover raises no gap', () => {
      const r = computeEarlyWarning({ ...healthy, hasTermCover: true, hasHealthInsurance: true });
      const signal = r.signals.find((s) => s.key === 'insurance');
      expect(signal!.status).toBe('green');
      expect(signal!.detail).not.toMatch(/no term cover|no health cover/);
    });

    it('D. the V1 path is untouched — booleans produce byte-identical reports', () => {
      // V1 reads real booleans from `Profile` (`common/financial-snapshot.service.ts`). This
      // pins its whole report, not just the insurance signal, so the widening to
      // `boolean | null` cannot have moved anything for the retail path.
      const v1Input = { ...healthy, hasTermCover: false, hasHealthInsurance: true };
      expect(computeEarlyWarning(v1Input)).toEqual({
        signals: [
          {
            key: 'concentration',
            label: 'Portfolio Concentration',
            status: 'green',
            detail: '40% of your portfolio sits in a single asset class.',
          },
          {
            key: 'liquidity',
            label: 'Liquidity Risk',
            status: 'green',
            detail: 'Liquid assets cover 8.0 months of expenses.',
          },
          {
            key: 'emergency_fund',
            label: 'Emergency Fund',
            status: 'green',
            detail: 'Your emergency fund covers 6.0 of a recommended 6 months.',
          },
          {
            key: 'debt',
            label: 'Debt Burden',
            status: 'green',
            detail: 'Debt is 10% of assets; EMIs are 10% of income.',
          },
          {
            key: 'insurance',
            label: 'Insurance Gap',
            status: 'yellow',
            detail: 'no term cover, health cover ✓',
          },
          {
            key: 'goal_slippage',
            label: 'Goal Progress',
            status: 'green',
            detail: 'Your most off-track goal is 5% behind its funding schedule.',
          },
        ],
        overall: 'yellow',
        redCount: 0,
        yellowCount: 1,
      });
    });
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
