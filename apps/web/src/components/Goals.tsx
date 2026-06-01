'use client';

import { useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPost } from '@/lib/api';

interface GoalPlan {
  monthlySipRequired: { minor: number };
  gap: { minor: number };
  progress: number;
}
interface Goal {
  id: string;
  name: string;
  type: string;
  targetAmountMinor: number;
  currentAmountMinor: number;
  targetDate: string;
  plan: GoalPlan;
}

const GOAL_TYPES = [
  'retirement',
  'child_education',
  'child_marriage',
  'home_purchase',
  'emergency_fund',
  'travel',
  'custom',
] as const;

const inr = (minor: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
    minor / 100,
  );

/** Goal Planning Engine — create goals and see the monthly SIP each requires. */
export function Goals({ token }: { token: string }) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'retirement', target: '', current: '', years: '10' });

  async function load() {
    setGoals(await apiGet<Goal[]>('/goals', token));
  }
  useEffect(() => {
    load().catch(() => {});
  }, [token]);

  async function add() {
    if (!form.name || !form.target) return;
    const targetDate = new Date();
    targetDate.setFullYear(targetDate.getFullYear() + (parseInt(form.years, 10) || 1));
    await apiPost(
      '/goals',
      {
        name: form.name,
        type: form.type,
        targetAmountMinor: Math.round(parseFloat(form.target) * 100),
        currentAmountMinor: Math.round(parseFloat(form.current || '0') * 100),
        targetDate: targetDate.toISOString(),
      },
      token,
    );
    setForm({ name: '', type: 'retirement', target: '', current: '', years: '10' });
    setOpen(false);
    await load();
  }

  async function remove(id: string) {
    await apiDelete(`/goals/${id}`, token);
    await load();
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Goals</h2>
        <button onClick={() => setOpen((o) => !o)} className="rounded-lg bg-brand px-3 py-2 text-sm text-white">
          {open ? 'Cancel' : '+ Add goal'}
        </button>
      </div>

      {open && (
        <div className="mb-4 grid gap-2 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
          <input
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="Goal name (e.g. Riya's college)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <select
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          >
            {GOAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <input
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="Target amount (₹)"
            value={form.target}
            onChange={(e) => setForm({ ...form, target: e.target.value })}
          />
          <input
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="Saved so far (₹)"
            value={form.current}
            onChange={(e) => setForm({ ...form, current: e.target.value })}
          />
          <input
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="Years to goal"
            value={form.years}
            onChange={(e) => setForm({ ...form, years: e.target.value })}
          />
          <button onClick={add} className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white">
            Save goal
          </button>
        </div>
      )}

      {goals.length === 0 ? (
        <p className="text-slate-500">No goals yet. Add one to see the monthly SIP it needs.</p>
      ) : (
        <ul className="space-y-3">
          {goals.map((g) => (
            <li key={g.id} className="rounded-xl border border-slate-100 p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{g.name}</span>
                <button onClick={() => remove(g.id)} className="text-xs text-slate-400 hover:text-rose-600">
                  Remove
                </button>
              </div>
              <div className="mt-2 flex h-2 overflow-hidden rounded bg-slate-100">
                <div className="bg-brand" style={{ width: `${Math.round((g.plan.progress ?? 0) * 100)}%` }} />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                <span>Target {inr(g.targetAmountMinor)}</span>
                <span className="font-medium text-brand">
                  SIP {inr(g.plan.monthlySipRequired.minor)}/mo
                </span>
                {g.plan.gap.minor > 0 && <span>Gap {inr(g.plan.gap.minor)}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
