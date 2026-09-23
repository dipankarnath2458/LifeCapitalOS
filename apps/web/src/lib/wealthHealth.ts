import { apiGet, apiPatch, apiPost } from './api';
import { ensureHousehold, resolveHousehold, type UnavailableReason } from './household';

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
 *
 * ## Idempotent by upsert, not by append
 *
 * The check used to `POST` unconditionally, so every run added a fresh set of records. A
 * family who revisited "Update my figures" doubled their assets and their income, and the
 * dashboard reported the inflated figures with full confidence. Leaving a field blank on a
 * later run skewed the ratio further, because a blank field wrote nothing while the others
 * kept accumulating — that is where a 96% savings rate came from.
 *
 * Each run now **updates the records the wizard owns** rather than adding to them. It owns
 * them by name — the names it writes itself — so no schema change and no new endpoint are
 * needed. See `docs/WEALTH_CHECK_IDEMPOTENCY_DESIGN.md`.
 */

/**
 * How a family says their retirement savings are invested (M5.18).
 *
 * ## Why this is asked rather than inferred
 *
 * M5.16 let a family record retirement savings; M5.17 then showed them an allocation calling that
 * money "Not yet classified" and asked them to *"tell us how it's invested"* — a promise with no
 * path until now. This is the path.
 *
 * `accountType` says what kind of account holds the money; `assetClass` says what economic asset
 * it is. No deterministic mapping exists between them — a PPF is debt, an NPS equity tier is
 * equity, an ELSS is equity — so the family answers and the product never guesses. Declining is a
 * first-class answer: the balance stays in the honest `unclassified` bucket.
 *
 * The three offered are what an Indian retirement account plausibly holds: EPF/PPF → debt,
 * NPS-E/ELSS → equity, anything else → other. The API accepts all eight asset classes; only this
 * prompt is curated, so the kernel loses nothing by it.
 *
 * ## Why `cash` is NOT offered, and must not be added
 *
 * Two derivations treat `assetClass === 'cash'` as "reachable in a crisis" and neither looks at
 * `accountType`: `cashMinorOf` in `@lcos/core`, which feeds `emergencyFund.cashMinor`,
 * `emergencyFundMinor` and `liquidAssetsMinor`; and the household snapshot composer's own
 * liquidity sum. A family who classed their EPF as cash would be told they hold months of
 * emergency buffer in money they cannot touch until 58 — told they are covered when they are
 * not, which is the exact harm `retirement-capture.e2e-spec.ts` case 4 exists to prevent.
 *
 * That proxy was safe while retirement accounts carried no class at all. This milestone is the
 * first that lets a family give one, so the one value that breaks it is withheld here rather
 * than the frozen derivation being changed under a consumer-surface milestone. A family whose
 * retirement money genuinely sits idle answers "Something else", which is honest and inert.
 * Teaching the liquidity derivations to exclude retirement accounts is the proper fix and is
 * recorded as the follow-up; until it lands, `cash` stays off this list. Case 10 pins it.
 */
export type RetirementAssetClass = 'equity' | 'debt' | 'other';

