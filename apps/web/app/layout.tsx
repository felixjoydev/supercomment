import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/instrument-sans';
import '@fontsource-variable/fraunces/opsz.css';
import '@fontsource-variable/fraunces/opsz-italic.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'SuperComment',
  description: 'Team visual feedback for AI-driven development',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
