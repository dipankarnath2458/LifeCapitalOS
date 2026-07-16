'use client';

import { Card, CardHeader, CardTitle, CardDescription, EmptyState, Badge } from '@/ui';

export interface ActivityItem {
  id: string;
  kind: 'snapshot' | 'score';
  label: string;
  at: string;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Section 3 — LIVE recent activity composed from existing household timelines. */
export function RecentActivity({ items }: { items: ActivityItem[] }) {
  return (
    <Card flush>
      <CardHeader className="p-6 pb-0">
        <div>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>Latest captures and saved scores for this family.</CardDescription>
        </div>
      </CardHeader>
      <div className="p-4">
        {items.length === 0 ? (
          <EmptyState title="No recent activity" description="Captured snapshots and saved scores will appear here." />
        ) : (
          <ul className="divide-y divide-border">
            {items.slice(0, 8).map((it) => (
              <li key={it.id} className="flex items-center justify-between gap-3 py-2">
                <div className="flex items-center gap-2">
                  <Badge tone={it.kind === 'snapshot' ? 'primary' : 'success'} variant="outline">
                    {it.kind === 'snapshot' ? 'Snapshot' : 'Score'}
                  </Badge>
                  <span className="text-sm">{it.label}</span>
                </div>
                <span className="text-xs text-subtle">{fmtTime(it.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
