'use client';

import { useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPost } from '@/lib/api';

interface Member {
  id: string;
  name: string;
  relation: string;
  isDependent: boolean;
}

const RELATIONS = ['spouse', 'child', 'parent', 'sibling', 'other'];

/** Family members — the basis for a true Family Balance Sheet & Family CFO view. */
export function Family({ token }: { token: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [form, setForm] = useState({ name: '', relation: 'spouse', isDependent: true });

  async function load() {
    setMembers(await apiGet<Member[]>('/family', token));
  }
  useEffect(() => {
    load().catch(() => {});
  }, [token]);

  async function add() {
    if (!form.name) return;
    await apiPost('/family', form, token);
    setForm({ name: '', relation: 'spouse', isDependent: true });
    await load();
  }

  async function remove(id: string) {
    await apiDelete(`/family/${id}`, token);
    await load();
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow">
      <h2 className="mb-1 text-lg font-semibold">Your Family</h2>
      <p className="mb-4 text-sm text-slate-500">Who are you planning for? This powers protection and legacy planning.</p>

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          placeholder="Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <select
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          value={form.relation}
          onChange={(e) => setForm({ ...form, relation: e.target.value })}
        >
          {RELATIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={form.isDependent}
            onChange={(e) => setForm({ ...form, isDependent: e.target.checked })}
          />
          dependent
        </label>
        <button onClick={add} className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white">
          Add
        </button>
      </div>

      {members.length === 0 ? (
        <p className="text-slate-500">No family members added yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between py-2.5">
              <span>
                {m.name} <span className="text-sm text-slate-400">· {m.relation}</span>
                {m.isDependent && (
                  <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">dependent</span>
                )}
              </span>
              <button onClick={() => remove(m.id)} className="text-xs text-slate-400 hover:text-rose-600">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
