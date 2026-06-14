'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminGet, adminSend } from '@/lib/admin';
import { isAdminLevel, isSuperadmin, useAdminRole } from '@/lib/adminContext';
import { useToast } from '@/components/Toast';
import { Pager } from '@/components/Pager';
import { FeatureOverrides } from '@/components/FeatureOverrides';

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

const ROLES = ['USER', 'ADVISOR', 'SUPPORT', 'ANALYST', 'ADMIN', 'SUPERADMIN'];
const TIERS = ['free', 'premium', 'family_cfo'];
const TAKE = 25;

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [search, setSearch] = useState('');
  const [featuresFor, setFeaturesFor] = useState<AdminUser | null>(null);
  const role = useAdminRole();
  const canChangeRole = isSuperadmin(role);
  const canManageFeatures = isAdminLevel(role);
  const canErase = isSuperadmin(role);
  const toast = useToast();

  const load = useCallback(
    async (nextSkip = skip, nextSearch = search) => {
      try {
        const res = await adminGet<{ total: number; data: AdminUser[] }>(
          `/admin/users?search=${encodeURIComponent(nextSearch)}&skip=${nextSkip}&take=${TAKE}`,
        );
        setUsers(res.data);
        setTotal(res.total);
        setSkip(nextSkip);
      } catch {
        toast.error('Could not load users.');
      }
    },
    [skip, search, toast],
  );

  useEffect(() => {
    void load(0, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function runSearch() {
    void load(0, search);
  }

  async function toggleStatus(u: AdminUser) {
    const status = u.status === 'active' ? 'suspended' : 'active';
    const verb = status === 'suspended' ? 'Suspend' : 'Reactivate';
    if (!window.confirm(`${verb} ${u.email ?? u.phone ?? 'this user'}?`)) return;
    try {
      await adminSend(`/admin/users/${u.id}/status`, 'PATCH', { status });
      toast.success(`User ${status === 'suspended' ? 'suspended' : 'reactivated'}.`);
      await load();
    } catch {
      toast.error('Could not update the user.');
    }
  }

  async function changeTier(u: AdminUser, nextTier: string) {
    if (nextTier === u.tier) return;
    if (!window.confirm(`Set ${u.email ?? u.phone}'s plan to ${nextTier}? (comped, no payment)`)) return;
    try {
      await adminSend(`/admin/users/${u.id}/subscription`, 'PUT', { tier: nextTier });
      toast.success(`Plan set to ${nextTier}.`);
      await load();
    } catch {
      toast.error('Could not change the plan.');
    }
  }

  async function changeRole(u: AdminUser, nextRole: string) {
    if (nextRole === u.role) return;
    if (!window.confirm(`Change ${u.email ?? u.phone}'s role from ${u.role} to ${nextRole}?`)) return;
    try {
      await adminSend(`/admin/users/${u.id}/role`, 'PATCH', { role: nextRole });
      toast.success(`Role changed to ${nextRole}.`);
      await load();
    } catch {
      toast.error('Could not change the role.');
    }
  }

  async function erase(u: AdminUser) {
    const ident = u.email ?? u.phone ?? '';
    const typed = window.prompt(
      `This permanently deletes ${ident} and all their data. Type their email/phone to confirm:`,
    );
    if (typed == null) return;
    if (typed.trim() !== ident) {
      toast.error('Confirmation did not match. Nothing was deleted.');
      return;
    }
    try {
      await adminSend(`/admin/users/${u.id}`, 'DELETE');
      toast.success('User erased.');
      await load();
    } catch {
      toast.error('Could not erase the user.');
    }
  }

  async function exportData(u: AdminUser) {
    try {
      const data = await adminGet(`/admin/users/${u.id}/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `user-${u.id}.json`;
      a.click();
      toast.success('Export downloaded.');
    } catch {
      toast.error('Could not export this user.');
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Users</h1>
      <div className="mb-4 flex gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
          placeholder="Search email or phone"
          aria-label="Search users"
          className="w-72 rounded-lg border border-slate-200 px-3 py-2"
        />
        <button onClick={runSearch} className="rounded-lg bg-brand px-4 py-2 text-white">
          Search
        </button>
      </div>
      <div className="overflow-x-auto rounded-2xl bg-white shadow">
        <table className="w-full min-w-[640px] text-sm">
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
                <td className="p-3">
                  {canChangeRole ? (
                    <select
                      value={u.role}
                      onChange={(e) => changeRole(u, e.target.value)}
                      aria-label={`Role for ${u.email ?? u.phone}`}
                      className="rounded-lg border border-slate-200 px-2 py-1"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : (
                    u.role
                  )}
                </td>
                <td className="p-3">
                  {canManageFeatures ? (
                    <select
                      value={u.tier}
                      onChange={(e) => changeTier(u, e.target.value)}
                      aria-label={`Plan for ${u.email ?? u.phone}`}
                      className="rounded-lg border border-slate-200 px-2 py-1"
                    >
                      {TIERS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  ) : (
                    u.tier
                  )}
                </td>
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
                <td className="space-x-2 p-3 whitespace-nowrap">
                  <button onClick={() => toggleStatus(u)} className="text-brand hover:underline">
                    {u.status === 'active' ? 'Suspend' : 'Reactivate'}
                  </button>
                  {canManageFeatures && (
                    <button onClick={() => setFeaturesFor(u)} className="text-slate-600 hover:underline">
                      Features
                    </button>
                  )}
                  <button onClick={() => exportData(u)} className="text-slate-500 hover:underline">
                    Export
                  </button>
                  {canErase && (
                    <button onClick={() => erase(u)} className="text-rose-600 hover:underline">
                      Erase
                    </button>
                  )}
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
        <Pager skip={skip} take={TAKE} total={total} onChange={(s) => load(s)} />
      </div>

      {featuresFor && (
        <FeatureOverrides
          userId={featuresFor.id}
          userLabel={featuresFor.email ?? featuresFor.phone ?? featuresFor.id}
          onClose={() => setFeaturesFor(null)}
        />
      )}
    </div>
  );
}
