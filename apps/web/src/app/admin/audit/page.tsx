'use client';

import { useEffect, useState } from 'react';
import { adminGet } from '@/lib/admin';

interface AuditRow {
  id: string;
  action: string;
  actorId: string | null;
  actorRole: string | null;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
}

export default function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);

  useEffect(() => {
    adminGet<{ data: AuditRow[] }>('/admin/audit').then((r) => setRows(r.data));
  }, []);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Audit Log</h1>
      <div className="overflow-hidden rounded-2xl bg-white shadow">
        <table className="w-full text-sm">
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
      </div>
    </div>
  );
}
