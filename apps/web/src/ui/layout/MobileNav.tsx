'use client';

import { usePathname } from 'next/navigation';
import { cn } from '../cn';
import type { NavItem } from './types';

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

export interface MobileNavProps {
  /** Up to ~5 primary destinations for the bottom tab bar. */
  items: NavItem[];
  className?: string;
}

/**
 * Fixed bottom tab bar for small screens (hidden at md+). Shows an icon + short label
 * per destination and highlights the active route.
 */
export function MobileNav({ items, className }: MobileNavProps) {
  const pathname = usePathname();
  return (
    <nav
      className={cn(
        'fixed inset-x-0 bottom-0 z-[1100] flex items-stretch border-t border-border bg-surface/95 backdrop-blur md:hidden',
        'pb-[env(safe-area-inset-bottom)]',
        className,
      )}
      aria-label="Primary"
    >
      {items.slice(0, 5).map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <a
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors',
              active ? 'text-primary' : 'text-subtle hover:text-foreground',
            )}
          >
            {item.icon && <span className="h-5 w-5">{item.icon}</span>}
            <span className="truncate">{item.label}</span>
          </a>
        );
      })}
    </nav>
  );
}
