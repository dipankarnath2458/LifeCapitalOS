'use client';

import { useEffect, useState } from 'react';
import { adminGet, adminSend } from '@/lib/admin';
import { useToast } from '@/components/Toast';

interface Plan {
  id: string;
  tier: string;
  name: string;
  priceMinor: number;
  active: boolean;
  features: string[];
}

const featureLabel = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [allFeatures, setAllFeatures] = useState<string[]>([]);
  const toast = useToast();

  async function load() {
    const [p, f] = await Promise.all([
      adminGet<Plan[]>('/admin/plans'),
      adminGet<string[]>('/admin/features'),
    ]);
    setPlans(p);
    setAllFeatures(f);
  }

  useEffect(() => {
    void load();
  }, []);

  async function savePrice(p: Plan, rupees: number) {
    if (Math.round(rupees * 100) === p.priceMinor) return;
    try {
      await adminSend(`/admin/plans/${p.id}`, 'PUT', { priceMinor: Math.round(rupees * 100) });
      toast.success(`${p.name} price updated.`);
      await load();
    } catch {
      toast.error('Could not update the price.');
    }
  }

  async function saveName(p: Plan, name: string) {
    if (name.trim() === p.name || !name.trim()) return;
    try {
      await adminSend(`/admin/plans/${p.id}`, 'PUT', { name: name.trim() });
      toast.success('Plan name updated.');
      await load();
    } catch {
      toast.error('Could not update the name.');
    }
  }

  async function toggleActive(p: Plan) {
    try {
      await adminSend(`/admin/plans/${p.id}`, 'PUT', { active: !p.active });
      toast.success(`${p.name} ${p.active ? 'deactivated' : 'activated'}.`);
      await load();
    } catch {
      toast.error('Could not update the plan.');
    }
  }

  async function toggleFeature(p: Plan, feature: string) {
    const has = p.features.includes(feature);
    const features = has ? p.features.filter((f) => f !== feature) : [...p.features, feature];
    try {
      await adminSend(`/admin/plans/${p.id}`, 'PUT', { features });
      toast.success(`${featureLabel(feature)} ${has ? 'removed from' : 'added to'} ${p.name}.`);
      await load();
    } catch {
      toast.error('Could not update plan features.');
    }
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">Plans &amp; Billing</h1>
      <p className="mb-6 text-sm text-slate-500">
        Features assigned here drive access. Higher tiers inherit lower-tier features.
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        {plans.map((p) => (
          <div key={p.id} className="rounded-2xl bg-white p-6 shadow">
            <label className="text-sm text-slate-600">Name</label>
            <input
              defaultValue={p.name}
              onBlur={(e) => saveName(p, e.target.value)}
              className="mb-2 mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-semibold"
            />
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

            <div className="mt-4 border-t border-slate-100 pt-4">
              <div className="mb-2 text-sm font-medium text-slate-600">Features granted by this tier</div>
              <ul className="space-y-1">
                {allFeatures.map((f) => (
                  <li key={f}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={p.features.includes(f)}
                        onChange={() => toggleFeature(p, f)}
                      />
                      <span>{featureLabel(f)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
