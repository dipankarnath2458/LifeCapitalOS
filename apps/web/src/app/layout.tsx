import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/Toast';

export const metadata: Metadata = {
  title: 'Life Capital OS — Wealth Health & Family CFO',
  description: 'Know your financial health in 5 minutes. Personalized wealth scores, retirement, allocation and insurance insights.',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  themeColor: '#0f766e',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the design-system ThemeScript sets the theme class /
    // data-theme on <html> before hydration to avoid a light/dark flash; this silences
    // the expected attribute mismatch on <html> only (standard theme-provider pattern).
    <html lang="en" suppressHydrationWarning>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
