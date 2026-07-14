'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { useApp } from '@/lib/appContext';
import {
  Card,
  CardHeader,
  CardTitle,
  StatCard,
  DataTable,
  Badge,
  Button,
  Heading,
  Text,
  ErrorState,
  type Column,
} from '@/ui';
import { IconUsers, IconAlert, IconInbox } from '@/ui/icons';

interface HouseholdRow {
  id: string;
  name: string;
  baseCurrency: string;
  status: string;
}
interface HouseholdList {
  total: number;
  data: HouseholdRow[];
}

export default function BookOverviewPage() {
  const { token, firm } = useApp();
  const [list, setList] = useState<HouseholdList | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    apiGet<HouseholdList>('/households?take=5', token)
      .then(setList)
      .catch(() => setError(true));
  }, [token]);

  const columns: Column<HouseholdRow>[] = [
    { key: 'name', header: 'Household', cell: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'currency', header: 'Base currency', cell: (r) => r.baseCurrency },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => <Badge tone={r.status === 'active' ? 'success' : 'neutral'}>{r.status}</Badge>,
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Heading level={1}>Book overview</Heading>
        <Text muted>{firm.brandName ?? firm.name}</Text>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Households"
          value={list ? list.total : '—'}
          icon={<IconUsers className="h-6 w-6" />}
        />
        <StatCard label="At risk" value="—" hint="Coming in M3" icon={<IconAlert className="h-6 w-6" />} />
        <StatCard label="Tasks due" value="—" hint="Coming in M6" icon={<IconInbox className="h-6 w-6" />} />
      </div>

      <Card flush>
        <CardHeader className="p-6 pb-0">
          <CardTitle>Recent households</CardTitle>
          <Button variant="outline" size="sm" onClick={() => (window.location.href = '/app/households')}>
            View all
          </Button>
        </CardHeader>
        {error ? (
          <div className="p-6">
            <ErrorState title="Couldn't load households" description="Please try again." />
          </div>
        ) : (
          <div className="p-2">
            <DataTable
              columns={columns}
              data={list?.data ?? []}
              rowKey={(r) => r.id}
              loading={!list}
              empty="No households yet. Create one from the Households page."
              onRowClick={(r) => (window.location.href = `/app/households/${r.id}`)}
            />
          </div>
        )}
      </Card>
    </div>
  );
}
