'use client';

import { Card, CardContent, Badge, Heading, Text } from '@/ui';
import { IconUsers, IconHome } from '@/ui/icons';

export interface FamilySummary {
  name: string;
  baseCurrency: string;
  status: string;
  advisorAssigned: boolean;
  memberCount: number | null;
  entityCount: number | null;
  lastUpdated: string | null;
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

/** Section 1 header card — who this family is + when the data was last captured. */
export function FamilySummaryCard({ summary }: { summary: FamilySummary }) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Heading level={2}>{summary.name}</Heading>
            <Badge tone={summary.status === 'active' ? 'success' : 'neutral'}>{summary.status}</Badge>
            <Badge tone="primary">{summary.baseCurrency}</Badge>
          </div>
          <Text muted className="mt-1 text-sm">
            {summary.advisorAssigned ? 'Advisor assigned' : 'Unassigned'} ·{' '}
            {summary.lastUpdated ? `Last updated ${fmtDate(summary.lastUpdated)}` : 'No snapshot captured yet'}
          </Text>
        </div>
        <div className="flex gap-6">
          <div className="flex items-center gap-2">
            <IconUsers className="h-5 w-5 text-subtle" aria-hidden />
            <div>
              <div className="text-lg font-semibold">{summary.memberCount ?? '—'}</div>
              <Text muted className="text-xs">
                Members
              </Text>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <IconHome className="h-5 w-5 text-subtle" aria-hidden />
            <div>
              <div className="text-lg font-semibold">{summary.entityCount ?? '—'}</div>
              <Text muted className="text-xs">
                Entities
              </Text>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
