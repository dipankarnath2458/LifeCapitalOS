import { SubScore, WealthHealthReport } from './scores.js';

export interface WealthAction {
  priority: number;
  title: string;
  rationale: string;
  scoreKey: string;
}

const ACTION_TEMPLATES: Record<string, { title: string; rationale: string }> = {
  emergency_fund: {
    title: 'Build your emergency fund to 6 months of expenses',
    rationale: 'A thin safety net forces debt during shocks like job loss or medical events.',
  },
  protection: {
    title: 'Increase term life and health insurance cover',
    rationale: 'Your dependents are underprotected against loss of income or large medical bills.',
  },
  investments: {
    title: 'Increase systematic investments toward long-term goals',
    rationale: 'Investable assets are low relative to income; compounding rewards starting early.',
  },
  retirement: {
    title: 'Raise retirement contributions to close the corpus gap',
    rationale: 'Projected corpus falls short of the inflation-adjusted retirement requirement.',
  },
  debt: {
    title: 'Reduce high-interest debt to lower your debt burden',
    rationale: 'Liabilities are high relative to assets, increasing financial fragility.',
  },
};

/**
 * Generate the "Top Wealth Actions" list — the blueprint's flagship output —
 * by surfacing the weakest scores first. Returns at most `limit` actions.
 */
export function topWealthActions(report: WealthHealthReport, limit = 10): WealthAction[] {
  return [...report.subScores]
    .filter((s: SubScore) => s.band !== 'green')
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((s, i) => ({
      priority: i + 1,
      scoreKey: s.key,
      title: ACTION_TEMPLATES[s.key]?.title ?? `Improve ${s.label}`,
      rationale: ACTION_TEMPLATES[s.key]?.rationale ?? 'This area is below the healthy range.',
    }));
}
