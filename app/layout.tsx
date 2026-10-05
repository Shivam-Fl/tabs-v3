import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

/**
 * Inter is the product's one typeface (ui.md). next/font downloads it at build time and
 * serves it from this origin, so the browser never requests a font from a third party and
 * there is neither a flash of fallback text nor a layout shift when it swaps in. The
 * variable it publishes is what `--font-body` in globals.css resolves against; the system
 * stack beside it is the fallback for a client that never receives the file.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'Tabs',
  description: 'Shared expenses for groups: who paid, who owes whom, settled up.',
  icons: { icon: '/icon.svg' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
