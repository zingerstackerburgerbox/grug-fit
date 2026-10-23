/// <reference lib="webworker" />
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { setCacheNameDetails } from 'workbox-core';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: any };

// Versioned precache: cache name carries a hash of this build's precache manifest (file revisions/hashes).
const MANIFEST = self.__WB_MANIFEST;
const hash = (str: string) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const BUILD = hash(JSON.stringify(MANIFEST));
setCacheNameDetails({ prefix: 'grugfit', precache: 'precache-' + BUILD });
const PRECACHE = `grugfit-precache-${BUILD}-${self.registration.scope}`;
precacheAndRoute(MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));
// Old pages still open during an update may lazy-load chunks of the previous build: serve them from ANY cache we still hold.
registerRoute(({ url, request }) => url.origin === self.location.origin && url.pathname.includes('/assets/') && request.method === 'GET',
  async ({ request }) => (await caches.match(request, { ignoreSearch: true })) || fetch(request));
// On-device OCR engine (Tesseract worker, WASM core, traineddata ~9 MB): not precached so installs stay small;
// cached on first use (or via Settings → "Make label scanning available offline") and served offline thereafter.
registerRoute(({ url }) => url.origin === self.location.origin && url.pathname.includes('/tesseract/'), new CacheFirst({ cacheName: 'grugfit-ocr-v7' }));
// Open Food Facts API: network first, fall back to cache when offline
registerRoute(({ url }) => url.hostname.endsWith('openfoodfacts.org') && (url.pathname.startsWith('/api') || url.pathname.startsWith('/search') || url.pathname.startsWith('/cgi')),
  new NetworkFirst({ cacheName: 'off-api', plugins: [new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 })] }));
registerRoute(({ url }) => url.hostname.includes('openfoodfacts') && /\.(jpg|png|webp)$/.test(url.pathname),
  new CacheFirst({ cacheName: 'off-img', plugins: [new ExpirationPlugin({ maxEntries: 200 })] }));

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  await self.clients.claim();
  // keep this build's precache + the one it replaces (pages that haven't reloaded yet may still need its chunks); delete older ones
  const meta = await caches.open('grugfit-meta');
  const replaced = (await (await meta.match('current'))?.text()) || '';
  for (const k of await caches.keys()) if (k.startsWith('grugfit-precache-') && k !== PRECACHE && k !== replaced) await caches.delete(k);
  if (replaced !== PRECACHE) await meta.put('current', new Response(PRECACHE));
})()));

// In-SW reminder timers: only live while the browser keeps the worker alive.
const timers = new Map<string, any>();
self.addEventListener('message', (e: ExtendableMessageEvent) => {
  const d = e.data || {};
  if (d.type === 'GET_BUILD') { e.ports?.[0]?.postMessage({ build: BUILD }); return; }
  if (d.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
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
