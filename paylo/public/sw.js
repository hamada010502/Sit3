/*
 * Paylo service worker: offline fallback page + Web Push for new orders.
 * Deliberately no data caching — order, stock and payout pages must never be stale.
 */
const CACHE = 'paylo-shell-v1';
const SHELL = ['/offline.html', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Page navigations: always the network; the offline page only when there is none.
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => caches.match('/offline.html')));
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'Paylo', body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    // A visible seller tab already shows a toast and plays the chime — don't double up.
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = wins.filter((w) => w.visibilityState === 'visible' && new URL(w.url).pathname.startsWith('/seller'));
    if (open.length) { open.forEach((w) => w.postMessage({ type: 'paylo-new-order', ...d })); return; }
    await self.registration.showNotification(d.title || 'Paylo', {
      body: d.body || '', tag: d.tag, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: d.url || '/seller' },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/seller';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) if (new URL(w.url).pathname.startsWith('/seller') && 'focus' in w) { await w.navigate(url).catch(() => {}); return w.focus(); }
    return self.clients.openWindow(url);
  })());
});
