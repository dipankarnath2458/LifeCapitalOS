'use client';

import { useEffect, useState } from 'react';
import { adminGet, adminSend } from '@/lib/api';

interface Plan {
  id: string;
  tier: string;
  name: string;
  priceMinor: number;
  active: boolean;
}

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);

  async function load() {
    setPlans(await adminGet<Plan[]>('/admin/plans'));
  }

  useEffect(() => {
    void load();
  }, []);

  async function savePrice(p: Plan, rupees: number) {
    await adminSend(`/admin/plans/${p.id}`, 'PUT', { priceMinor: Math.round(rupees * 100) });
    await load();
  }

  async function toggleActive(p: Plan) {
    await adminSend(`/admin/plans/${p.id}`, 'PUT', { active: !p.active });
    await load();
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Plans &amp; Billing</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        {plans.map((p) => (
          <div key={p.id} className="rounded-2xl bg-white p-6 shadow">
            <div className="mb-1 text-lg font-semibold">{p.name}</div>
            <div className="mb-4 text-sm text-slate-500">{p.tier}</div>
            <label className="text-sm text-slate-600">Price (₹/mo)</label>
            <input
              type="number"
              defaultValue={p.priceMinor / 100}
              onBlur={(e) => savePrice(p, Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            />
            <button
              onClick={() => toggleActive(p)}
              className={`mt-4 w-full rounded-lg px-3 py-2 text-sm ${
                p.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {p.active ? 'Active' : 'Inactive'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
