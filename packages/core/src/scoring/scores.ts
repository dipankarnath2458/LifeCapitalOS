/**
 * Wealth Health scoring engine. Produces the family of scores from the blueprint:
 * Emergency Fund, Protection, Investments, Retirement, Liquidity, Debt — and a
 * weighted overall Life Capital Score. Every sub-score is clamped to [0, 100].
 */

export type ScoreBand = 'green' | 'yellow' | 'red';

export interface ScoreInput {
  monthlyExpensesMinor: number;
  emergencyFundMinor: number;
  annualIncomeMinor: number;
  existingLifeCoverMinor: number;
  hasHealthInsurance: boolean;
  investmentAssetsMinor: number;
  totalAssetsMinor: number;
  totalLiabilitiesMinor: number;
  retirementCorpusGapMinor: number; // 0 == on track
  retirementRequiredCorpusMinor: number;
  age: number;
}

export interface SubScore {
  key: string;
  label: string;
  score: number;
  band: ScoreBand;
}

export interface WealthHealthReport {
  subScores: SubScore[];
  overall: number;
  band: ScoreBand;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function bandFor(score: number): ScoreBand {
  if (score >= 70) return 'green';
  if (score >= 40) return 'yellow';
  return 'red';
}

function sub(key: string, label: string, raw: number): SubScore {
  const score = clamp(raw);
  return { key, label, score, band: bandFor(score) };
}

export function computeWealthHealth(input: ScoreInput): WealthHealthReport {
  // Emergency fund: 6 months of expenses == 100.
  const monthsCovered =
    input.monthlyExpensesMinor > 0 ? input.emergencyFundMinor / input.monthlyExpensesMinor : 0;
  const emergency = sub('emergency_fund', 'Emergency Fund', (monthsCovered / 6) * 100);

  // Protection: life cover of 10x income == 100, plus health-insurance bonus.
  const coverRatio =
    input.annualIncomeMinor > 0
      ? input.existingLifeCoverMinor / (input.annualIncomeMinor * 10)
      : 0;
  const protection = sub(
    'protection',
    'Protection',
    coverRatio * 80 + (input.hasHealthInsurance ? 20 : 0),
  );

  // Investments: investable assets as a multiple of annual income (target 3x by mid-career).
  const investRatio =
    input.annualIncomeMinor > 0 ? input.investmentAssetsMinor / (input.annualIncomeMinor * 3) : 0;
  const investments = sub('investments', 'Investments', investRatio * 100);

  // Retirement: how much of the required corpus is already secured.
  const secured =
    input.retirementRequiredCorpusMinor > 0
      ? 1 - input.retirementCorpusGapMinor / input.retirementRequiredCorpusMinor
      : 1;
  const retirement = sub('retirement', 'Retirement', secured * 100);

  // Liquidity / debt: lower debt-to-asset ratio is better.
  const dti =
    input.totalAssetsMinor > 0 ? input.totalLiabilitiesMinor / input.totalAssetsMinor : 0;
  const debt = sub('debt', 'Debt Burden', (1 - Math.min(1, dti)) * 100);

  const subScores = [emergency, protection, investments, retirement, debt];

  // Weighted overall (Life Capital Score).
  const weights: Record<string, number> = {
    emergency_fund: 0.2,
    protection: 0.2,
    investments: 0.2,
    retirement: 0.25,
    debt: 0.15,
  };
  const overall = clamp(
    subScores.reduce((sum, s) => sum + s.score * (weights[s.key] ?? 0), 0),
  );

  return { subScores, overall, band: bandFor(overall) };
}
