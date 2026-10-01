import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Paylo — Your store. One link.',
    short_name: 'Paylo',
    description: 'Run your Paylo store: orders, hand-offs and payouts.',
    // Sellers are the ones who install it; buyers arrive by link and never need to.
    start_url: '/seller',
    scope: '/',
    display: 'standalone',
    background_color: '#F8F4EC',
    theme_color: '#04380E',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
