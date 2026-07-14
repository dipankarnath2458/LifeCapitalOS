'use client';

import { useEffect, useState } from 'react';
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
interface Debt {
  id: string;
  name: string;
  type: string;
  secured: boolean;
  lender: string | null;
  currency: string;
  principalMinor: number;
  outstandingMinor: number;
  annualInterestRatePct: number;
  minimumPaymentMinor: number;
  emiMinor: number | null;
  status: string;
}
interface DebtSummary {
  totalOutstandingMinor: number;
  totalMonthlyPaymentMinor: number;
  weightedAvgRatePct: number;
  debtCount: number;
  byType: { type: string; outstandingMinor: number }[];
  currency: string;
}
interface Payoff {
  strategy: string;
  months: number;
  totalInterestMinor: number;
  payoffOrder: { id: string; name: string; clearedInMonth: number }[];
  converged: boolean;
  currency: string;
}

const DEBT_TYPES = [
  'home_loan',
  'personal_loan',
  'vehicle_loan',
  'education_loan',
  'business_loan',
  'credit_card',
  'other',
] as const;

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

function label(type: string): string {
  return type.replace(/_/g, ' ');
}

export default function DebtPage() {
  const { token, firm } = useApp();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const canWrite = firm.firmRole !== 'ANALYST'; // OWNER/ADVISOR/SUPPORT may record debt

  const [household, setHousehold] = useState<Household | null>(null);
  const [debts, setDebts] = useState<Debt[] | null>(null);
  const [summary, setSummary] = useState<DebtSummary | null>(null);
  const [payoff, setPayoff] = useState<Payoff | null>(null);
  const [strategy, setStrategy] = useState<'avalanche' | 'snowball'>('avalanche');
  const [extra, setExtra] = useState('0');
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: '',
    type: 'home_loan' as (typeof DEBT_TYPES)[number],
    currency: '',
    principal: '',
    rate: '',
    emi: '',
  });

  function loadDebts(hid: string) {
    void apiGet<Debt[]>(`/households/${hid}/debts`, token)
      .then(setDebts)
      .catch(() => setDebts([]));
    void apiGet<DebtSummary>(`/households/${hid}/debts/summary`, token)
      .then(setSummary)
      .catch(() => setSummary(null));
  }

  function loadPayoff(hid: string, s: string, extraMinor: number) {
    void apiGet<Payoff>(
      `/households/${hid}/debts/payoff?strategy=${s}&extraMonthlyMinor=${extraMinor}`,
      token,
    )
      .then(setPayoff)
      .catch(() => setPayoff(null));
  }

  useEffect(() => {
    if (!id) return;
    apiGet<Household>(`/households/${id}`, token)
      .then((h) => {
        setHousehold(h);
        loadDebts(id);
        loadPayoff(id, strategy, 0);
      })
      .catch(() => setError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  function refreshPayoff() {
    if (!household) return;
    loadPayoff(household.id, strategy, Math.round((parseFloat(extra) || 0) * 100));
  }

  async function addDebt() {
    if (!household || !form.name || !form.principal || !form.rate) return;
    setSaving(true);
    try {
      const principalMinor = Math.round(parseFloat(form.principal) * 100);
      await apiPost(
        `/households/${household.id}/debts`,
        {
          name: form.name,
          type: form.type,
          secured: form.type === 'home_loan' || form.type === 'vehicle_loan',
          currency: form.currency || household.baseCurrency,
          principalMinor,
          annualInterestRatePct: parseFloat(form.rate),
          minimumPaymentMinor: form.emi ? Math.round(parseFloat(form.emi) * 100) : 0,
          emiMinor: form.emi ? Math.round(parseFloat(form.emi) * 100) : undefined,
        },
        token,
      );
      setForm((f) => ({ ...f, name: '', principal: '', rate: '', emi: '' }));
      loadDebts(household.id);
      refreshPayoff();
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

  if (!household || debts === null) {
    return (
      <div className="mx-auto max-w-4xl py-16">
        <LoadingState label="Loading debts…" />
      </div>
    );
  }

  const base = household.baseCurrency;
  const activeDebts = debts.filter((d) => d.status === 'active');

  const debtColumns: Column<Debt>[] = [
    { key: 'name', header: 'Debt', cell: (d) => <span className="font-medium">{d.name}</span> },
    {
      key: 'type',
      header: 'Type',
      cell: (d) => (
        <span>
          {label(d.type)} {d.secured && <Badge tone="neutral">secured</Badge>}
        </span>
      ),
    },
    { key: 'rate', header: 'Rate', align: 'right', cell: (d) => `${d.annualInterestRatePct}%` },
    {
      key: 'outstanding',
      header: 'Outstanding',
      align: 'right',
      cell: (d) => (
        <span>
          {fmt(d.outstandingMinor, d.currency)} <Badge tone="neutral">{d.currency}</Badge>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'right',
      cell: (d) => (
        <Badge tone={d.status === 'active' ? 'primary' : d.status === 'closed' ? 'success' : 'neutral'}>
          {d.status}
        </Badge>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <a href={`/app/households/${id}`} className="text-sm text-primary hover:underline">
          ◂ Back to household
        </a>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Heading level={1}>Debt & payoff</Heading>
          <Badge tone="primary">{base}</Badge>
        </div>
        <Text muted>{household.name} · liabilities consolidated in the household base currency</Text>
      </div>

      {/* Summary (server-computed, base currency) */}
      {summary && (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <StatCard
              label="Total outstanding"
              value={fmt(summary.totalOutstandingMinor, summary.currency)}
              highlight
            />
            <StatCard
              label="Monthly obligation"
              value={fmt(summary.totalMonthlyPaymentMinor, summary.currency)}
            />
            <StatCard label="Avg rate" value={`${summary.weightedAvgRatePct.toFixed(2)}%`} />
            <StatCard label="Active debts" value={summary.debtCount} />
          </div>
          <Text muted className="text-xs">
            Figures are computed server-side in {summary.currency}; each debt is FX-converted from its
            native currency. Only active debts are included.
          </Text>
        </>
      )}

      {/* Add debt */}
      {canWrite && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Add a debt</CardTitle>
              <CardDescription>Stored in its native currency.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" htmlFor="d-name">
                <Input
                  id="d-name"
                  placeholder="e.g. HDFC Home Loan"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </Field>
              <Field label="Type" htmlFor="d-type">
                <Select
                  id="d-type"
                  value={form.type}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, type: e.target.value as (typeof DEBT_TYPES)[number] }))
                  }
                >
                  {DEBT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {label(t)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Principal" htmlFor="d-principal">
                <Input
                  id="d-principal"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={form.principal}
                  onChange={(e) => setForm((f) => ({ ...f, principal: e.target.value }))}
                />
              </Field>
              <Field label="Interest rate (%)" htmlFor="d-rate">
                <Input
                  id="d-rate"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={form.rate}
                  onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))}
                />
              </Field>
              <Field label="EMI / min payment" htmlFor="d-emi">
                <Input
                  id="d-emi"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={form.emi}
                  onChange={(e) => setForm((f) => ({ ...f, emi: e.target.value }))}
                />
              </Field>
              <Field label="Currency" htmlFor="d-ccy" hint={`defaults to ${base}`}>
                <Input
                  id="d-ccy"
                  placeholder={base}
                  value={form.currency}
                  onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
                />
              </Field>
              <div className="flex items-end">
                <Button
                  size="sm"
                  loading={saving}
                  leftIcon={<IconPlus className="h-4 w-4" />}
                  onClick={addDebt}
                >
                  Add debt
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Debts */}
      <Card flush>
        <CardHeader className="p-6 pb-0">
          <div>
            <CardTitle>Debts</CardTitle>
            <CardDescription>Liabilities in their native currency.</CardDescription>
          </div>
        </CardHeader>
        <div className="p-2">
          {debts.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No debts recorded"
                description="Home, vehicle, personal, education and other liabilities will appear here."
              />
            </div>
          ) : (
            <DataTable columns={debtColumns} data={debts} rowKey={(d) => d.id} />
          )}
        </div>
      </Card>

      {/* Payoff projection */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Payoff projection</CardTitle>
            <CardDescription>
              Snowball (smallest balance first) vs avalanche (highest rate first), in {base}.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Strategy" htmlFor="p-strategy">
              <Select
                id="p-strategy"
                value={strategy}
                onChange={(e) => setStrategy(e.target.value as 'avalanche' | 'snowball')}
              >
                <option value="avalanche">Avalanche</option>
                <option value="snowball">Snowball</option>
              </Select>
            </Field>
            <Field label="Extra / month" htmlFor="p-extra">
              <Input
                id="p-extra"
                type="number"
                min="0"
                step="0.01"
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
              />
            </Field>
            <div className="flex items-end">
              <Button variant="outline" size="sm" onClick={refreshPayoff}>
                Project
              </Button>
            </div>
          </div>

          {activeDebts.length === 0 ? (
            <Text muted className="mt-4">
              No active debts to project.
            </Text>
          ) : payoff ? (
            <div className="mt-4 space-y-2">
              {payoff.converged ? (
                <Text>
                  Cleared in <strong>{payoff.months}</strong> months · total interest{' '}
                  <strong>{fmt(payoff.totalInterestMinor, payoff.currency)}</strong>
                </Text>
              ) : (
                <Text className="text-danger">
                  The budget can't cover interest — increase the extra monthly payment.
                </Text>
              )}
              <div className="flex flex-wrap gap-2">
                {payoff.payoffOrder.map((p, i) => (
                  <Badge key={p.id} variant="outline">
                    {i + 1}. {p.name} · month {p.clearedInMonth}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
