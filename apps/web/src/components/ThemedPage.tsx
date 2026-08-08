'use client';

import { ThemeProvider, ThemeScript } from '@/ui';

/**
 * Themed page wrapper for the V2 consumer surfaces.
 *
 * ## The defect this fixes
 *
 * `ThemeProvider` supplies context only — it renders no element and applies no classes. The
 * class that actually adopts the design tokens is `.ds-root` (`bg-background`
 * `text-foreground` in `globals.css`), and until now **`DashboardLayout` was the only thing
 * in the codebase that applied it**, which is why the Advisor Workspace themed correctly and
 * the consumer pages did not.
 *
 * Without `.ds-root`, dark mode flipped the tokens but nothing adopted the token background:
 * `body` stayed `bg-slate-50` (light) while every design-system component resolved
 * `text-foreground` to slate-100. Measured on `/household` with `.dark` active:
 *
 *     body background  rgb(248, 250, 252)   ← near-white
 *     h1 colour        rgb(241, 245, 249)   ← near-white
 *     "Sign out"       rgb(241, 245, 249)   ← near-white
 *
 * Near-white on near-white: the heading, the navigation and the sign-out control were all
 * invisible. And it was reachable by default — with no stored preference, an OS set to dark
 * resolves to dark.
 *
 * This composes the design system rather than editing it: same `.ds-root` opt-in that
 * `DashboardLayout` already uses, applied at the page root.
 */
export function ThemedPage({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ThemeScript />
      {/* min-h-screen so the token background covers the viewport, not just the content. */}
      <div className="ds-root min-h-screen">{children}</div>
    </ThemeProvider>
  );
}
