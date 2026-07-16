'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { AppContext, type AppContextValue, type FirmSummary } from '@/lib/appContext';
import { DashboardLayout, Select, EmptyState } from '@/ui';
import type { NavSection } from '@/ui';
import { IconHome, IconUsers, IconChart } from '@/ui/icons';

interface FirmsMe {
  activeFirmId: string | null;
  firms: FirmSummary[];
}

const NAV: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', href: '/app', icon: <IconHome className="h-5 w-5" /> },
      { label: 'Book overview', href: '/app/book', icon: <IconChart className="h-5 w-5" /> },
      { label: 'Households', href: '/app/households', icon: <IconUsers className="h-5 w-5" /> },
    ],
  },
];

function logout(): void {
  localStorage.removeItem('lcos_access');
  localStorage.removeItem('lcos_refresh');
  window.location.href = '/login';
}

/**
 * Advisor workspace shell. Resolves the active firm from the caller's memberships,
 * gates the section to firm members, and provides firm context to the pages below.
 * The API enforces firm scope server-side; this is the UX layer.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'checking' | 'no-firm' | 'ready'>('checking');
  const [ctx, setCtx] = useState<AppContextValue | null>(null);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('lcos_access') : null;
    if (!token) {
      window.location.href = '/login';
      return;
    }
    apiGet<FirmsMe>('/firms/me', token)
      .then(async (me) => {
        if (!me.firms || me.firms.length === 0) {
          setState('no-firm');
          return;
        }
        const active = me.firms.find((f) => f.id === me.activeFirmId) ?? me.firms[0];
        if (!active) {
          setState('no-firm');
          return;
        }
        // Persist the resolved firm so household calls (which read User.activeFirmId
        // server-side) are scoped correctly. Only writes when it actually changed.
        if (me.activeFirmId !== active.id) {
          await apiPost(`/firms/${active.id}/switch`, {}, token).catch(() => undefined);
        }
        setCtx({ token, firmId: active.id, firm: active, firms: me.firms });
        setState('ready');
      })
      .catch(() => {
        window.location.href = '/login';
      });
  }, []);

  async function switchFirm(id: string): Promise<void> {
    const token = localStorage.getItem('lcos_access');
    if (!token) return;
    await apiPost(`/firms/${id}/switch`, {}, token).catch(() => undefined);
    window.location.reload();
  }

  if (state === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center text-subtle">Loading workspace…</div>
    );
  }

  if (state === 'no-firm' || !ctx) {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg items-center px-6">
        <EmptyState
          title="No firm yet"
          description="Your account isn't a member of any firm. Ask a firm owner or a platform admin to invite you."
          action={{ label: 'Sign out', onClick: logout }}
        />
      </div>
    );
  }

  const brand = (
    <div className="min-w-0">
      <p className="truncate text-sm font-semibold text-foreground">{ctx.firm.brandName ?? ctx.firm.name}</p>
      <p className="text-xs text-subtle">Advisor workspace</p>
    </div>
  );

  const footer = (
    <div className="space-y-2">
      {ctx.firms.length > 1 && (
        <Select
          aria-label="Switch firm"
          value={ctx.firmId}
          onChange={(e) => void switchFirm(e.target.value)}
        >
          {ctx.firms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Select>
      )}
      <div className="flex items-center justify-between px-1">
        <span className="truncate text-xs text-subtle">{ctx.firm.firmRole}</span>
        <button type="button" onClick={logout} className="text-xs text-subtle hover:text-foreground">
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <AppContext.Provider value={ctx}>
      <DashboardLayout sections={NAV} brand={brand} sidebarFooter={footer} title="Advisor workspace">
        {children}
      </DashboardLayout>
    </AppContext.Provider>
  );
}
