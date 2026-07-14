'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { useApp } from '@/lib/appContext';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  StatCard,
  Badge,
  Button,
  Heading,
  Text,
  LoadingState,
  ErrorState,
} from '@/ui';
import { IconUsers, IconHome, IconChart } from '@/ui/icons';

interface Household {
  id: string;
  name: string;
  advisorId: string | null;
  baseCurrency: string;
  status: string;
}

// Tabs that arrive in later milestones (M2+). Shown here as a disabled roadmap so the
// detail shell reflects the target information architecture (doc 03 §2.2). "Balance
// sheet" (M2-7) and "Cashflow" (M2-4) are live and rendered as links, so they are not
// in this list.
const UPCOMING_TABS = [
  'Goals',
  'Scores',
  'Allocation',
  'Protection',
  'Documents',
  'Tasks',
  'AI analysis',
];

export default function HouseholdDetailPage() {
  const { token } = useApp();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [household, setHousehold] = useState<Household | null>(null);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [entityCount, setEntityCount] = useState<number | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!id) return;
    apiGet<Household>(`/households/${id}`, token)
      .then((h) => {
        setHousehold(h);
        void apiGet<unknown[]>(`/households/${id}/members`, token)
          .then((m) => setMemberCount(m.length))
          .catch(() => setMemberCount(null));
        void apiGet<unknown[]>(`/households/${id}/entities`, token)
          .then((e) => setEntityCount(e.length))
          .catch(() => setEntityCount(null));
      })
      .catch(() => setError(true));
  }, [id, token]);

  if (error) {
    return (
      <div className="mx-auto max-w-4xl">
        <a href="/app/households" className="text-sm text-primary hover:underline">
          ◂ Back to households
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

  if (!household) {
    return (
      <div className="mx-auto max-w-4xl py-16">
        <LoadingState label="Loading household…" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <a href="/app/households" className="text-sm text-primary hover:underline">
          ◂ Back to households
        </a>
        <div className="mt-2 flex items-center gap-3">
          <Heading level={1}>{household.name}</Heading>
          <Badge tone={household.status === 'active' ? 'success' : 'neutral'}>
            {household.status}
          </Badge>
        </div>
        <Text muted>
          Base currency {household.baseCurrency} ·{' '}
          {household.advisorId ? 'Advisor assigned' : 'Unassigned'}
        </Text>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Members"
          value={memberCount ?? '—'}
          icon={<IconUsers className="h-6 w-6" />}
        />
        <StatCard
          label="Legal entities"
          value={entityCount ?? '—'}
          icon={<IconHome className="h-6 w-6" />}
        />
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Overview</CardTitle>
            <CardDescription>
              The household record. Wealth, planning, documents and AI tabs arrive in later
              milestones.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              leftIcon={<IconChart className="h-4 w-4" />}
              onClick={() => (window.location.href = `/app/households/${id}/balance-sheet`)}
            >
              Balance sheet
            </Button>
            <Button
              variant="outline"
              size="sm"
              leftIcon={<IconChart className="h-4 w-4" />}
              onClick={() => (window.location.href = `/app/households/${id}/cashflow`)}
            >
              Cashflow
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Badge tone="primary">Overview</Badge>
            <Badge tone="success">Balance sheet</Badge>
            <Badge tone="success">Cashflow</Badge>
            {UPCOMING_TABS.map((t) => (
              <Badge key={t} variant="outline">
                {t} · soon
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
