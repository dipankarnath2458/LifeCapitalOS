'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { isAdminRole } from '@/lib/admin';
import { AdminRoleContext } from '@/lib/adminContext';
import { AdminShell } from '@/components/AdminShell';

interface Me {
  role?: string;
}

/**
 * Gate the whole /admin section to admin roles. Non-admins are redirected before any
 * admin content renders. The API enforces the same check server-side, so this is the
 * UX layer, not the security boundary — admin data can never be fetched without the role.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'checking' | 'allowed'>('checking');
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    const t = typeof window !== 'undefined' ? localStorage.getItem('lcos_access') : null;
    if (!t) {
      window.location.href = '/login';
      return;
    }
    apiGet<Me>('/auth/me', t)
      .then((me) => {
        if (isAdminRole(me.role)) {
          setRole(me.role ?? null);
          setState('allowed');
        } else {
          window.location.href = '/dashboard';
        }
      })
      .catch(() => {
        window.location.href = '/login';
      });
  }, []);

  if (state === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        Checking access…
      </div>
    );
  }

  return (
    <AdminRoleContext.Provider value={role}>
      <AdminShell>{children}</AdminShell>
    </AdminRoleContext.Provider>
  );
}
