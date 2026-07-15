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
  type BadgeTone,
} from '@/ui';
import { IconChart } from '@/ui/icons';

interface Household {
  id: string;
  name: string;
  baseCurrency: string;
}
interface ScenarioType {
  type: string;
  params: string[];
}
interface CategoryImpact {
  key: string;
  label: string;
  before: number;
  after: number;
  delta: number;
  direction: string;
}
interface Recommendation {
  id: string;
  title: string;
  recommendedAction: string;
  priority: string;
  estimatedScoreImprovement: number;
}
interface SimResult {
  summary: {
    overallBefore: number;
    overallAfter: number;
    overallDelta: number;
    bandBefore: string;
    bandAfter: string;
    narrative: string;
  };
  categoryImpacts: CategoryImpact[];
  recommendations: Recommendation[];
  bestSingleAction: { overallDelta: number; narrative: string } | null;
}
interface SimResponse {
  available: boolean;
  result?: SimResult;
}

const bandLabel = (b: string) => b.replace(/_/g, ' ');
const BAND_TONE: Record<string, BadgeTone> = {
  at_risk: 'danger',
  needs_attention: 'warning',
  fair: 'neutral',
  good: 'success',
  excellent: 'success',
};

/** Which param key an amount maps to, per scenario type. */
function amountKey(type: string): string {
  if (['reduce_expenses', 'increase_savings', 'increase_sip', 'retirement_contribution'].includes(type))
    return 'monthlyAmountMinor';
  if (type === 'improve_insurance') return 'monthlyPremiumMinor';
  return 'amountMinor';
}
const needsAssetClass = (t: string) => ['buy_asset', 'sell_asset', 'increase_sip', 'retirement_contribution'].includes(t);
const needsFromTo = (t: string) => t === 'reallocate';

