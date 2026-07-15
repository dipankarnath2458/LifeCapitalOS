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
  DataTable,
  Badge,
  Button,
  Heading,
  Text,
  EmptyState,
  ErrorState,
  LoadingState,
  type Column,
  type BadgeTone,
} from '@/ui';
import { IconChart, IconPlus } from '@/ui/icons';

interface Household {
  id: string;
  name: string;
  baseCurrency: string;
}
interface Category {
  key: string;
  label: string;
  weight: number;
  score: number;
  band: string;
  metric: { name: string; value: number; unit: string };
  reason: string;
  suggestion: string;
}
interface ScoreView {
  available: boolean;
  live?: boolean;
  snapshotId?: string;
  scoreModelVersion?: string;
  currency?: string;
  overall?: number;
  band?: string;
  categories?: Category[];
  drivers?: { top: string[]; weakest: string[] };
  reason?: string;
}
interface TimelineRow {
  id: string;
  overall: number;
  band: string;
  computedAt: string;
}
interface Recommendation {
  id: string;
  title: string;
  description: string;
  affectedCategory: string;
  priority: string;
  priorityRank: number;
  estimatedScoreImprovement: number;
  recommendedAction: string;
  reasonCode: string;
}
interface Explanation {
  summary: string;
  recommendations: Recommendation[];
  potentialScoreImprovement: number;
  potentialOverall: number;
  confidence: number;
  reasonCodes: string[];
}
interface ExplanationView {
  available: boolean;
  explanation?: Explanation;
}

