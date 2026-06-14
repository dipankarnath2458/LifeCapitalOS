'use client';

import { useEffect, useState } from 'react';
import { adminGet } from '@/lib/admin';
import { useToast } from '@/components/Toast';
import { Skeleton } from '@/components/Skeleton';

interface Metrics {
  totalUsers: number;
  activeUsers: number;
  paidSubscriptions: number;
  monthlyActiveUsers: number;
  conversionRate: number;
}

export default function Overview() {
  const [m, setM] = useState<Metrics | null>(null);
  const toast = useToast();

  useEffect(() => {
    adminGet<Metrics>('/admin/metrics')
      .then(setM)
      .catch(() => toast.error('Could not load metrics.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Overview</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="Total users" value={m?.totalUsers} loading={!m} />
        <Card label="Active users" value={m?.activeUsers} loading={!m} />
        <Card label="Paid subscriptions" value={m?.paidSubscriptions} loading={!m} />
        <Card label="MAU (30d)" value={m?.monthlyActiveUsers} loading={!m} />
        <Card label="Conversion" value={m ? `${(m.conversionRate * 100).toFixed(1)}%` : undefined} loading={!m} />
      </div>
    </div>
  );
}

function Card({ label, value, loading }: { label: string; value?: number | string; loading?: boolean }) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow">
      <div className="text-sm text-slate-500">{label}</div>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-20" />
      ) : (
        <div className="mt-1 text-3xl font-bold text-brand">{value ?? '—'}</div>
      )}
    </div>
  );
}
