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

## Android app (optional, v1.9.0+)

`android/` is a [Capacitor](https://capacitorjs.com) shell that opens the **live site** (`capacitor.config.json` → `server.url`), so
web updates arrive exactly as in the browser; only native changes need a new APK. It adds **step counting** with the phone's
built-in hardware step counter (`Sensor.TYPE_STEP_COUNTER`, permission “Physical activity”) – no Google Fit / Health Connect /
other apps.

- Native code: `android/app/src/main/java/…/grugfit/` – `GrugNativePlugin.kt` (JS bridge: steps, save file, app version),
  `steps/StepLedger.kt` (pure counter → per-day totals, reboot handling, midnight split; JVM tests in `app/src/test`),
  `StepStore.kt` (one-off sensor reads), `StepWork.kt` (15-min + midnight WorkManager readings, boot receiver),
  `StepService.kt` (optional always-on counting with a silent notification; off by default).
- Web side: `src/native.ts` (bridge, update check), `src/steps.ts` (sync + calorie maths), `src/pages/Steps.tsx` (UI, `#/android`).
- Data: the app's WebView storage is separate from Chrome's, so `#/android` explains a one-time move via Backup export/import.
- CI: `.github/workflows/android.yml` builds a signed release APK (keystore from Actions secrets), runs unit tests, publishes
  release `android-v<shellVersionName>` (bump it in `android/app/build.gradle`), and smoke-tests on an emulator.
  Stable download: https://github.com/zingerstackerburgerbox/grug-fit/releases/latest/download/grug-fit.apk
- Local build: JDK 21 + Android SDK 36, `npm run android:sync && cd android && ./gradlew assembleDebug`.