export default function SimulationPage() {
  const { token } = useApp();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [household, setHousehold] = useState<Household | null>(null);
  const [types, setTypes] = useState<ScenarioType[] | null>(null);
  const [error, setError] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SimResult | null>(null);
  const [noSnapshot, setNoSnapshot] = useState(false);

  const [form, setForm] = useState({
    type: 'increase_emergency_fund',
    amount: '',
    assetClass: 'equity',
    fromClass: 'equity',
    toClass: 'cash',
  });

  useEffect(() => {
    if (!id) return;
    apiGet<Household>(`/households/${id}`, token)
      .then((h) => {
        setHousehold(h);
        void apiGet<{ scenarioTypes: ScenarioType[] }>(`/households/${id}/simulation/scenario-types`, token)
          .then((r) => setTypes(r.scenarioTypes))
          .catch(() => setTypes([]));
      })
      .catch(() => setError(true));
  }, [id, token]);

  async function run() {
    if (!household || !form.amount) return;
    setRunning(true);
    setNoSnapshot(false);
    try {
      const params: Record<string, number | string> = {
        [amountKey(form.type)]: Math.round(parseFloat(form.amount) * 100),
      };
      if (needsAssetClass(form.type)) params.assetClass = form.assetClass;
      if (needsFromTo(form.type)) {
        params.fromClass = form.fromClass;
        params.toClass = form.toClass;
      }
      const res = await apiPost<SimResponse>(
        `/households/${household.id}/simulation`,
        { scenarios: [{ type: form.type, params }] },
        token,
      );
      if (!res.available) {
        setNoSnapshot(true);
        setResult(null);
      } else {
        setResult(res.result ?? null);
      }
    } catch {
      setResult(null);
    } finally {
      setRunning(false);
    }
  }

  const impactColumns: Column<CategoryImpact>[] = useMemo(
    () => [
      { key: 'label', header: 'Category', cell: (c) => <span className="font-medium">{c.label}</span> },
      { key: 'before', header: 'Before', align: 'right', cell: (c) => c.before },
      { key: 'after', header: 'After', align: 'right', cell: (c) => c.after },
      {
        key: 'delta',
        header: 'Change',
        align: 'right',
        cell: (c) => (
          <span
            className={
              c.direction === 'improved'
                ? 'font-semibold text-success'
                : c.direction === 'weakened'
                  ? 'font-semibold text-danger'
                  : 'text-subtle'
            }
          >
            {c.delta > 0 ? '▲ +' : c.delta < 0 ? '▼ ' : '– '}
            {c.delta !== 0 ? c.delta : ''}
          </span>
        ),
      },
    ],
    [],
  );

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

  if (!household || types === null) {
    return (
      <div className="mx-auto max-w-4xl py-16">
        <LoadingState label="Loading simulation…" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <a href={`/app/households/${id}`} className="text-sm text-primary hover:underline">
          ◂ Back to household
        </a>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Heading level={1}>What-if simulation</Heading>
          <Badge tone="primary">{household.baseCurrency}</Badge>
        </div>
        <Text muted>
          {household.name} · simulate a decision against the latest immutable snapshot — nothing is saved.
        </Text>
      </div>

      {/* Scenario builder */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Simulate a decision</CardTitle>
            <CardDescription>Pick a scenario and an amount, then run.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Scenario" htmlFor="s-type">
              <Select id="s-type" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                {types.map((t) => (
                  <option key={t.type} value={t.type}>
                    {t.type.replace(/_/g, ' ')}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Amount" htmlFor="s-amount">
              <Input
                id="s-amount"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </Field>
            {needsAssetClass(form.type) && (
              <Field label="Asset class" htmlFor="s-class">
                <Input id="s-class" value={form.assetClass} onChange={(e) => setForm((f) => ({ ...f, assetClass: e.target.value }))} />
              </Field>
            )}
            {needsFromTo(form.type) && (
              <>
                <Field label="From class" htmlFor="s-from">
                  <Input id="s-from" value={form.fromClass} onChange={(e) => setForm((f) => ({ ...f, fromClass: e.target.value }))} />
                </Field>
                <Field label="To class" htmlFor="s-to">
                  <Input id="s-to" value={form.toClass} onChange={(e) => setForm((f) => ({ ...f, toClass: e.target.value }))} />
                </Field>
              </>
            )}
            <div className="flex items-end">
              <Button size="sm" loading={running} onClick={run}>
                Run simulation
              </Button>
            </div>
          </div>
          {noSnapshot && (
            <Text muted className="mt-3 text-sm">
              No Financial Snapshot yet — capture one first on the Financial Snapshot page.
            </Text>
          )}
        </CardContent>
      </Card>

      {/* Result */}
      {result && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Score before" value={result.summary.overallBefore} />
            <StatCard label="Score after" value={result.summary.overallAfter} highlight />
            <StatCard
              label="Change"
              value={`${result.summary.overallDelta >= 0 ? '+' : ''}${result.summary.overallDelta}`}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={BAND_TONE[result.summary.bandBefore] ?? 'neutral'}>{bandLabel(result.summary.bandBefore)}</Badge>
            <span className="text-subtle">→</span>
            <Badge tone={BAND_TONE[result.summary.bandAfter] ?? 'neutral'}>{bandLabel(result.summary.bandAfter)}</Badge>
            <Text muted className="text-sm">
              {result.summary.narrative}
            </Text>
          </div>

          <Card flush>
            <CardHeader className="p-6 pb-0">
              <div>
                <CardTitle>Category impact</CardTitle>
                <CardDescription>How each dimension of financial health changes.</CardDescription>
              </div>
              <IconChart className="h-5 w-5 text-subtle" />
            </CardHeader>
            <div className="p-2">
              <DataTable columns={impactColumns} data={result.categoryImpacts} rowKey={(c) => c.key} />
            </div>
          </Card>

          {result.bestSingleAction && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Best single action</CardTitle>
                  <CardDescription>{result.bestSingleAction.narrative}</CardDescription>
                </div>
                <Badge tone="primary">
                  {result.bestSingleAction.overallDelta >= 0 ? '+' : ''}
                  {result.bestSingleAction.overallDelta} pts
                </Badge>
              </CardHeader>
            </Card>
          )}

          {result.recommendations.length > 0 && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Next-best recommendations</CardTitle>
                  <CardDescription>After this change, the highest-priority actions.</CardDescription>
                </div>
              </CardHeader>
              <div className="px-6 pb-6">
                <ol className="space-y-2">
                  {result.recommendations.slice(0, 3).map((r) => (
                    <li key={r.id} className="rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={r.priority === 'high' ? 'danger' : r.priority === 'medium' ? 'warning' : 'neutral'}>
                          {r.priority}
                        </Badge>
                        <span className="font-medium">{r.title}</span>
                        <span className="text-xs text-subtle">+{r.estimatedScoreImprovement} pts</span>
                      </div>
                      <Text muted className="mt-1 text-sm">
                        {r.recommendedAction}
                      </Text>
                    </li>
                  ))}
                </ol>
              </div>
            </Card>
          )}
        </>
      )}

      {!result && !noSnapshot && (
        <EmptyState title="No simulation yet" description="Pick a scenario above and run it to see the impact." />
      )}
    </div>
  );
}
