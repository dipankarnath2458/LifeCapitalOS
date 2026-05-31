import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Life Capital OS — Admin',
  description: 'Full-control admin panel for Life Capital OS',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
