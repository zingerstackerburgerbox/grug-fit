# Lunk

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

## Steps (v1.9.1)
Steps are typed in per day (Workout tab › Steps, any date; optional goal in Settings › Steps). Calories above the first
2,000 steps a day are added to burned-today (stride from height, 0.5 kcal per kg per km); see `src/steps.ts`.

## Grug's Review, star ratings, admin code (v1.11.0)
- **Grug's Review** (Home card under the nutrition card → `#/review/new`): the last 7 days of workouts, food, doses and steps are summarised
  on the device (`src/review.ts` `snapshot()`, ≤14k chars, no username) and sent to the coach proxy's `POST /review`, which returns strict JSON
  (scores, caveman summary, went well / slipped, 3–5 tips each with at most one real action). The stat tiles are computed locally.
  Actions that map to real features only: add a food to today/tomorrow, add a set to an existing routine, update targets, step goal,
  workouts-per-week goal. Anything else is dropped (worker and client). Reviews are kept on the device (`kv grugReviews`), can be saved
  (`#/review/saved`) and shared (Web Share image → text → PNG download + copied text). 1 free review a week (`REVIEW_WEEKLY_CAP`), resetting
  Monday 00:00 Sydney time, enforced on the worker (×3 per network); only successful reviews count.
- **Stars** (`src/stars.ts`, free, instant, never sent): Training = consistency 40 (vs Settings › workouts-per-week goal, default 3),
  progressive overload 30, volume balance 20, movement 10; Nutrition = calories 35, protein 35, logging 20, supplements 10. A part that
  doesn't apply is left out and its points shared out. "Rating builds after 7 days" until 7 days of history.
- **Coach chat cap**: 5 free messages per device per day (15 per network). People using their own xAI key call xAI directly and aren't capped.
- **Admin code** (Settings › About › Advanced · Admin code): sent once to `POST /admin`; the worker compares a salted hash kept as a secret
  and returns a per-device admin token (stored as `settings.adminToken`, sent as `X-Admin-Token`) that lifts every cap. The code is
  not stored in the app or this repo. Remove revokes the token.

## Smart Estimate (v1.10.0)
Food tab › "≈ Estimate" (on each meal, and on the Add food screen) opens `#/food/estimate/<date>/<meal>`. You describe a meal (and can add a photo), get an
editable per-item estimate (name, grams, kcal, protein, carbs, fat), and nothing is saved until you tap Log. Logged items are normal diary entries with an
`est` flag (shown as "≈ est.") and no saved food. A one-time notice (`settings.estNotice`) comes first and also covers sending the description or photo.
Requests go to the coach proxy's `POST /estimate`, which builds the prompt, checks the JSON reply and enforces the daily cap
(`EST_DAILY_CAP`, 3 per device per UTC day since v1.10.1, ×3 = 9 per network). Only successful estimates count, the owner token bypasses the cap, and coach messages aren't used.
The user-facing copy never says "AI". Photos are shrunk in memory (≤1024 px JPEG), sent once and never stored. Code: `src/estimate.ts`, `src/pages/Estimate.tsx`.

## Name (v1.9.4)
The app is called **Lunk** (formerly "Grug Fit"); the AI Coach persona is still **Grug**. Renamed only where users see it.
Kept as `grug-fit` / `grugfit` on purpose so existing installs update in place and keep their data: the URL/base path
`/grug-fit/`, the repo name, the manifest `id` (`/grug-fit/`), scope/start_url, the IndexedDB name `grugfit`,
localStorage/settings keys, service-worker cache names (`grugfit-*`), the backup `app: "grugfit"` marker (old and new
backups import both ways) and the coach-proxy Worker (`grug-coach-proxy`). Backups are now downloaded as `lunk-backup-YYYY-MM-DD.json`.

Roadmap / parked work: [docs/ROADMAP.md](docs/ROADMAP.md).
