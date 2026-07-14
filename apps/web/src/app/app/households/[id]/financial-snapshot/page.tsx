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
  Heading,
  Text,
  EmptyState,
  ErrorState,
  LoadingState,
  type Column,
} from '@/ui';
import { IconChart, IconPlus } from '@/ui/icons';

interface Household {
  id: string;
  name: string;
  baseCurrency: string;
  status: string;
}
interface Payload {
  netWorth: { assetsMinor: number; liabilitiesMinor: number; netWorthMinor: number; solvencyRatio: number };
  debt: { totalOutstandingMinor: number; weightedAvgRatePct: number; debtCount: number };
  cashflowSummary: { period: string; incomeMinor: number; expenseMinor: number; netMinor: number; savingsRate: number };
  assetAllocation: { assetClass: string; baseValueMinor: number; pct: number }[];
  currencyExposure: { currency: string; baseValueMinor: number; pct: number }[];
  householdEquity: { netWorthMinor: number; totalDebtMinor: number; reconciledEquityMinor: number };
}
interface CurrentView {
  live: boolean;
  schemaVersion: number;
  engineVersion: string;
  fxVersion: string;
  currency: string;
  payload: Payload;
}
interface Snapshot {
  id: string;
  capturedAt: string;
  snapshotVersion: number;
  schemaVersion: number;
  currency: string;
  checksum: string;
  status: string;
  payload: Payload;
}
interface TimelineRow {
  id: string;
  capturedAt: string;
  snapshotVersion: number;
  netWorthMinor: number;
  totalDebtMinor: number;
  savingsRate: number;
}

