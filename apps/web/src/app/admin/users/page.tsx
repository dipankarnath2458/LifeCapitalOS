'use client';

import { useEffect, useState } from 'react';
import { adminGet, adminSend } from '@/lib/admin';

interface AdminUser {
  id: string;
  email: string | null;
  phone: string | null;
  role: string;
  status: string;
  tier: string;
  fullName: string | null;
  createdAt: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');

  async function load() {
    const res = await adminGet<{ data: AdminUser[] }>(
      `/admin/users?search=${encodeURIComponent(search)}`,
    );
    setUsers(res.data);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleStatus(u: AdminUser) {
    const status = u.status === 'active' ? 'suspended' : 'active';
    const verb = status === 'suspended' ? 'Suspend' : 'Reactivate';
    if (!window.confirm(`${verb} ${u.email ?? u.phone ?? 'this user'}?`)) return;
    await adminSend(`/admin/users/${u.id}/status`, 'PATCH', { status });
    await load();
  }

  async function exportData(u: AdminUser) {
    const data = await adminGet(`/admin/users/${u.id}/export`);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `user-${u.id}.json`;
    a.click();
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Users</h1>
      <div className="mb-4 flex gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search email or phone"
          className="w-72 rounded-lg border border-slate-200 px-3 py-2"
        />
        <button onClick={load} className="rounded-lg bg-brand px-4 py-2 text-white">
          Search
        </button>
      </div>
      <div className="overflow-hidden rounded-2xl bg-white shadow">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="p-3">User</th>
              <th className="p-3">Role</th>
              <th className="p-3">Tier</th>
              <th className="p-3">Status</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="p-3">
                  <div className="font-medium">{u.fullName ?? '—'}</div>
                  <div className="text-slate-500">{u.email ?? u.phone}</div>
                </td>
                <td className="p-3">{u.role}</td>
                <td className="p-3">{u.tier}</td>
                <td className="p-3">
                  <span
                    className={`rounded px-2 py-1 text-xs ${
                      u.status === 'active'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-rose-100 text-rose-700'
                    }`}
                  >
                    {u.status}
                  </span>
                </td>
                <td className="space-x-2 p-3">
                  <button onClick={() => toggleStatus(u)} className="text-brand hover:underline">
                    {u.status === 'active' ? 'Suspend' : 'Reactivate'}
                  </button>
                  <button onClick={() => exportData(u)} className="text-slate-500 hover:underline">
                    Export
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td className="p-4 text-slate-500" colSpan={5}>
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
