# Grug Fit

Installable offline-first PWA combining a Hevy-style workout tracker, a Cronometer-style nutrition diary,
supplement/medication tracking and a dose calendar. Preact + TypeScript + Vite, all data in IndexedDB on the device.

## Develop / build
    npm install
    npx vite            # dev server
    npx vite build      # static output in dist/
    node gen-icons.mjs  # regenerate icons
    python3 -m http.server 4173 --directory dist &  &&  node tests/smoke.mjs   # Playwright smoke test

Deploy `dist/` to any static HTTPS host (GitHub Pages, Netlify, Cloudflare Pages…). Paths are relative (`base: './'`), so sub-paths work.

## Known limitations
- Reminders: the Web has no reliable scheduled alarms on Android. Reminders are timers in the service worker / page and fire
  only while Chrome keeps the app alive. Notification Triggers (`TimestampTrigger`) are used automatically if the browser
  supports them (Chrome doesn't ship it by default).
- Open Food Facts text search (cgi/search.pl) is rate-limited and sometimes returns 503; the app retries. Barcode lookup is reliable.
  search.openfoodfacts.org doesn't send CORS headers, so it's only a fallback.
- Micronutrients exist only where OFF/custom foods have data.
- Data is local-only: export JSON backups from Settings.
