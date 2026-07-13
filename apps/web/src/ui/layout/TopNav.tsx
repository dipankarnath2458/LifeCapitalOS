'use client';

import type { ReactNode } from 'react';
import { cn } from '../cn';
import { IconMenu } from '../icons';
import { ThemeToggle } from '../theme/ThemeToggle';

export interface TopNavProps {
  /** Current page title (left side). */
  title?: ReactNode;
  /** Actions rendered on the right (buttons, avatar, etc.). */
  actions?: ReactNode;
  /** Optional center/left slot (e.g. a search field). */
  slot?: ReactNode;
  /** Fired by the mobile hamburger to open the drawer. */
  onMenuClick?: () => void;
  /** Show the theme toggle (default true). */
  showThemeToggle?: boolean;
  className?: string;
}

/** Sticky top bar: mobile menu button, page title, optional slot, actions, theme toggle. */
export function TopNav({
  title,
  actions,
  slot,
  onMenuClick,
  showThemeToggle = true,
  className,
}: TopNavProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-[1100] flex h-16 items-center gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur sm:px-6',
        className,
      )}
    >
      {onMenuClick && (
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open menu"
          className="-ml-1 inline-flex h-9 w-9 items-center justify-center rounded-lg text-subtle hover:bg-muted hover:text-foreground md:hidden"
        >
          <IconMenu className="h-5 w-5" />
        </button>
      )}
      {title && <h1 className="truncate text-lg font-semibold text-foreground">{title}</h1>}
      {slot && <div className="hidden flex-1 sm:block">{slot}</div>}
      <div className="ml-auto flex items-center gap-1.5">
        {actions}
        {showThemeToggle && <ThemeToggle />}
      </div>
    </header>
  );
}