const BAND_TONE: Record<string, BadgeTone> = {
  at_risk: 'danger',
  needs_attention: 'warning',
  fair: 'neutral',
  good: 'success',
  excellent: 'success',
};
const bandLabel = (b: string) => b.replace(/_/g, ' ');

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function HealthScorePage() {
  const { token, firm } = useApp();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const canWrite = firm.firmRole !== 'ANALYST'; // OWNER/ADVISOR/SUPPORT may persist a score

  const [household, setHousehold] = useState<Household | null>(null);
  const [score, setScore] = useState<ScoreView | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [timeline, setTimeline] = useState<TimelineRow[] | null>(null);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);

  function load(hid: string) {
    void apiGet<ScoreView>(`/households/${hid}/health-score/current`, token)
      .then(setScore)
      .catch(() => setScore({ available: false }));
    void apiGet<ExplanationView>(`/households/${hid}/health-score/explanation/current`, token)
      .then((r) => setExplanation(r.available ? (r.explanation ?? null) : null))
      .catch(() => setExplanation(null));
    void apiGet<TimelineRow[]>(`/households/${hid}/health-score/timeline`, token)
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

  async function persist() {
    if (!household) return;
    setSaving(true);
    try {
      await apiPost(`/households/${household.id}/health-score`, {}, token);
      load(household.id);
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
          <ErrorState title="Household not found" description="It may have been removed, or it isn't in your book." />
        </div>
      </div>
    );
  }

  if (!household || score === null || timeline === null) {
    return (
      <div className="mx-auto max-w-4xl py-16">
        <LoadingState label="Scoring financial health…" />
      </div>
    );
  }

  const base = household.baseCurrency;

  const categoryColumns: Column<Category>[] = [
    { key: 'label', header: 'Category', cell: (c) => <span className="font-medium">{c.label}</span> },
    { key: 'score', header: 'Score', align: 'right', cell: (c) => <span className="font-semibold">{c.score}</span> },
    {
      key: 'band',
      header: 'Band',
      cell: (c) => <Badge tone={BAND_TONE[c.band] ?? 'neutral'}>{bandLabel(c.band)}</Badge>,
    },
    { key: 'reason', header: 'Why', cell: (c) => <span className="text-sm text-subtle">{c.reason}</span> },
  ];

  const timelineColumns: Column<TimelineRow>[] = [
    { key: 'date', header: 'Computed', cell: (r) => fmtDate(r.computedAt) },
    { key: 'overall', header: 'Score', align: 'right', cell: (r) => <span className="font-semibold">{r.overall}</span> },
    { key: 'band', header: 'Band', cell: (r) => <Badge tone={BAND_TONE[r.band] ?? 'neutral'}>{bandLabel(r.band)}</Badge> },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <a href={`/app/households/${id}`} className="text-sm text-primary hover:underline">
          ◂ Back to household
        </a>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Heading level={1}>Financial health</Heading>
          <Badge tone="primary">{base}</Badge>
        </div>
        <Text muted>{household.name} · an explainable score derived from the latest Financial Snapshot</Text>
      </div>

      {!score.available ? (
        <EmptyState
          title="No Financial Snapshot yet"
          description="Capture a Financial Snapshot first — the health score is derived from it."
          action={{ label: 'Go to Financial Snapshot', onClick: () => (window.location.href = `/app/households/${id}/financial-snapshot`) }}
        />
      ) : (
        <>
          {/* Overall */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex h-24 w-24 flex-col items-center justify-center rounded-full border-4 border-primary">
                  <span className="text-3xl font-bold">{score.overall}</span>
                  <span className="text-xs text-subtle">/ 100</span>
                </div>
                <div>
                  <Badge tone={BAND_TONE[score.band ?? ''] ?? 'neutral'}>{bandLabel(score.band ?? '')}</Badge>
                  <Text muted className="mt-1 text-xs">
                    Model {score.scoreModelVersion} · from snapshot {score.snapshotId?.slice(0, 8)}…
                    {score.drivers && (
                      <>
                        {' '}· strongest: {bandLabel(score.drivers.top[0] ?? '—')} · weakest:{' '}
                        {bandLabel(score.drivers.weakest[0] ?? '—')}
                      </>
                    )}
                  </Text>
                </div>
              </div>
              {canWrite && (
                <Button size="sm" loading={saving} leftIcon={<IconPlus className="h-4 w-4" />} onClick={persist}>
                  Save score
                </Button>
              )}
            </CardHeader>
          </Card>

          {/* Category breakdown */}
          <Card flush>
            <CardHeader className="p-6 pb-0">
              <div>
                <CardTitle>Category breakdown</CardTitle>
                <CardDescription>Each sub-score is explainable and traceable to a snapshot metric.</CardDescription>
              </div>
            </CardHeader>
            <div className="p-2">
              <DataTable columns={categoryColumns} data={score.categories ?? []} rowKey={(c) => c.key} />
            </div>
          </Card>

          {/* Why this score & recommendations (M3-2 explanation engine) */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Why this score & recommendations</CardTitle>
                <CardDescription>
                  {explanation
                    ? explanation.summary
                    : 'Concrete next steps to improve the score.'}
                </CardDescription>
              </div>
              {explanation && explanation.potentialScoreImprovement > 0 && (
                <Badge tone="primary">
                  +{explanation.potentialScoreImprovement} potential → {explanation.potentialOverall}
                </Badge>
              )}
            </CardHeader>
            <div className="px-6 pb-6">
              {explanation && explanation.recommendations.length > 0 ? (
                <ol className="space-y-3">
                  {explanation.recommendations.map((r) => (
                    <li key={r.id} className="rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={r.priority === 'high' ? 'danger' : r.priority === 'medium' ? 'warning' : 'neutral'}>
                          {r.priority} priority
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
              ) : (
                <ul className="list-inside list-disc space-y-1 text-sm">
                  {(score.categories ?? [])
                    .filter((c) => c.score < 90)
                    .map((c) => (
                      <li key={c.key}>
                        <span className="font-medium">{c.label}:</span> {c.suggestion}
                      </li>
                    ))}
                </ul>
              )}
              {explanation && explanation.confidence < 1 && (
                <Text muted className="mt-3 text-xs">
                  Confidence {Math.round(explanation.confidence * 100)}% — some snapshot data is incomplete
                  ({explanation.reasonCodes.filter((c) => c.startsWith('NO_')).join(', ') || 'partial data'}).
                </Text>
              )}
            </div>
          </Card>
        </>
      )}

      {/* History */}
      <Card flush>
        <CardHeader className="p-6 pb-0">
          <div>
            <CardTitle>Score history</CardTitle>
            <CardDescription>Saved scores over time (newest first).</CardDescription>
          </div>
          <IconChart className="h-5 w-5 text-subtle" />
        </CardHeader>
        <div className="p-2">
          {timeline.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No saved scores yet" description="Save a score to start the history." />
            </div>
          ) : (
            <DataTable columns={timelineColumns} data={[...timeline].reverse()} rowKey={(r) => r.id} />
          )}
        </div>
      </Card>
    </div>
  );
}
