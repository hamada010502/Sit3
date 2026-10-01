import type { Metadata, Viewport } from 'next';
import { ServiceWorker } from '@/components/ServiceWorker';
import './globals.css';
import { getLang } from '@/lib/i18n/server';
import { dirOf } from '@/lib/i18n';
import { I18nProvider } from '@/lib/i18n/client';

export const metadata: Metadata = {
  title: 'Paylo — Your store. One link.',
  description: 'Link-in-bio commerce for independent sellers. One storefront link, orders, delivery coordination and payouts in one place.',
  appleWebApp: { capable: true, title: 'Paylo', statusBarStyle: 'default' },
  icons: { apple: '/icons/apple-touch-icon.png' },
};
export const viewport: Viewport = { themeColor: '#04380E', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = getLang();
  return (
    <html lang={lang} dir={dirOf(lang)}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800;900&family=Cairo:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
      </head>
      <body className="min-h-screen flex flex-col">
        <I18nProvider lang={lang}>{children}</I18nProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
