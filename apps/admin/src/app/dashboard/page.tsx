'use client';

import { useEffect, useState } from 'react';
import { adminGet } from '@/lib/api';

interface Metrics {
  totalUsers: number;
  activeUsers: number;
  paidSubscriptions: number;
  monthlyActiveUsers: number;
  conversionRate: number;
}

export default function Overview() {
  const [m, setM] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminGet<Metrics>('/admin/metrics').then(setM).catch(() => setError('Could not load metrics'));
  }, []);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Overview</h1>
      {error && <p className="text-rose-600">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="Total users" value={m?.totalUsers} />
        <Card label="Active users" value={m?.activeUsers} />
        <Card label="Paid subscriptions" value={m?.paidSubscriptions} />
        <Card label="MAU (30d)" value={m?.monthlyActiveUsers} />
        <Card
          label="Conversion"
          value={m ? `${(m.conversionRate * 100).toFixed(1)}%` : undefined}
        />
      </div>
    </div>
  );
}

function Card({ label, value }: { label: string; value?: number | string }) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-3xl font-bold text-brand">{value ?? '—'}</div>
    </div>
  );
}
