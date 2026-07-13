'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '../cn';
import type { NavItem, NavSection } from './types';

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <a
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-subtle hover:bg-muted hover:text-foreground',
      )}
    >
      {item.icon && (
        <span className={cn('shrink-0', active ? 'text-primary' : 'text-subtle group-hover:text-foreground')}>
          {item.icon}
        </span>
      )}
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge && <span className="shrink-0">{item.badge}</span>}
    </a>
  );
}

export interface SidebarProps {
  /** Flat list or grouped sections. */
  sections: NavSection[];
  /** Brand / logo area at the top. */
  brand?: ReactNode;
  /** Sticky footer area (e.g. user card, upgrade CTA). */
  footer?: ReactNode;
  className?: string;
}

/**
 * Vertical navigation rail. Highlights the active route via `usePathname`. Rendered by
 * `DashboardLayout` for desktop (md+) and reused inside the mobile drawer.
 */
export function Sidebar({ sections, brand, footer, className }: SidebarProps) {
  const pathname = usePathname();
  return (
    <aside
      className={cn(
        'flex h-full w-64 shrink-0 flex-col border-r border-border bg-surface',
        className,
      )}
    >
      {brand && <div className="flex h-16 items-center gap-2 px-5">{brand}</div>}
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {sections.map((section, i) => (
          <div key={section.title ?? i} className="space-y-1">
            {section.title && (
              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-subtle">
                {section.title}
              </p>
            )}
            {section.items.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
            ))}
          </div>
        ))}
      </nav>
      {footer && <div className="border-t border-border p-3">{footer}</div>}
    </aside>
  );
}
