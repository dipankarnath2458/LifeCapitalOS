'use client';

import { Card, CardHeader, CardTitle, CardDescription, Button } from '@/ui';
import { IconChart, IconWallet, IconTarget, IconPlus } from '@/ui/icons';

/** Section 3 — LIVE quick actions: navigation to existing household flows. */
export function QuickActions({ householdId }: { householdId: string }) {
  const go = (path: string) => () => {
    window.location.href = `/app/households/${householdId}${path}`;
  };
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Quick actions</CardTitle>
          <CardDescription>Jump into this family's tools.</CardDescription>
        </div>
      </CardHeader>
      <div className="flex flex-wrap gap-2 px-6 pb-6">
        <Button variant="outline" size="sm" leftIcon={<IconPlus className="h-4 w-4" />} onClick={go('/financial-snapshot')}>
          Capture snapshot
        </Button>
        <Button variant="outline" size="sm" leftIcon={<IconTarget className="h-4 w-4" />} onClick={go('/simulation')}>
          Run what-if
        </Button>
        <Button variant="outline" size="sm" leftIcon={<IconChart className="h-4 w-4" />} onClick={go('/health-score')}>
          Financial health
        </Button>
        <Button variant="outline" size="sm" leftIcon={<IconWallet className="h-4 w-4" />} onClick={go('/balance-sheet')}>
          Balance sheet
        </Button>
        <Button variant="outline" size="sm" leftIcon={<IconChart className="h-4 w-4" />} onClick={go('/cashflow')}>
          Cashflow
        </Button>
      </div>
    </Card>
  );
}
