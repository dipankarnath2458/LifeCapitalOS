import { apiGet, apiPost } from './api';
import { ensureHousehold } from './household';

/**
 * Wealth Health Check — the client side of the pipeline described in
 * `docs/M5_5_WEALTH_HEALTH_CHECK_ARCHITECTURE.md`.
 *
 * Everything here writes **household-scoped** records, because the Financial Snapshot —
 * which the score is computed from — reads `Account.householdId`, not `Account.userId`.
 * Writing to the retail path would score an empty snapshot while showing the user the
 * figures they just typed: a confidently wrong number, which is the failure mode this
 * whole module is shaped to avoid.
 *
 * No financial arithmetic happens in this file. The kernel composes the snapshot and
 * `@lcos/core` computes the score; the browser only collects and displays.
 */

export interface WealthHealthInput {
  /** Cash and savings balances, in major units as typed. */
  cash: number;
  investments: number;
  property: number;
  /** Outstanding loan balance; 0 means "no debt", and no Debt row is written. */
  loanOutstanding: number;
  loanMonthlyPayment: number;
  loanRatePct: number;
  monthlyIncome: number;
  monthlyExpenses: number;
}

export interface CategoryScore {
  key: string;
  label: string;
  weight: number;
  score: number;
  band: string;
  reason: string;
  suggestion: string;
}

export interface HealthScoreResult {
  available: boolean;
  overall: number;
  band: string;
  currency: string;
  snapshotId: string;
  categories: CategoryScore[];
}

/** Rupees (as typed) → minor units. The only unit conversion the client performs. */
export function toMinor(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100);
}

interface AssetSpec {
  amount: number;
  name: string;
  type: 'bank' | 'investment' | 'real_estate';
  /**
   * Set deliberately, never defaulted. Emergency Liquidity counts `cash`, and
   * Diversification scores the spread of classes — filing everything as `other` would
   * understate a family that is genuinely well diversified.
   */
  assetClass: 'cash' | 'equity' | 'real_estate';
}

/**
 * Runs the whole check and returns the score.
 *
 * Ordered deliberately: accounts must exist before transactions can reference one, and
 * every record must exist before the snapshot is composed from them.
 */
export async function runWealthHealthCheck(
  token: string,
  input: WealthHealthInput,
): Promise<HealthScoreResult> {
  // Idempotent. Covers users who registered before onboarding provisioned households, and
  // anyone who skipped onboarding — no backfill or migration needed.
  const { householdId } = await ensureHousehold(token);

  const assets: AssetSpec[] = [
    { amount: input.cash, name: 'Cash & savings', type: 'bank', assetClass: 'cash' },
    { amount: input.investments, name: 'Investments', type: 'investment', assetClass: 'equity' },
    { amount: input.property, name: 'Property', type: 'real_estate', assetClass: 'real_estate' },
  ];

  let anchorAccountId: string | null = null;
  for (const asset of assets) {
    if (asset.amount <= 0) continue;
    const created = await apiPost<{ id: string }>(
      `/households/${householdId}/accounts`,
      {
        name: asset.name,
        type: asset.type,
        assetClass: asset.assetClass,
        currency: 'INR',
        balanceMinor: toMinor(asset.amount),
        isLiability: false,
      },
      token,
    );
    // Transactions must reference an account in the household. The cash account is the
    // natural home for salary and living costs, so prefer it when there is one.
    if (!anchorAccountId || asset.assetClass === 'cash') anchorAccountId = created.id;
  }

  // Zero debt writes no row at all: the score reads an absent debt as "No outstanding
  // debt", which is materially different from a debt of zero.
  if (input.loanOutstanding > 0) {
    await apiPost(
      `/households/${householdId}/debts`,
      {
        name: 'Loan',
        type: 'other',
        currency: 'INR',
        principalMinor: toMinor(input.loanOutstanding),
        outstandingMinor: toMinor(input.loanOutstanding),
        annualInterestRatePct: input.loanRatePct || 0,
        minimumPaymentMinor: toMinor(input.loanMonthlyPayment),
      },
      token,
    );
  }

  // Cashflow comes from transactions, not from a profile field. Dated to *today* because
  // the snapshot composes cashflow for the current month — a transaction dated outside it
  // is invisible to the score, which is the same silent zero as collecting nothing.
  if (anchorAccountId) {
    const occurredAt = new Date().toISOString();
    const flows: Array<{ amount: number; type: 'income' | 'expense'; category: string }> = [
      { amount: input.monthlyIncome, type: 'income', category: 'salary' },
      { amount: input.monthlyExpenses, type: 'expense', category: 'living' },
    ];
    for (const flow of flows) {
      if (flow.amount <= 0) continue;
      await apiPost(
        `/households/${householdId}/cashflow`,
        {
          accountId: anchorAccountId,
          type: flow.type,
          category: flow.category,
          amountMinor: toMinor(flow.amount),
          currency: 'INR',
          occurredAt,
        },
        token,
      );
    }
  }

  // Immutable and append-only: re-running the check adds to the history rather than
  // overwriting it.
  await apiPost(`/households/${householdId}/financial-snapshot`, {}, token);

  // Live preview, deliberately not persisted — see §4 of the architecture doc.
  return apiGet<HealthScoreResult>(`/households/${householdId}/health-score/current`, token);
}
