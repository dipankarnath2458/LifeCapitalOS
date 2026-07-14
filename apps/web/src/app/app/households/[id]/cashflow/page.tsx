'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiGet, apiPost } from '@/lib/api';
import { useApp } from '@/lib/appContext';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  StatCard,
  DataTable,
  Badge,
  Button,
  Select,
  Input,
  Field,
  Heading,
  Text,
  EmptyState,
  ErrorState,
  LoadingState,
  type Column,
} from '@/ui';
import { IconPlus } from '@/ui/icons';

interface Household {
  id: string;
  name: string;
  baseCurrency: string;
  status: string;
}
interface Account {
  id: string;
  name: string;
  currency: string;
}
interface Transaction {
  id: string;
  accountId: string;
  type: string;
  category: string;
  amountMinor: number;
  currency: string;
  status: string;
  occurredAt: string;
}
interface Summary {
  income: number;
  expense: number;
  net: number;
  savingsRate: number;
  byCategory: { category: string; amountMinor: number }[];
  currency: string;
  month?: string;
}
interface BudgetLine {
  category: string;
  limitMinor: number;
  spentMinor: number;
  remainingMinor: number;
  utilization: number;
  overBudget: boolean;
}
interface Budget {
  periodMonth: string;
  currency: string;
  exists: boolean;
  totalBudgetMinor: number | null;
  totalSpentMinor: number;
  totalRemainingMinor: number | null;
  overTotal: boolean;
  lines: BudgetLine[];
  uncategorized: { category: string; spentMinor: number }[];
}

const TX_TYPES = ['income', 'expense', 'transfer', 'adjustment'] as const;

