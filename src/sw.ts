/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: any };

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));
// Open Food Facts API: network first, fall back to cache when offline
registerRoute(({ url }) => url.hostname.endsWith('openfoodfacts.org') && (url.pathname.startsWith('/api') || url.pathname.startsWith('/search') || url.pathname.startsWith('/cgi')),
  new NetworkFirst({ cacheName: 'off-api', plugins: [new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 })] }));
registerRoute(({ url }) => url.hostname.includes('openfoodfacts') && /\.(jpg|png|webp)$/.test(url.pathname),
  new CacheFirst({ cacheName: 'off-img', plugins: [new ExpirationPlugin({ maxEntries: 200 })] }));

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// In-SW reminder timers: only live while the browser keeps the worker alive.
const timers = new Map<string, any>();
self.addEventListener('message', (e: ExtendableMessageEvent) => {
  const d = e.data || {};
  if (d.type === 'schedule-reminders') {
    timers.forEach(clearTimeout); timers.clear();
    const now = Date.now();
    for (const r of d.reminders as { id: string; at: number; title: string; body: string }[]) {
      const ms = r.at - now;
      if (ms < 0 || ms > 24 * 3600e3) continue;
      timers.set(r.id, setTimeout(() => {
        self.registration.showNotification(r.title, { body: r.body, tag: r.id, icon: 'icon-192.png', badge: 'icon-192.png', data: { url: './#/calendar' } } as any);
      }, ms));
    }
  }
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (all.length) { (all[0] as WindowClient).focus(); (all[0] as WindowClient).navigate?.('./#/calendar'); return; }
    await self.clients.openWindow('./#/calendar');
  })());
});
