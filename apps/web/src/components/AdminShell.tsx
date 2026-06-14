'use client';

import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/plans', label: 'Plans & Billing' },
  { href: '/admin/flags', label: 'Feature Flags' },
  { href: '/admin/audit', label: 'Audit Log' },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 bg-brand-dark p-4 text-white">
        <div className="mb-1 text-lg font-bold">Life Capital OS</div>
        <div className="mb-8 text-xs uppercase tracking-wide text-brand-light">Admin</div>
        <nav className="space-y-1">
          {NAV.map((n) => {
            const active = n.href === '/admin' ? pathname === '/admin' : pathname.startsWith(n.href);
            return (
              <a
                key={n.href}
                href={n.href}
                className={`block rounded-lg px-3 py-2 text-sm ${
                  active ? 'bg-white/20 font-semibold' : 'text-brand-light hover:bg-white/10'
                }`}
              >
                {n.label}
              </a>
            );
          })}
        </nav>
        <a
          href="/dashboard"
          className="mt-8 block rounded-lg bg-white/10 px-3 py-2 text-center text-sm hover:bg-white/20"
        >
          ← Back to app
        </a>
        <button
          onClick={() => {
            localStorage.removeItem('lcos_access');
            localStorage.removeItem('lcos_refresh');
            window.location.href = '/login';
          }}
          className="mt-2 w-full rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20"
        >
          Sign out
        </button>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
