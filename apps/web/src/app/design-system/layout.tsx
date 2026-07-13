import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ThemeProvider, ThemeScript } from '@/ui';

export const metadata: Metadata = {
  title: 'Design System — Life Capital OS',
  description: 'V2 UI foundation: tokens, components, and layout (light/dark).',
};

/** Opt-in theming boundary for the design-system showcase (does not affect other routes). */
export default function DesignSystemLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <ThemeScript />
      {children}
    </ThemeProvider>
  );
}