export interface WealthHealthInput {
  /** Cash and savings balances, in major units as typed. */
  cash: number;
  investments: number;
  /**
   * Money set aside for retirement — EPF, PPF, NPS (M5.16, Gap 6 consumer capture).
   *
   * Recorded separately from `investments` because the two are different *kinds of account*,
   * not different kinds of asset: this one is written as `type: 'retirement'`, which is the
   * value `assets[].accountType` has carried in the payload since M5.15 and which nothing
   * could previously produce from a consumer surface.
   *
   * Until M5.16 the Investments field's own hint read "Mutual funds, stocks, EPF, PPF", so
   * every family who followed it filed retirement money as ordinary investing. That hint is
   * corrected in the same change. Existing figures are **not** split or backfilled — we cannot
   * know how much of a stored Investments balance is retirement money, and guessing would
   * assert a fact nobody recorded.
   */
  retirement: number;
  /**
   * How that retirement money is invested, if the family has told us (M5.18).
   *
   * `undefined` means **they have not said**, and is not a value: the row is written with no
   * `assetClass`, and the composer buckets it as `unclassified`, which is true. It also means
   * "leave whatever is already recorded alone" — an answer once given is not erased by a later
   * run that skips the question. Silence is not a retraction.
   */
  retirementAssetClass?: RetirementAssetClass;
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
  type: 'bank' | 'investment' | 'retirement' | 'real_estate';
  /**
   * Set deliberately, never defaulted. Emergency Liquidity counts `cash`, and
   * Diversification scores the spread of classes — filing everything as `other` would
   * understate a family that is genuinely well diversified.
   *
   * **Optional since M5.16**, and omitted for retirement savings. Retirement is an
   * `accountType`, not an `assetClass`: PPF is debt, NPS-E is equity, and we have not asked
   * which. A null class is already a first-class state in the kernel — the composer buckets it
   * as `unclassified` (`household-financial-snapshot.service.ts:141`) — so omitting it asserts
   * nothing, where picking one would. It must be **absent** rather than `null`: the API
   * validates with `@IsEnum`, which rejects an explicit null.
   */
  assetClass?: 'cash' | 'equity' | 'real_estate' | RetirementAssetClass;
  /**
   * The class the family answered for THIS row on THIS run (M5.18) — the only one ever sent on
   * an update.
   *
   * Separate from `assetClass` above, which is the class a row is created with and has never
   * been re-asserted on an existing row. Keeping them apart means adding the retirement question
   * changes nothing about how the other three rows behave, and that an advisor's edit to a
   * wizard-owned row is not silently overwritten on the family's next run.
   */
  statedAssetClass?: RetirementAssetClass;
}

/**
 * The names the wizard writes, and therefore the rows it owns.
 *
 * These are the match keys for every update below. They are stable because this file is the
 * only thing that creates them, and using them means a family's other accounts — anything
 * added elsewhere — are never touched by the check.
 */
const OWNED = {
  cash: 'Cash & savings',
  investments: 'Investments',
  retirement: 'Retirement savings',
  property: 'Property',
  loan: 'Loan',
} as const;

const FLOW = {
  income: { type: 'income', category: 'salary' },
  expense: { type: 'expense', category: 'living' },
} as const;

interface HouseholdAccount {
  id: string;
  name: string;
  balanceMinor: number;
  /** `null` until the family says how it is invested (M5.18). */
  assetClass: string | null;
}
interface HouseholdDebt {
  id: string;
  name: string;
  status: string;
  outstandingMinor: number | null;
  minimumPaymentMinor: number;
  annualInterestRatePct: number;
}
interface HouseholdTransaction {
  id: string;
  type: string;
  category: string;
  status: string;
  amountMinor: number;
}

/** The month the snapshot composes cashflow for — the period this check reads and writes. */
const currentPeriod = () => new Date().toISOString().slice(0, 7);

/**
 * The rows the wizard owns, oldest first.
 *
 * Oldest first matters: it makes "the row this run will update" deterministic across calls,
 * so two submissions of the same figures touch the same record rather than alternating.
 */
const owned = <T extends { name: string }>(rows: T[], name: string) => rows.filter((r) => r.name === name);

async function fetchState(token: string, householdId: string) {
  const [accounts, debts, transactions] = await Promise.all([
    apiGet<HouseholdAccount[]>(`/households/${householdId}/accounts`, token),
    apiGet<HouseholdDebt[]>(`/households/${householdId}/debts`, token),
    apiGet<HouseholdTransaction[]>(
      `/households/${householdId}/cashflow?month=${currentPeriod()}`,
      token,
    ),
  ]);
  return { accounts, debts, transactions };
}

const liveFlow = (txs: HouseholdTransaction[], flow: { type: string; category: string }) =>
  txs.filter((t) => t.type === flow.type && t.category === flow.category && t.status !== 'void');

/** Minor units → major, for putting a stored figure back into the form. */
const toMajor = (minor: number) => Math.round(Number(minor)) / 100;