/** Presentation-only money formatting. Never used to compute or convert. */
function fmt(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(minor / 100);
  } catch {
    return `${(minor / 100).toLocaleString()} ${currency}`;
  }
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Current month as YYYY-MM (local). */
function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function CashflowPage() {
  const { token, firm } = useApp();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const canWrite = firm.firmRole !== 'ANALYST'; // OWNER/ADVISOR/SUPPORT may record activity

  const [household, setHousehold] = useState<Household | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [month, setMonth] = useState(thisMonth());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);

  // New-transaction form.
  const [form, setForm] = useState({
    accountId: '',
    type: 'expense' as (typeof TX_TYPES)[number],
    category: '',
    amount: '',
    occurredAt: `${thisMonth()}-01`,
  });

  function loadMonth(hid: string, m: string) {
    void apiGet<Summary>(`/households/${hid}/cashflow/summary?month=${m}`, token)
      .then(setSummary)
      .catch(() => setSummary(null));
    void apiGet<Transaction[]>(`/households/${hid}/cashflow?month=${m}`, token)
      .then(setTransactions)
      .catch(() => setTransactions([]));
    void apiGet<Budget>(`/households/${hid}/budget?month=${m}`, token)
      .then(setBudget)
      .catch(() => setBudget(null));
  }

  useEffect(() => {
    if (!id) return;
    apiGet<Household>(`/households/${id}`, token)
      .then((h) => {
        setHousehold(h);
        void apiGet<Account[]>(`/households/${id}/accounts`, token)
          .then(setAccounts)
          .catch(() => setAccounts([]));
      })
      .catch(() => setError(true));
  }, [id, token]);

  useEffect(() => {
    if (!id || !household) return;
    loadMonth(id, month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, household, month]);

  const accountName = useMemo(() => {
    const map = new Map((accounts ?? []).map((a) => [a.id, a.name]));
    return (accountId: string) => map.get(accountId) ?? '—';
  }, [accounts]);

  async function addTransaction() {
    if (!household || !form.accountId || !form.category || !form.amount) return;
    setSaving(true);
    try {
      const acct = (accounts ?? []).find((a) => a.id === form.accountId);
      await apiPost(
        `/households/${household.id}/cashflow`,
        {
          accountId: form.accountId,
          type: form.type,
          category: form.category,
          amountMinor: Math.round(parseFloat(form.amount) * 100),
          currency: acct?.currency ?? household.baseCurrency,
          occurredAt: new Date(form.occurredAt).toISOString(),
        },
        token,
      );
      setForm((f) => ({ ...f, category: '', amount: '' }));
      loadMonth(household.id, month);
    } catch {
      // best-effort; states cover failure
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-4xl">
        <a href={`/app/households/${id}`} className="text-sm text-primary hover:underline">
          ◂ Back to household
        </a>
        <div className="mt-4">
          <ErrorState
            title="Household not found"
            description="It may have been removed, or it isn't in your book."
          />
        </div>
      </div>
    );
  }

  if (!household || accounts === null) {
    return (
      <div className="mx-auto max-w-4xl py-16">
        <LoadingState label="Loading cashflow…" />
      </div>
    );
  }

  const base = household.baseCurrency;

  const txColumns: Column<Transaction>[] = [
    { key: 'date', header: 'Date', cell: (t) => fmtDate(t.occurredAt) },
    {
      key: 'type',
      header: 'Type',
      cell: (t) => (
        <Badge tone={t.type === 'income' ? 'success' : t.type === 'expense' ? 'neutral' : 'primary'}>
          {t.type}
        </Badge>
      ),
    },
    { key: 'category', header: 'Category', cell: (t) => t.category },
    { key: 'account', header: 'Account', cell: (t) => accountName(t.accountId) },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (t) => (
        <span className={t.status === 'void' ? 'text-subtle line-through' : ''}>
          {fmt(t.amountMinor, t.currency)} <Badge tone="neutral">{t.currency}</Badge>
        </span>
      ),
    },
  ];

  const budgetColumns: Column<BudgetLine>[] = [
    { key: 'category', header: 'Category', cell: (l) => l.category },
    { key: 'budget', header: 'Budget', align: 'right', cell: (l) => fmt(l.limitMinor, base) },
    { key: 'spent', header: 'Actual', align: 'right', cell: (l) => fmt(l.spentMinor, base) },
    {
      key: 'remaining',
      header: 'Remaining',
      align: 'right',
      cell: (l) => (
        <span className={l.overBudget ? 'font-semibold text-danger' : ''}>
          {fmt(l.remainingMinor, base)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'right',
      cell: (l) =>
        l.overBudget ? <Badge tone="danger">Over</Badge> : <Badge tone="success">On track</Badge>,
    },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <a href={`/app/households/${id}`} className="text-sm text-primary hover:underline">
          ◂ Back to household
        </a>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Heading level={1}>Cashflow</Heading>
          <Badge tone="primary">{base}</Badge>
        </div>
        <Text muted>{household.name} · income, expense & budget in the household base currency</Text>
      </div>

      {/* Month selector */}
      <div className="flex flex-wrap items-center gap-3">
        <Field label="Month" htmlFor="cf-month">
          <Input
            id="cf-month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </Field>
      </div>

      {/* Monthly summary (server-computed, base currency) */}
      {summary && (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <StatCard label="Income" value={fmt(summary.income, summary.currency)} />
            <StatCard label="Expense" value={fmt(summary.expense, summary.currency)} />
            <StatCard label="Net" value={fmt(summary.net, summary.currency)} highlight />
            <StatCard label="Savings rate" value={`${Math.round(summary.savingsRate * 100)}%`} />
          </div>
          <Text muted className="text-xs">
            Figures are computed server-side in {summary.currency}; each transaction is FX-converted
            from its native currency. Transfers and adjustments are excluded.
          </Text>
        </>
      )}

      {/* Add transaction */}
      {canWrite && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Record a transaction</CardTitle>
              <CardDescription>Stored in the account's native currency.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {accounts.length === 0 ? (
              <Text muted>Add an account to this household first (Balance sheet).</Text>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Account" htmlFor="cf-account">
                  <Select
                    id="cf-account"
                    value={form.accountId}
                    onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
                  >
                    <option value="">Select account…</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.currency})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Type" htmlFor="cf-type">
                  <Select
                    id="cf-type"
                    value={form.type}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, type: e.target.value as (typeof TX_TYPES)[number] }))
                    }
                  >
                    {TX_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Category" htmlFor="cf-category">
                  <Input
                    id="cf-category"
                    placeholder="e.g. groceries"
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  />
                </Field>
                <Field label="Amount" htmlFor="cf-amount">
                  <Input
                    id="cf-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={form.amount}
                    onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  />
                </Field>
                <Field label="Date" htmlFor="cf-date">
                  <Input
                    id="cf-date"
                    type="date"
                    value={form.occurredAt}
                    onChange={(e) => setForm((f) => ({ ...f, occurredAt: e.target.value }))}
                  />
                </Field>
                <div className="flex items-end">
                  <Button
                    size="sm"
                    loading={saving}
                    leftIcon={<IconPlus className="h-4 w-4" />}
                    onClick={addTransaction}
                  >
                    Add transaction
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Transactions */}
      <Card flush>
        <CardHeader className="p-6 pb-0">
          <div>
            <CardTitle>Transactions</CardTitle>
            <CardDescription>Ledger for {month}, native currency (newest first).</CardDescription>
          </div>
        </CardHeader>
        <div className="p-2">
          {transactions === null ? (
            <div className="p-6">
              <LoadingState label="Loading transactions…" />
            </div>
          ) : transactions.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No transactions this month"
                description="Recorded income and expenses will appear here."
              />
            </div>
          ) : (
            <DataTable columns={txColumns} data={transactions} rowKey={(t) => t.id} />
          )}
        </div>
      </Card>

      {/* Budget vs actual */}
      <Card flush>
        <CardHeader className="p-6 pb-0">
          <div>
            <CardTitle>Budget vs actual</CardTitle>
            <CardDescription>
              Monthly envelopes compared with converted actuals ({base}).
            </CardDescription>
          </div>
        </CardHeader>
        <div className="p-2">
          {!budget || !budget.exists || budget.lines.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No budget set for this month"
                description="Set category envelopes via the budget API to track budget vs actual."
              />
            </div>
          ) : (
            <>
              {budget.totalBudgetMinor != null && (
                <div className="px-4 pb-2">
                  <Text muted className="text-sm">
                    Overall: {fmt(budget.totalSpentMinor, base)} of{' '}
                    {fmt(budget.totalBudgetMinor, base)}{' '}
                    {budget.overTotal ? (
                      <Badge tone="danger">Over</Badge>
                    ) : (
                      <Badge tone="success">On track</Badge>
                    )}
                  </Text>
                </div>
              )}
              <DataTable columns={budgetColumns} data={budget.lines} rowKey={(l) => l.category} />
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
