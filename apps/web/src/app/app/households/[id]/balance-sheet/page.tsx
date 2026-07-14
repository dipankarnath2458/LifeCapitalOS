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
interface Snapshot {
  id: string;
  assetsMinor: number;
  liabilitiesMinor: number;
  netWorthMinor: number;
  currency: string;
  capturedAt: string;
}
interface Account {
  id: string;
  name: string;
  type: string;
  assetClass: string | null;
  currency: string;
  balanceMinor: number;
  isLiability: boolean;
}

/** Presentation-only money formatting. Never used to compute or convert. */
function fmt(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(minor / 100);
  } catch {
    // Unknown/unsupported ISO code — fall back to a plain number + raw code.
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

export default function BalanceSheetPage() {
  const { token, firm } = useApp();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const canWrite = firm.firmRole !== 'ANALYST'; // OWNER/ADVISOR/SUPPORT may capture snapshots

  const [household, setHousehold] = useState<Household | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>('');
  const [error, setError] = useState(false);
  const [capturing, setCapturing] = useState(false);

  function loadSnapshots(t: string, hid: string) {
    return apiGet<Snapshot[]>(`/households/${hid}/net-worth/timeline`, t).then((rows) => {
      setSnapshots(rows);
      // Default to the newest snapshot (the API returns oldest-first).
      const newest = rows.at(-1);
      setSelectedId((prev) => (rows.some((s) => s.id === prev) ? prev : (newest?.id ?? '')));
    });
  }

  useEffect(() => {
    if (!id) return;
    apiGet<Household>(`/households/${id}`, token)
      .then((h) => {
        setHousehold(h);
        void loadSnapshots(token, id).catch(() => setSnapshots([]));
        void apiGet<Account[]>(`/households/${id}/accounts`, token)
          .then(setAccounts)
          .catch(() => setAccounts([]));
      })
      .catch(() => setError(true));
  }, [id, token]);

  // Newest-first for the selector + history (API returns oldest-first).
  const byNewest = useMemo(() => (snapshots ? [...snapshots].reverse() : []), [snapshots]);
  const selected = byNewest.find((s) => s.id === selectedId) ?? byNewest[0];
  const assetAccounts = (accounts ?? []).filter((a) => !a.isLiability);
  const liabilityAccounts = (accounts ?? []).filter((a) => a.isLiability);

  const allocation = useMemo(() => {
    const byClass = new Map<string, number>();
    for (const a of assetAccounts) {
      const key = a.assetClass ?? 'unclassified';
      byClass.set(key, (byClass.get(key) ?? 0) + 1);
    }
    return [...byClass.entries()].map(([assetClass, count]) => ({ assetClass, count }));
  }, [accounts]);

  async function capture() {
    if (!household) return;
    setCapturing(true);
    try {
      await apiPost(`/households/${household.id}/net-worth/snapshot`, {}, token);
      await loadSnapshots(token, household.id);
    } catch {
      // best-effort; the empty/error states cover failure
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
          <ErrorState
            title="Household not found"
            description="It may have been removed, or it isn't in your book."
          />
        </div>
      </div>
    );
  }

  if (!household || snapshots === null || accounts === null) {
    return (
      <div className="mx-auto max-w-4xl py-16">
        <LoadingState label="Loading balance sheet…" />
      </div>
    );
  }

  const accountColumns: Column<Account>[] = [
    { key: 'name', header: 'Account', cell: (a) => <span className="font-medium">{a.name}</span> },
    { key: 'class', header: 'Class', cell: (a) => a.assetClass ?? a.type },
    {
      key: 'balance',
      header: 'Balance',
      align: 'right',
      cell: (a) => (
        <span>
          {fmt(a.balanceMinor, a.currency)} <Badge tone="neutral">{a.currency}</Badge>
        </span>
      ),
    },
  ];

  const historyColumns: Column<Snapshot>[] = [
    { key: 'date', header: 'Captured', cell: (s) => fmtDate(s.capturedAt) },
    {
      key: 'assets',
      header: 'Assets',
      align: 'right',
      cell: (s) => fmt(s.assetsMinor, s.currency),
    },
    {
      key: 'liabilities',
      header: 'Liabilities',
      align: 'right',
      cell: (s) => fmt(s.liabilitiesMinor, s.currency),
    },
    {
      key: 'networth',
      header: 'Net worth',
      align: 'right',
      cell: (s) => <span className="font-semibold">{fmt(s.netWorthMinor, s.currency)}</span>,
    },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <a href={`/app/households/${id}`} className="text-sm text-primary hover:underline">
          ◂ Back to household
        </a>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Heading level={1}>Balance sheet</Heading>
          <Badge tone="primary">{household.baseCurrency}</Badge>
        </div>
        <Text muted>{household.name} · consolidated in the household base currency</Text>
      </div>

      {byNewest.length === 0 ? (
        <EmptyState
          title="No snapshot captured yet"
          description={
            canWrite
              ? 'Capture the household’s first net-worth snapshot to start the balance-sheet history.'
              : 'A net-worth snapshot has not been captured for this household yet.'
          }
          {...(canWrite ? { action: { label: 'Capture snapshot', onClick: capture } } : {})}
        />
      ) : (
        <>
          {/* Snapshot selector + capture */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-subtle">
              Snapshot
              <Select
                aria-label="Select snapshot"
                value={selected?.id ?? ''}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                {byNewest.map((s, i) => (
                  <option key={s.id} value={s.id}>
                    {i === 0 ? 'Latest · ' : ''}
                    {fmtDate(s.capturedAt)}
                  </option>
                ))}
              </Select>
            </label>
            {canWrite && (
              <Button
                variant="outline"
                size="sm"
                loading={capturing}
                leftIcon={<IconPlus className="h-4 w-4" />}
                onClick={capture}
              >
                Capture snapshot
              </Button>
            )}
          </div>

          {/* Net worth summary (from the selected immutable snapshot) */}
          {selected && (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard
                  label="Net worth"
                  value={fmt(selected.netWorthMinor, selected.currency)}
                  hint={`as of ${fmtDate(selected.capturedAt)}`}
                  highlight
                />
                <StatCard
                  label="Total assets"
                  value={fmt(selected.assetsMinor, selected.currency)}
                />
                <StatCard
                  label="Total liabilities"
                  value={fmt(selected.liabilitiesMinor, selected.currency)}
                />
              </div>
              <Text muted className="text-xs">
                Consolidated figures are immutable snapshots computed server-side in{' '}
                {selected.currency}. Holdings below reflect the household’s current accounts.
              </Text>
            </>
          )}
        </>
      )}

      {/* Current holdings — assets */}
      <Card flush>
        <CardHeader className="p-6 pb-0">
          <div>
            <CardTitle>Assets — current holdings</CardTitle>
            <CardDescription>
              Accounts shown in their native currency (not converted).
            </CardDescription>
          </div>
        </CardHeader>
        <div className="p-2">
          <DataTable
            columns={accountColumns}
            data={assetAccounts}
            rowKey={(a) => a.id}
            empty="No asset accounts yet."
          />
        </div>
      </Card>

      {/* Current holdings — liabilities */}
      <Card flush>
        <CardHeader className="p-6 pb-0">
          <div>
            <CardTitle>Liabilities — current holdings</CardTitle>
            <CardDescription>
              Accounts shown in their native currency (not converted).
            </CardDescription>
          </div>
        </CardHeader>
        <div className="p-2">
          <DataTable
            columns={accountColumns}
            data={liabilityAccounts}
            rowKey={(a) => a.id}
            empty="No liability accounts."
          />
        </div>
      </Card>

      {/* Asset allocation summary (classes present; FX-normalized % is a future backend endpoint) */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Asset allocation</CardTitle>
            <CardDescription>
              Asset classes held (by account). Weighted allocation arrives with M2-6.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {allocation.length === 0 ? (
            <Text muted>No asset accounts to classify yet.</Text>
          ) : (
            <div className="flex flex-wrap gap-2">
              {allocation.map((a) => (
                <Badge key={a.assetClass} variant="outline">
                  {a.assetClass}: {a.count}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Timeline / history */}
      <Card flush>
        <CardHeader className="p-6 pb-0">
          <div>
            <CardTitle>Net-worth history</CardTitle>
            <CardDescription>Captured snapshots over time (newest first).</CardDescription>
          </div>
          <IconChart className="h-5 w-5 text-subtle" />
        </CardHeader>
        <div className="p-2">
          <DataTable
            columns={historyColumns}
            data={byNewest}
            rowKey={(s) => s.id}
            empty="No snapshots captured yet."
            onRowClick={(s) => setSelectedId(s.id)}
          />
        </div>
      </Card>
    </div>
  );
}
