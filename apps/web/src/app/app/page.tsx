'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { useApp } from '@/lib/appContext';
import { useCurrentHousehold } from '@/lib/useCurrentHousehold';
import {
  Card,
  CardContent,
  Badge,
  Heading,
  Text,
  EmptyState,
  ErrorState,
  LoadingState,
  type BadgeTone,
} from '@/ui';
import { IconChart, IconWallet, IconTarget, IconShield, IconAlert } from '@/ui/icons';
import { HouseholdSelector } from '@/components/dashboard/HouseholdSelector';
import { FamilySummaryCard, type FamilySummary } from '@/components/dashboard/FamilySummaryCard';
import { NetWorthCard, type NetWorth } from '@/components/dashboard/NetWorthCard';
import { ScoreCard } from '@/components/dashboard/ScoreCard';
import { RecentActivity, type ActivityItem } from '@/components/dashboard/RecentActivity';
import { QuickActions } from '@/components/dashboard/QuickActions';
import { AiCfoPanel } from '@/components/dashboard/AiCfoPanel';

interface SnapshotRow {
  id: string;
  capturedAt: string;
}
interface ScoreRow {
  id: string;
  overall: number;
  computedAt: string;
}

type Light = 'green' | 'yellow' | 'red';

/**
 * Minimal view of the M5 `GET /households/:id/intelligence/current` response — only the
 * fields the dashboard reads. The Financial Intelligence Layer composes these from the
 * immutable snapshot; the dashboard is a read-only consumer (never recomputes).
 */
interface Intelligence {
  available: boolean;
  wealthHealth?: { available: boolean; data?: { overall: number; band: string; category: string } };
  emergencyFund?: { available: boolean; data?: { monthsCovered: number; status: Light } };
  assetAllocation?: {
    available: boolean;
    data?: { topConcentration: { assetClass: string; pct: number } | null; concentrationRisk: Light };
  };
  retirement?: { available: boolean; data?: { readinessPct: number; onTrack: boolean } };
  insurance?: { available: boolean; data?: { adequate: boolean; status: Light } };
  risk?: { available: boolean; data?: { overall: Light; redCount: number; yellowCount: number } };
}

const lightTone = (l: Light): BadgeTone => (l === 'green' ? 'success' : l === 'yellow' ? 'warning' : 'danger');
const lightWord = (l: Light): string => (l === 'green' ? 'Healthy' : l === 'yellow' ? 'Watch' : 'Action');
const bandToneOf = (b: string): BadgeTone =>
  b === 'excellent' || b === 'good' ? 'success' : b === 'fair' || b === 'needs_attention' ? 'warning' : 'danger';

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold uppercase tracking-wide text-subtle">{children}</div>
  );
}