/**
 * The family's current figures, for prefilling the form.
 *
 * ## Why prefill is half the fix
 *
 * Appending was only one of the two mechanisms. The other was that "Update my figures"
 * opened a **blank** form, so someone correcting a single number typed that number and left
 * everything else empty — and the product read the empty fields as "nothing to add here"
 * while stacking the typed one on top of what was stored. With the figures on screen, a
 * blank field means "I have none": an answer the user chose, not an artefact of an empty
 * form.
 *
 * ## What it shows when a household already has duplicates
 *
 * It reports the row this run will update, not the sum of the duplicates. Summing would be
 * worse than it sounds: the user would submit the inflated total back, it would be written
 * into one row while the duplicate kept its own balance, and the household's figures would
 * grow again. Repairing already-accumulated households is a separate, explicit decision
 * (see the design note §5); this change stops the accumulation rather than unwinding it.
 *
 * ## Gap 7: why this returns a union
 *
 * The distinction matters more here than anywhere else in the app. `null` used to mean both
 * "nothing recorded yet" and "we could not find out", and the page rendered an empty form for
 * both. An empty form is correct for the first and **dangerous** for the second: the user sees
 * blanks where their real figures should be, presses "See my score", and the check writes those
 * blanks over a household that had figures all along.
 */
export type CurrentFiguresResult =
  | { kind: 'ready'; figures: WealthHealthInput }
  /** No household, or a household with nothing recorded — an empty form is the right answer. */
  | { kind: 'none' }
  /** We could not read what they already have. The form must NOT be offered as if it were empty. */
  | { kind: 'unavailable'; reason: UnavailableReason };

