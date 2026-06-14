'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/plans', label: 'Plans & Billing' },
  { href: '/admin/flags', label: 'Feature Flags' },
  { href: '/admin/audit', label: 'Audit Log' },
];

function signOut() {
  localStorage.removeItem('lcos_access');
  localStorage.removeItem('lcos_refresh');
  window.location.href = '/login';
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);

  const nav = (
    <nav className="space-y-1">
      {NAV.map((n) => (
        <a
          key={n.href}
          href={n.href}
          onClick={() => setOpen(false)}
          className={`block rounded-lg px-3 py-2 text-sm ${
            isActive(n.href) ? 'bg-white/20 font-semibold' : 'text-brand-light hover:bg-white/10'
          }`}
        >
          {n.label}
        </a>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Mobile top bar */}
      <header className="flex items-center justify-between bg-brand-dark px-4 py-3 text-white md:hidden">
        <span className="font-bold">Life Capital OS · Admin</span>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label="Toggle navigation"
          className="rounded-lg bg-white/10 px-3 py-1 text-sm"
        >
          {open ? 'Close' : 'Menu'}
        </button>
      </header>
      {open && (
        <div className="bg-brand-dark px-4 pb-4 text-white md:hidden">
          {nav}
          <a href="/dashboard" className="mt-4 block rounded-lg bg-white/10 px-3 py-2 text-center text-sm">
            ← Back to app
          </a>
          <button onClick={signOut} className="mt-2 w-full rounded-lg bg-white/10 px-3 py-2 text-sm">
            Sign out
          </button>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 bg-brand-dark p-4 text-white md:block">
        <div className="mb-1 text-lg font-bold">Life Capital OS</div>
        <div className="mb-8 text-xs uppercase tracking-wide text-brand-light">Admin</div>
        {nav}
        <a
          href="/dashboard"
          className="mt-8 block rounded-lg bg-white/10 px-3 py-2 text-center text-sm hover:bg-white/20"
        >
          ← Back to app
        </a>
        <button
          onClick={signOut}
          className="mt-2 w-full rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20"
        >
          Sign out
        </button>
      </aside>

      <main className="flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