export default function DashboardPage() {
  const { token, firm } = useApp();
  const { households, selected, selectedId, setSelectedId, error } = useCurrentHousehold(token);

  const [netWorth, setNetWorth] = useState<NetWorth | null>(null);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [entityCount, setEntityCount] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [intel, setIntel] = useState<Intelligence | null>(null);
  const [loadingFamily, setLoadingFamily] = useState(false);

  useEffect(() => {
    if (!selectedId) return;
    setLoadingFamily(true);
    setNetWorth(null);
    setMemberCount(null);
    setEntityCount(null);
    setLastUpdated(null);
    setActivity([]);
    setIntel(null);

    const id = selectedId;
    Promise.allSettled([
      apiGet<NetWorth>(`/households/${id}/net-worth/current`, token),
      apiGet<unknown[]>(`/households/${id}/members`, token),
      apiGet<unknown[]>(`/households/${id}/entities`, token),
      apiGet<SnapshotRow[]>(`/households/${id}/financial-snapshot/timeline`, token),
      apiGet<ScoreRow[]>(`/households/${id}/health-score/timeline`, token),
      apiGet<Intelligence>(`/households/${id}/intelligence/current`, token),
    ]).then(([nw, members, entities, snaps, scores, intelligence]) => {
      if (nw.status === 'fulfilled') setNetWorth(nw.value);
      if (members.status === 'fulfilled') setMemberCount(members.value.length);
      if (entities.status === 'fulfilled') setEntityCount(entities.value.length);
      if (intelligence.status === 'fulfilled') setIntel(intelligence.value);

      const snapRows = snaps.status === 'fulfilled' ? snaps.value : [];
      const scoreRows = scores.status === 'fulfilled' ? scores.value : [];
      const latestSnap = snapRows.at(-1);
      setLastUpdated(latestSnap?.capturedAt ?? null);

      const items: ActivityItem[] = [
        ...snapRows.map((s) => ({
          id: `snap_${s.id}`,
          kind: 'snapshot' as const,
          label: 'Financial snapshot captured',
          at: s.capturedAt,
        })),
        ...scoreRows.map((s) => ({
          id: `score_${s.id}`,
          kind: 'score' as const,
          label: `Health score saved (${s.overall}/100)`,
          at: s.computedAt,
        })),
      ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
      setActivity(items);
      setLoadingFamily(false);
    });
  }, [selectedId, token]);

  if (error) {
    return (
      <div className="mx-auto max-w-5xl py-16">
        <ErrorState title="Couldn't load your families" description="Please try again." />
      </div>
    );
  }

  if (households === null) {
    return (
      <div className="mx-auto max-w-5xl py-16">
        <LoadingState label="Loading dashboard…" />
      </div>
    );
  }

  if (households.length === 0) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <Heading level={1}>Wealth Health Check</Heading>
        <EmptyState
          title="No families yet"
          description="Create a household to see its Wealth Health Check."
          action={{ label: 'Go to households', onClick: () => (window.location.href = '/app/households') }}
        />
      </div>
    );
  }

  const familySummary: FamilySummary | null = selected
    ? {
        name: selected.name,
        baseCurrency: selected.baseCurrency,
        status: selected.status,
        advisorAssigned: true,
        memberCount,
        entityCount,
        lastUpdated,
      }
    : null;

  // Live Financial Intelligence (M5): each section is used only when the endpoint returned
  // an object AND that section is available; otherwise the card falls back to its placeholder.
  const iOk = intel?.available === true;
  const wh = iOk && intel?.wealthHealth?.available ? intel.wealthHealth.data ?? null : null;
  const ef = iOk && intel?.emergencyFund?.available ? intel.emergencyFund.data ?? null : null;
  const alloc = iOk && intel?.assetAllocation?.available ? intel.assetAllocation.data ?? null : null;
  const ret = iOk && intel?.retirement?.available ? intel.retirement.data ?? null : null;
  const ins = iOk && intel?.insurance?.available ? intel.insurance.data ?? null : null;
  const risk = iOk && intel?.risk?.available ? intel.risk.data ?? null : null;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Heading level={1}>Wealth Health Check</Heading>
          <Text muted>
            {firm.brandName ?? firm.name} · how financially healthy is your family?
          </Text>
        </div>
        <HouseholdSelector households={households} selectedId={selectedId} onChange={setSelectedId} />
      </div>

      {/* SECTION 1 — Executive summary */}
      <section className="space-y-3">
        <SectionLabel>Executive summary</SectionLabel>
        {familySummary && <FamilySummaryCard summary={familySummary} />}
        <div className="grid gap-4 sm:grid-cols-3">
          <NetWorthCard netWorth={loadingFamily ? null : netWorth} />
          {wh ? (
            <ScoreCard
              title="Wealth Health Score™"
              icon={<IconChart className="h-4 w-4" />}
              status="live"
              value={wh.overall}
              unit="/ 100"
              band={wh.category}
              bandTone={bandToneOf(wh.band)}
              hint="Composed by the Financial Intelligence Layer from your latest snapshot."
            />
          ) : (
            <ScoreCard
              title="Wealth Health Score™"
              icon={<IconChart className="h-4 w-4" />}
              unit="/ 100"
              description="Capture a Financial Snapshot to see your family's overall health score."
            />
          )}
          <Card>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Financial health category</span>
                {wh ? (
                  <Badge tone={bandToneOf(wh.band)}>{wh.category}</Badge>
                ) : (
                  <Badge tone="neutral" variant="outline">
                    Coming soon
                  </Badge>
                )}
              </div>
              <div className={`text-2xl font-semibold ${wh ? 'text-foreground' : 'text-subtle/40'}`}>
                {wh ? wh.category : 'Pending'}
              </div>
              <Text muted className="text-xs">
                Excellent · Good · Fair · Needs attention · At risk — assigned from your snapshot.
              </Text>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* SECTION 2 — Capital health */}
      <section className="space-y-3">
        <SectionLabel>Capital health</SectionLabel>
        <Text muted className="text-sm">
          Live insights composed by the Financial Intelligence Layer; dedicated 0–100 scores plug
          into these same cards as each engine ships — no layout change.
        </Text>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {alloc && alloc.topConcentration ? (
            <ScoreCard
              title="Asset Allocation"
              icon={<IconChart className="h-4 w-4" />}
              status="live"
              value={`${Math.round(alloc.topConcentration.pct)}%`}
              unit={alloc.topConcentration.assetClass}
              band={alloc.concentrationRisk === 'green' ? 'Diversified' : 'Concentrated'}
              bandTone={lightTone(alloc.concentrationRisk)}
              hint="Largest single asset-class weight."
            />
          ) : (
            <ScoreCard title="Asset Allocation" icon={<IconChart className="h-4 w-4" />} />
          )}

          {risk ? (
            <ScoreCard
              title="Risk Score"
              icon={<IconAlert className="h-4 w-4" />}
              status="live"
              value={risk.redCount + risk.yellowCount}
              unit="alerts"
              band={lightWord(risk.overall)}
              bandTone={lightTone(risk.overall)}
              hint={`${risk.redCount} red · ${risk.yellowCount} amber early-warning signals.`}
            />
          ) : (
            <ScoreCard title="Risk Score" icon={<IconAlert className="h-4 w-4" />} />
          )}

          {ef ? (
            <ScoreCard
              title="Emergency Fund"
              icon={<IconWallet className="h-4 w-4" />}
              status="live"
              value={ef.monthsCovered}
              unit="months"
              band={lightWord(ef.status)}
              bandTone={lightTone(ef.status)}
              hint="Cash cover vs a 6-month target."
            />
          ) : (
            <ScoreCard title="Emergency Fund" icon={<IconWallet className="h-4 w-4" />} />
          )}

          {ret ? (
            <ScoreCard
              title="Retirement"
              icon={<IconTarget className="h-4 w-4" />}
              status="live"
              value={ret.readinessPct}
              unit="% ready"
              band={ret.onTrack ? 'On track' : 'Gap'}
              bandTone={ret.onTrack ? 'success' : 'warning'}
              hint="Projected corpus vs the amount required."
            />
          ) : (
            <ScoreCard title="Retirement" icon={<IconTarget className="h-4 w-4" />} />
          )}

          {ins ? (
            <ScoreCard
              title="Insurance"
              icon={<IconShield className="h-4 w-4" />}
              status="live"
              value={ins.adequate ? 'Adequate' : 'Gap'}
              band={lightWord(ins.status)}
              bandTone={lightTone(ins.status)}
              hint="Life cover vs recommended protection."
            />
          ) : (
            <ScoreCard title="Insurance" icon={<IconShield className="h-4 w-4" />} />
          )}
        </div>
      </section>

      {/* SECTION 3 — AI guidance */}
      <section className="space-y-3">
        <SectionLabel>AI guidance</SectionLabel>
        <AiCfoPanel />
        <div className="grid gap-4 lg:grid-cols-2">
          <RecentActivity items={activity} />
          {selected && <QuickActions householdId={selected.id} />}
        </div>
      </section>
    </div>
  );
}