export async function loadCurrentFigures(token: string): Promise<CurrentFiguresResult> {
  const resolution = await resolveHousehold(token);
  if (resolution.kind === 'unavailable') {
    return { kind: 'unavailable', reason: resolution.reason };
  }
  if (resolution.kind === 'none') return { kind: 'none' };

  const { accounts, debts, transactions } = await fetchState(token, resolution.householdId);
  const balance = (name: string) => {
    const row = owned(accounts, name)[0];
    return row ? toMajor(row.balanceMinor) : 0;
  };
  /**
   * The class the family already gave for a row, if any (M5.18).
   *
   * `undefined` when the row does not exist, carries no class, or carries one outside the four
   * this prompt offers. In every one of those cases the honest answer is "they have not answered
   * this question", so the control opens unanswered rather than inventing a selection.
   */
  const statedClass = (name: string): RetirementAssetClass | undefined => {
    const c = owned(accounts, name)[0]?.assetClass;
    return c === 'equity' || c === 'debt' || c === 'other' ? c : undefined;
  };
  const loan = debts.filter((d) => d.name === OWNED.loan && d.status === 'active')[0];
  const flow = (f: { type: string; category: string }) => {
    const tx = liveFlow(transactions, f)[0];
    return tx ? toMajor(tx.amountMinor) : 0;
  };

  return {
    kind: 'ready',
    figures: {
      cash: balance(OWNED.cash),
      investments: balance(OWNED.investments),
      // Must be read back, or the form shows a blank where real money is and the next
      // submission writes that blank over it — the Gap 7 failure mode, and the reason this
      // line carries its own regression test.
      retirement: balance(OWNED.retirement),
      // M5.18 — prefilled for the same reason every figure is: an unanswered control sitting over
      // an answer they already gave would invite them to give it again, or to lose it.
      retirementAssetClass: statedClass(OWNED.retirement),
      property: balance(OWNED.property),
      loanOutstanding: loan ? toMajor(Number(loan.outstandingMinor ?? 0)) : 0,
      loanMonthlyPayment: loan ? toMajor(loan.minimumPaymentMinor) : 0,
      loanRatePct: loan ? loan.annualInterestRatePct : 0,
      monthlyIncome: flow(FLOW.income),
      monthlyExpenses: flow(FLOW.expense),
    },
  };
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
  const existing = await fetchState(token, householdId);

  const assets: AssetSpec[] = [
    { amount: input.cash, name: OWNED.cash, type: 'bank', assetClass: 'cash' },
    { amount: input.investments, name: OWNED.investments, type: 'investment', assetClass: 'equity' },
    { amount: input.property, name: OWNED.property, type: 'real_estate', assetClass: 'real_estate' },
    // Appended last, deliberately: the rows above keep the call order they have always had, and
    // the transaction anchor below still prefers the cash account, which this row can never
    // become: `RetirementAssetClass` excludes `cash`, for the liquidity reason set out on it.
    //
    // M5.18: the class is the family's answer, or absent when they have not given one. Absent is
    // not a value; it leaves the balance in the honest `unclassified` bucket.
    {
      amount: input.retirement,
      name: OWNED.retirement,
      type: 'retirement',
      ...(input.retirementAssetClass !== undefined
        ? { assetClass: input.retirementAssetClass, statedAssetClass: input.retirementAssetClass }
        : {}),
    },
  ];

  let anchorAccountId: string | null = null;
  for (const asset of assets) {
    const current = owned(existing.accounts, asset.name)[0];

    if (current) {
      // Update in place — including to zero. A cleared field means "I have none of this",
      // which is a figure, not an event: the record, its history and anything referencing
      // it all survive. Deleting would throw away transactions attached to the account and
      // silently assert something the user never said.
      await apiPatch(
        `/households/${householdId}/accounts/${current.id}`,
        {
          balanceMinor: toMinor(asset.amount),
          // M5.18. Sent only when the family gave an answer THIS run, and only for the row the
          // question is about. Omitting it leaves any existing class untouched: silence is not a
          // retraction, and `@IsEnum` could not clear one anyway. Same three-state discipline as
          // the figures above — and the other three rows PATCH exactly as they always have.
          ...(asset.statedAssetClass !== undefined
            ? { assetClass: asset.statedAssetClass }
            : {}),
        },
        token,
      );
      if (!anchorAccountId || asset.assetClass === 'cash') anchorAccountId = current.id;
      continue;
    }

    // Nothing to update, and nothing to record: an account is not created just to hold zero.
    if (asset.amount <= 0) continue;

    const created = await apiPost<{ id: string }>(
      `/households/${householdId}/accounts`,
      {
        name: asset.name,
        type: asset.type,
        // Omitted entirely when the spec carries none (M5.16). `@IsEnum` rejects an explicit
        // null, and a key that is present-but-undefined is a different thing from an absent one.
        ...(asset.assetClass !== undefined ? { assetClass: asset.assetClass } : {}),
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

  const loan = existing.debts.filter((d) => d.name === OWNED.loan && d.status === 'active')[0];
  if (loan) {
    // Zeroing rather than closing: "closed" is a real event with its own meaning in the debt
    // ledger, and a blank field is not evidence that a loan was settled.
    await apiPatch(
      `/households/${householdId}/debts/${loan.id}`,
      {
        outstandingMinor: toMinor(input.loanOutstanding),
        minimumPaymentMinor: toMinor(input.loanMonthlyPayment),
        annualInterestRatePct: input.loanRatePct || 0,
      },
      token,
    );
  } else if (input.loanOutstanding > 0) {
    // Zero debt writes no row at all: the score reads an absent debt as "No outstanding
    // debt", which is materially different from a debt of zero.
    await apiPost(
      `/households/${householdId}/debts`,
      {
        name: OWNED.loan,
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

  // Any account in the household will do as the anchor. Previously only accounts created by
  // THIS run could serve, so a run that changed nothing about assets wrote no cashflow at
  // all — the figures were accepted by the form and silently dropped.
  if (!anchorAccountId) {
    anchorAccountId =
      owned(existing.accounts, OWNED.cash)[0]?.id ?? existing.accounts[0]?.id ?? null;
  }

  // Cashflow comes from transactions, not from a profile field. Dated to *today* because
  // the snapshot composes cashflow for the current month — a transaction dated outside it
  // is invisible to the score, which is the same silent zero as collecting nothing.
  const occurredAt = new Date().toISOString();
  const flows = [
    { amount: input.monthlyIncome, ...FLOW.income },
    { amount: input.monthlyExpenses, ...FLOW.expense },
  ];
  for (const flow of flows) {
    const current = liveFlow(existing.transactions, flow)[0];

    if (current) {
      // A transaction's amount must be positive, so a cleared figure is recorded by voiding
      // the row: the kernel's own way of saying "this no longer counts" while keeping it.
      // Cashflow already excludes void rows, so nothing downstream needs to know.
      await apiPatch(
        `/households/${householdId}/cashflow/${current.id}`,
        flow.amount > 0 ? { amountMinor: toMinor(flow.amount) } : { status: 'void' },
        token,
      );
      continue;
    }

    if (flow.amount <= 0 || !anchorAccountId) continue;
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

  // Immutable and append-only: re-running the check adds to the history rather than
  // overwriting it.
  await apiPost(`/households/${householdId}/financial-snapshot`, {}, token);

  // Live preview, deliberately not persisted — see §4 of the architecture doc.
  return apiGet<HealthScoreResult>(`/households/${householdId}/health-score/current`, token);
}
