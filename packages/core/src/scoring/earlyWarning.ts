/**
 * Wealth Early Warning System — the blueprint's traffic-light engine.
 * Turns a family's financial snapshot into a small set of Green / Yellow / Red
 * signals so problems surface before they become crises. Pure and deterministic.
 */

import type { ScoreBand } from './scores.js';

export interface EarlyWarningInput {
  /** Allocation as percentages by asset class (need not sum to exactly 100). */
  allocationPct: Record<string, number>;
  monthlyExpensesMinor: number;
  emergencyFundMinor: number;
  liquidAssetsMinor: number; // cash + liquid investments
  totalAssetsMinor: number;
  totalLiabilitiesMinor: number;
  annualIncomeMinor: number;
  monthlyDebtPaymentMinor: number;
  /**
   * Protection cover. `null` means **not asked** — which is not the same as `false`.
   *
   * `false` is a fact the family gave us ("I have no term cover") and produces a signal.
   * `null` is the absence of a fact, and produces none. See the Insurance Gap signal below.
   */
  hasTermCover: boolean | null;
  hasHealthInsurance: boolean | null;
  dependents: number;
  /** Goals with how far behind their funding schedule they are, in [0,1]. */
  goalSlippage?: number[];
}

export interface WarningSignal {
  key: string;
  label: string;
  status: ScoreBand; // green | yellow | red
  detail: string;
}

export interface EarlyWarningReport {
  signals: WarningSignal[];
  /** Worst status across all signals — drives the headline traffic light. */
  overall: ScoreBand;
  redCount: number;
  yellowCount: number;
}

const worst = (a: ScoreBand, b: ScoreBand): ScoreBand => {
  const rank: Record<ScoreBand, number> = { green: 0, yellow: 1, red: 2 };
  return rank[a] >= rank[b] ? a : b;
};

export function computeEarlyWarning(input: EarlyWarningInput): EarlyWarningReport {
  const signals: WarningSignal[] = [];

  // 1. Portfolio concentration — any single asset class dominating.
  const top = Object.entries(input.allocationPct).sort((a, b) => b[1] - a[1])[0];
  const topPct = top ? Math.round(top[1]) : 0;
  signals.push({
    key: 'concentration',
    label: 'Portfolio Concentration',
    status: topPct >= 70 ? 'red' : topPct >= 50 ? 'yellow' : 'green',
    detail: top
      ? `${topPct}% of your portfolio sits in a single asset class${topPct >= 50 ? ` (${top[0]})` : ''}.`
      : 'Add investments to assess concentration.',
  });

  // 2. Liquidity — months of expenses covered by liquid assets.
  const months =
    input.monthlyExpensesMinor > 0 ? input.liquidAssetsMinor / input.monthlyExpensesMinor : 0;
  signals.push({
    key: 'liquidity',
    label: 'Liquidity Risk',
    status: months >= 6 ? 'green' : months >= 3 ? 'yellow' : 'red',
    detail: `Liquid assets cover ${months.toFixed(1)} months of expenses.`,
  });

  // 3. Emergency fund specifically.
  const efMonths =
    input.monthlyExpensesMinor > 0 ? input.emergencyFundMinor / input.monthlyExpensesMinor : 0;
  signals.push({
    key: 'emergency_fund',
    label: 'Emergency Fund',
    status: efMonths >= 6 ? 'green' : efMonths >= 3 ? 'yellow' : 'red',
    detail: `Your emergency fund covers ${efMonths.toFixed(1)} of a recommended 6 months.`,
  });

  // 4. Debt burden — debt-to-asset ratio + EMI-to-income.
  const dti = input.totalAssetsMinor > 0 ? input.totalLiabilitiesMinor / input.totalAssetsMinor : 0;
  const emiToIncome =
    input.annualIncomeMinor > 0
      ? (input.monthlyDebtPaymentMinor * 12) / input.annualIncomeMinor
      : 0;
  signals.push({
    key: 'debt',
    label: 'Debt Burden',
    status:
      dti >= 0.5 || emiToIncome >= 0.4 ? 'red' : dti >= 0.35 || emiToIncome >= 0.3 ? 'yellow' : 'green',
    detail: `Debt is ${Math.round(dti * 100)}% of assets; EMIs are ${Math.round(emiToIncome * 100)}% of income.`,
  });

  // 5. Insurance gap — term + health, weighted by dependents.
  //
  // Emitted ONLY when both answers are known. `no term cover, no health cover` is a factual
  // claim about a family, and `risk.topRisks` is on the AI coach's allow-list, so an unasked
  // household was being told as settled fact that it had no insurance. The V2 layer supplies
  // no protection data at all today, so that was every household with any income.
  //
  // The signal is omitted here rather than filtered downstream on purpose: `redCount`,
  // `yellowCount` and `overall` are derived below from the signals that exist, so they cannot
  // disagree with the list shown beside them. Filtering afterwards would leave a count of 3
  // next to two listed risks — the defect class of #55 and #59.
  //
  // Passing booleans (as the V1 retail path does, from `Profile`) behaves exactly as before.
  const hasTerm = input.hasTermCover;
  const hasHealth = input.hasHealthInsurance;
  if (hasTerm != null && hasHealth != null) {
    const protectionNeeded = input.dependents > 0 || input.annualIncomeMinor > 0;
    let insStatus: ScoreBand = 'green';
    if (protectionNeeded) {
      if (!hasTerm && !hasHealth) insStatus = 'red';
      else if (!hasTerm || !hasHealth) insStatus = 'yellow';
    }
    signals.push({
      key: 'insurance',
      label: 'Insurance Gap',
      status: insStatus,
      detail: [
        hasTerm ? 'term cover ✓' : 'no term cover',
        hasHealth ? 'health cover ✓' : 'no health cover',
      ].join(', '),
    });
  }

  // 6. Goal slippage — any goal materially behind schedule.
  const slips = input.goalSlippage ?? [];
  const maxSlip = slips.length ? Math.max(...slips) : 0;
  signals.push({
    key: 'goal_slippage',
    label: 'Goal Progress',
    status: maxSlip >= 0.3 ? 'red' : maxSlip >= 0.15 ? 'yellow' : 'green',
    detail: slips.length
      ? `Your most off-track goal is ${Math.round(maxSlip * 100)}% behind its funding schedule.`
      : 'Add goals to track progress.',
  });

  const overall = signals.reduce<ScoreBand>((acc, s) => worst(acc, s.status), 'green');
  return {
    signals,
    overall,
    redCount: signals.filter((s) => s.status === 'red').length,
    yellowCount: signals.filter((s) => s.status === 'yellow').length,
  };
}
