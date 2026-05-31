'use client';

import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/users', label: 'Users' },
  { href: '/dashboard/plans', label: 'Plans & Billing' },
  { href: '/dashboard/flags', label: 'Feature Flags' },
  { href: '/dashboard/audit', label: 'Audit Log' },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 bg-brand-dark p-4 text-white">
        <div className="mb-8 text-lg font-bold">Life Capital OS</div>
        <nav className="space-y-1">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className={`block rounded-lg px-3 py-2 text-sm ${
                pathname === n.href ? 'bg-white/20 font-semibold' : 'text-brand-light hover:bg-white/10'
              }`}
            >
              {n.label}
            </a>
          ))}
        </nav>
        <button
          onClick={() => {
            localStorage.removeItem('lcos_admin_token');
            window.location.href = '/';
          }}
          className="mt-8 w-full rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20"
        >
          Sign out
        </button>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
