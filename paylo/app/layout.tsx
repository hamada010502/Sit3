import type { Metadata } from 'next';
import './globals.css';
import { getLang } from '@/lib/i18n/server';
import { dirOf } from '@/lib/i18n';
import { I18nProvider } from '@/lib/i18n/client';

export const metadata: Metadata = {
  title: 'Paylo — Link It. Get Paid.',
  description: 'Payment and delivery platform for Syrian social-media sellers.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = getLang();
  return (
    <html lang={lang} dir={dirOf(lang)}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
      </head>
      <body className="min-h-screen flex flex-col">
        <I18nProvider lang={lang}>{children}</I18nProvider>
      </body>
    </html>
  );
}
