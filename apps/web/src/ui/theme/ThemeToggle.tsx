'use client';

import { cn } from '../cn';
import { IconMoon, IconSun } from '../icons';
import { useTheme } from './ThemeProvider';

/** Icon button that flips light/dark. Uses the ThemeProvider context. */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, toggle } = useTheme();
  const isDark = resolvedTheme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Light mode' : 'Dark mode'}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-muted hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      {isDark ? <IconSun className="h-5 w-5" /> : <IconMoon className="h-5 w-5" />}
    </button>
  );
}