/** Presentation-only money formatting. Never used to compute or convert. */
function fmt(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(
      minor / 100,
    );
  } catch {
    return `${(minor / 100).toLocaleString()} ${currency}`;
  }
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function FinancialSnapshotPage() {
  const { token, firm } = useApp();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const canWrite = firm.firmRole !== 'ANALYST'; // OWNER/ADVISOR/SUPPORT may capture

  const [household, setHousehold] = useState<Household | null>(null);
  const [current, setCurrent] = useState<CurrentView | null>(null);
  const [latest, setLatest] = useState<Snapshot | null>(null);
  const [timeline, setTimeline] = useState<TimelineRow[] | null>(null);
  const [error, setError] = useState(false);
  const [capturing, setCapturing] = useState(false);

  function load(hid: string) {
    void apiGet<CurrentView>(`/households/${hid}/financial-snapshot/current`, token)
      .then(setCurrent)
      .catch(() => setCurrent(null));
    void apiGet<Snapshot | null>(`/households/${hid}/financial-snapshot/latest`, token)
      .then(setLatest)
      .catch(() => setLatest(null));
    void apiGet<TimelineRow[]>(`/households/${hid}/financial-snapshot/timeline`, token)
      .then(setTimeline)
      .catch(() => setTimeline([]));
  }

  useEffect(() => {
    if (!id) return;
    apiGet<Household>(`/households/${id}`, token)
      .then((h) => {
        setHousehold(h);
        load(id);
      })
      .catch(() => setError(true));
  }, [id, token]);

  async function capture() {
    if (!household) return;
    setCapturing(true);
    try {
      await apiPost(`/households/${household.id}/financial-snapshot`, {}, token);
      load(household.id);
    } catch {
      // best-effort; states cover failure
    } finally {
      setCapturing(false);
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-4xl">
        <a href={`/app/households/${id}`} className="text-sm text-primary hover:underline">
          ◂ Back to household
        </a>
        <div className="mt-4">
          <ErrorState title="Household not found" description="It may have been removed, or it isn't in your book." />
        </div>
      </div>
    );
  }

  if (!household || current === null || timeline === null) {
    return (
      <div className="mx-auto max-w-4xl py-16">
        <LoadingState label="Composing financial snapshot…" />
      </div>
    );
  }

  const base = household.baseCurrency;
  const p = current.payload;

  const timelineColumns: Column<TimelineRow>[] = [
    { key: 'v', header: 'Version', cell: (r) => `#${r.snapshotVersion}` },
    { key: 'date', header: 'Captured', cell: (r) => fmtDate(r.capturedAt) },
    { key: 'nw', header: 'Net worth', align: 'right', cell: (r) => <span className="font-semibold">{fmt(r.netWorthMinor, base)}</span> },
    { key: 'debt', header: 'Debt', align: 'right', cell: (r) => fmt(r.totalDebtMinor, base) },
    { key: 'sr', header: 'Savings', align: 'right', cell: (r) => `${Math.round(r.savingsRate * 100)}%` },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <a href={`/app/households/${id}`} className="text-sm text-primary hover:underline">
          ◂ Back to household
        </a>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Heading level={1}>Financial snapshot</Heading>
          <Badge tone="primary">{base}</Badge>
        </div>
        <Text muted>{household.name} · the canonical financial position, composed from all engines</Text>
      </div>

      {/* Live composed view */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Text muted className="text-xs">
          Live preview · schema v{current.schemaVersion} · engine {current.engineVersion} · fx {current.fxVersion}.
          Composed server-side; capture to freeze an immutable record.
        </Text>
        {canWrite && (
          <Button size="sm" loading={capturing} leftIcon={<IconPlus className="h-4 w-4" />} onClick={capture}>
            Capture snapshot
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Net worth" value={fmt(p.netWorth.netWorthMinor, base)} highlight />
        <StatCard label="Assets" value={fmt(p.netWorth.assetsMinor, base)} />
        <StatCard label="Total debt" value={fmt(p.debt.totalOutstandingMinor, base)} />
        <StatCard label="Reconciled equity" value={fmt(p.householdEquity.reconciledEquityMinor, base)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={`Income (${p.cashflowSummary.period})`} value={fmt(p.cashflowSummary.incomeMinor, base)} />
        <StatCard label="Expense" value={fmt(p.cashflowSummary.expenseMinor, base)} />
        <StatCard label="Savings rate" value={`${Math.round(p.cashflowSummary.savingsRate * 100)}%`} />
      </div>

      {/* Allocation + currency exposure */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Asset allocation</CardTitle>
              <CardDescription>By asset class (base currency).</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {p.assetAllocation.length === 0 ? (
              <Text muted>No assets to allocate.</Text>
            ) : (
              <div className="flex flex-wrap gap-2">
                {p.assetAllocation.map((a) => (
                  <Badge key={a.assetClass} variant="outline">
                    {a.assetClass}: {a.pct}%
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Currency exposure</CardTitle>
              <CardDescription>Gross, by native currency.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {p.currencyExposure.length === 0 ? (
              <Text muted>No holdings.</Text>
            ) : (
              <div className="flex flex-wrap gap-2">
                {p.currencyExposure.map((c) => (
                  <Badge key={c.currency} variant="outline">
                    {c.currency}: {c.pct}%
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Latest captured snapshot */}
      {latest && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Latest captured snapshot</CardTitle>
              <CardDescription>
                #{latest.snapshotVersion} · {fmtDate(latest.capturedAt)} · immutable
              </CardDescription>
            </div>
            <Badge tone="success">{latest.status}</Badge>
          </CardHeader>
          <CardContent>
            <Text muted className="break-all text-xs">
              checksum {latest.checksum}
            </Text>
          </CardContent>
        </Card>
      )}

      {/* Timeline */}
      <Card flush>
        <CardHeader className="p-6 pb-0">
          <div>
            <CardTitle>Snapshot history</CardTitle>
            <CardDescription>Immutable captures over time (oldest first).</CardDescription>
          </div>
          <IconChart className="h-5 w-5 text-subtle" />
        </CardHeader>
        <div className="p-2">
          {timeline.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No snapshots captured yet"
                description={canWrite ? 'Capture the first immutable financial snapshot above.' : 'None captured yet.'}
              />
            </div>
          ) : (
            <DataTable columns={timelineColumns} data={[...timeline].reverse()} rowKey={(r) => r.id} />
          )}
        </div>
      </Card>
    </div>
  );
}
