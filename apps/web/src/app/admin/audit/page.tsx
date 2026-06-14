'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminGet } from '@/lib/admin';
import { useToast } from '@/components/Toast';
import { Pager } from '@/components/Pager';

interface AuditRow {
  id: string;
  action: string;
  actorId: string | null;
  actorRole: string | null;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
}

const TAKE = 50;

export default function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [action, setAction] = useState('');
  const toast = useToast();

  const load = useCallback(
    async (nextSkip = 0, nextAction = action) => {
      try {
        const q = new URLSearchParams({ skip: String(nextSkip), take: String(TAKE) });
        if (nextAction) q.set('action', nextAction);
        const res = await adminGet<{ total: number; data: AuditRow[] }>(`/admin/audit?${q.toString()}`);
        setRows(res.data);
        setTotal(res.total);
        setSkip(nextSkip);
      } catch {
        toast.error('Could not load the audit log.');
      }
    },
    [action, toast],
  );

  useEffect(() => {
    void load(0, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Audit Log</h1>
      <div className="mb-4 flex gap-2">
        <input
          value={action}
          onChange={(e) => setAction(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load(0, action)}
          placeholder="Filter by action (e.g. user.password_changed)"
          aria-label="Filter audit log by action"
          className="w-80 rounded-lg border border-slate-200 px-3 py-2"
        />
        <button onClick={() => load(0, action)} className="rounded-lg bg-brand px-4 py-2 text-white">
          Filter
        </button>
      </div>
      <div className="overflow-x-auto rounded-2xl bg-white shadow">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="p-3">When</th>
              <th className="p-3">Action</th>
              <th className="p-3">Actor</th>
              <th className="p-3">Entity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="p-3 text-slate-500">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="p-3 font-medium">{r.action}</td>
                <td className="p-3">{r.actorRole ?? '—'}</td>
                <td className="p-3 text-slate-500">
                  {r.entityType ? `${r.entityType}:${r.entityId?.slice(0, 8)}` : '—'}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="p-4 text-slate-500" colSpan={4}>
                  No audit entries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pager skip={skip} take={TAKE} total={total} onChange={(s) => load(s)} />
      </div>
    </div>
  );
}
