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
  hasTermCover: boolean;
  hasHealthInsurance: boolean;
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
  const protectionNeeded = input.dependents > 0 || input.annualIncomeMinor > 0;
  let insStatus: ScoreBand = 'green';
  if (protectionNeeded) {
    if (!input.hasTermCover && !input.hasHealthInsurance) insStatus = 'red';
    else if (!input.hasTermCover || !input.hasHealthInsurance) insStatus = 'yellow';
  }
  signals.push({
    key: 'insurance',
    label: 'Insurance Gap',
    status: insStatus,
    detail: [
      input.hasTermCover ? 'term cover ✓' : 'no term cover',
      input.hasHealthInsurance ? 'health cover ✓' : 'no health cover',
    ].join(', '),
  });

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
