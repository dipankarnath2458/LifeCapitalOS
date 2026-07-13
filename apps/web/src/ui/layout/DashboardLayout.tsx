'use client';

import { useState, type ReactNode } from 'react';
import { cn } from '../cn';
import { IconX } from '../icons';
import { Sidebar } from './Sidebar';
import { TopNav } from './TopNav';
import { MobileNav } from './MobileNav';
import type { NavItem, NavSection } from './types';

export interface DashboardLayoutProps {
  /** Grouped navigation for the sidebar + drawer. */
  sections: NavSection[];
  /** Subset of destinations shown in the mobile bottom bar (defaults to first section). */
  mobileItems?: NavItem[];
  brand?: ReactNode;
  sidebarFooter?: ReactNode;
  title?: ReactNode;
  actions?: ReactNode;
  topSlot?: ReactNode;
  children: ReactNode;
}

/**
 * App shell: fixed desktop sidebar, sticky top nav, scrollable content, and a mobile
 * bottom nav + slide-over drawer. Fully responsive and theme-aware. Purely presentational —
 * pass navigation and content in; no business logic here.
 */
export function DashboardLayout({
  sections,
  mobileItems,
  brand,
  sidebarFooter,
  title,
  actions,
  topSlot,
  children,
}: DashboardLayoutProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const bottomItems = mobileItems ?? sections[0]?.items ?? [];

  return (
    <div className="ds-root flex min-h-screen">
      {/* Desktop sidebar */}
      <div className="hidden md:flex">
        <Sidebar sections={sections} brand={brand} footer={sidebarFooter} />
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[1200] md:hidden">
          <div
            className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm animate-fade-in"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[80%] animate-scale-in">
            <Sidebar
              sections={sections}
              brand={
                <div className="flex w-full items-center justify-between">
                  {brand}
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    aria-label="Close menu"
                    className="rounded-md p-1 text-subtle hover:bg-muted hover:text-foreground"
                  >
                    <IconX className="h-5 w-5" />
                  </button>
                </div>
              }
              footer={sidebarFooter}
            />
          </div>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopNav
          title={title}
          actions={actions}
          slot={topSlot}
          onMenuClick={() => setDrawerOpen(true)}
        />
        <main className={cn('flex-1 px-4 py-6 sm:px-6', 'pb-24 md:pb-6')}>{children}</main>
        <MobileNav items={bottomItems} />
      </div>
    </div>
  );
}
