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
- Open Food Facts text search (cgi/search.pl) is rate-limited and sometimes returns 503; the Worker caches searches and falls back to search-a-licious, and the app falls back to direct OFF with retries. Offline pack results show regardless.
  search.openfoodfacts.org doesn't send CORS headers, so it's only a fallback.
- Micronutrients exist only where OFF/custom foods have data.
- Data is local-only: export JSON backups from Settings.

## Steps (v1.9.1)
Steps are typed in per day (Workout tab › Steps, any date; optional goal in Settings › Steps). Calories above the first
2,000 steps a day are added to burned-today (stride from height, 0.5 kcal per kg per km); see `src/steps.ts`.

## Hevy-style set editing (v1.14.0)
- One set grid (`src/pages/SetRows.tsx`) for the live logger and Edit workout: swipe a set row right (since v1.14.1; Delete appears on the left) to reveal Delete (a full swipe deletes; pointer events with `touch-action: pan-y`, engaging only after ~12 px of clearly horizontal movement, so vertical scrolling is untouched), then a 5 s "Set deleted · Undo" snackbar (`snack()` in `ui.tsx`). Tapping the set number opens the set type (W / 1 / D / F) and **Delete set** (the non-swipe way to delete). Previous column, ✓ tints the row, **+ Add set** copies the previous set's weight and reps.
- Edit workout now has + Add set, + Add exercise, the set-type menu and an exercise ⋮ menu (Add note, Move up/down, Remove exercise + Undo). Sets added while editing a finished workout start ticked. Nothing is written until Save; Cancel editing discards. Saving writes the workout (→ `lunk-logged` → leaderboard re-submit, Home stars refresh).
- Settings → Default rest timer has quick chips (1–4 min); the timer starts when a set is ticked (per-exercise override in the live ⋮ menu). Fixed the rest countdown showing 2:00 at the start of a 3:00 rest.

## Fast Australian food lookups (v1.13.0)
- **Offline pack**: `public/offpack/` holds ~30,000 products sold in Australia (OFF `countries_tags` contains `en:australia`, with a barcode, a name and kcal/100 g; most-scanned / most complete first), built from the official Open Food Facts bulk CSV export by `node scripts/build-au-pack.mjs <en.openfoodfacts.org.products.csv.gz> [max=30000] [YYYY-MM-DD]` (~90 s). 16 JSON shards keyed by the barcode's last two digits mod 16 (~3.5 MB raw, ~1.4 MB gzip as served by GitHub Pages) + `meta.json` (version/date/count). Not precached and not in the JS bundle: the app downloads it into its own IndexedDB database `grugfit-offpack` a few seconds after start-up (skipped with Data Saver), re-checks `meta.json` at most every 12 h, and fetches just one shard on demand if a scan comes first. Settings → Food lookup shows the status line with Refresh; About shows the ODbL credit and pack date. Rebuild + commit the shards to refresh the data (new `version` → devices re-download).
- **Lookup order** (barcode): saved foods → offline pack → coach-proxy `GET /food/barcode` (edge-cached OFF, trimmed fields, 6 s timeout, UPC/EAN variants in parallel) → direct OFF (only if the Worker fails) → USDA → not-found card. Every hit is saved as a food, so a rescan is instant and offline.
- **Search**: pack matches show immediately ("weet-bix", "weetbix"), then online results (`GET /food/search` via the Worker, else direct OFF) are appended; online results are cached on the device for 7 days and used offline.
- Test switch: `localStorage.foodPack = '0'` disables the pack (used by the older OFF-mock tests together with a REPLACE-ME `coachProxyUrl`). `localStorage.offpackAuto = '0'` disables only the background download.
- FSANZ AFCD (generic whole foods) was considered but not bundled: its licence is CC BY-SA 3.0 AU-based with extra notice terms (share-alike + limitation statement on every copy), and it has no barcodes.
- Food data © Open Food Facts contributors, [ODbL](https://opendatacommons.org/licenses/odbl/1-0/).

## Training leaderboard (v1.12.0, training-only since v1.12.1)
- **Where:** "🏆 View leaderboard" on the Grug's Review card (Home) and on the review result screen → `#/leaderboard`, tabs **Weekly**
  (default) and **Daily**. Rows: rank (🥇🥈🥉 for the top 3), username, stars, score; your own row is highlighted. Top 50 plus your own rank.
- **Score** = the Home Training stars' score (out of 100, `src/leaderboard.ts` `lbScores()`, same functions as `src/stars.ts`). Nutrition is
  not used since v1.12.1 (most people don't log food). Daily = today's training score (Sydney day). Weekly = the average of this week's daily
  training scores so far (each past day re-computed as it stood at the end of that day; week = Monday 00:00 Sydney).
- **Opt-in:** first open asks "Show me on the leaderboard" / "Just look"; Settings › Leaderboard joins or leaves (leaving deletes the entry on
  the worker; if offline it's retried on the next open). Not joined = can still view. Only the username and the two integers are sent.
- **Submitting:** when joined, quietly on app open / return to the app and after food, workout, dose or steps changes, at most once per
  5 minutes, and only when the numbers changed (plus on opening the board). Worker side: see `coach-proxy/README.md`.
- Scores are worked out on each phone, so a determined person could send a made-up (0–100) score.

## Grug's Review, star ratings, admin code (v1.11.0)
- **Grug's Review** (Home card under the nutrition card → `#/review/new`): the last 7 days of workouts, food, doses and steps are summarised
  on the device (`src/review.ts` `snapshot()`, ≤14k chars, no username) and sent to the coach proxy's `POST /review`, which returns strict JSON
  (scores, caveman summary, went well / slipped, 3–5 tips each with at most one real action). The stat tiles are computed locally.
  Actions that map to real features only: add a food to today/tomorrow, add a set to an existing routine, update targets, step goal,
  workouts-per-week goal. Anything else is dropped (worker and client). Reviews are kept on the device (`kv grugReviews`), can be saved
  (`#/review/saved`) and shared (Web Share image → text → PNG download + copied text). 1 free review a week (`REVIEW_WEEKLY_CAP`), resetting
  Monday 00:00 Sydney time, enforced on the worker (×3 per network); only successful reviews count.
- **Stars** (`src/stars.ts`, free, instant; only the combined score is sent, and only if you join the leaderboard): Training = consistency 40 (vs Settings › workouts-per-week goal, default 3),
  progressive overload 30, volume balance 20, movement 10; Nutrition = calories 35, protein 35, logging 20, supplements 10. A part that
  doesn't apply is left out and its points shared out. "Rating builds after 7 days" until 7 days of history.
- **Coach chat cap**: 5 free messages per device per day (15 per network). People using their own xAI key call xAI directly and aren't capped. Since v1.13.1 the own-key, owner-token and USDA key fields live on their own screen: Settings › Coach › "API key" row (`#/settings/keys`).
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
