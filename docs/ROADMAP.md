# Lunk roadmap

## Planned: accounts + sharing + paid tier
User accounts / login (sharing workouts, meals and recipes; a paid tier). Not built yet.
Smart Estimate is limited to 3 a day (since v1.10.1; was 1) (`EST_DAILY_CAP` in coach-proxy/wrangler.toml + mirror in src/estimate.ts) until the paid tier exists;
the "used" card in `src/pages/Estimate.tsx` has room for a future 'More with Lunk Pro' line. Data model kept ready for it:
local records keep stable string IDs, and the on-device username is a display name only, separate from any future account id.
Since v1.11.0 the free tier is: coach chat 5 messages a day (`DEVICE_DAILY_CAP`), Smart Estimate 3 a day, Grug's Review 1 a week
(`REVIEW_WEEKLY_CAP`, Monday 00:00 Sydney). The review card and the used-review state show "Want more? Lunk Premium (coming soon)" –
Premium would lift these caps (the worker already has the bypass path: owner token / per-device admin token). Not built yet: no purchase flow.

## Parked: steps + Android (branch `archive/android-steps`)
Automatic step counting and the Android app were removed from `main` in v1.9.1 (Erik's call: revisit at the App Store /
Play Store stage). The full working state is kept on the branch **`archive/android-steps`** (commit `3b32774`):
- Capacitor shell (`android/`, `capacitor.config.json`) loading the live site, offline page, shell update check (`src/native.ts`)
- native hardware step counter (`TYPE_STEP_COUNTER`, “Physical activity” permission): WorkManager readings ~every 15 min,
  reboot/midnight handling (`StepLedger.kt` + JVM tests), optional always-on foreground service
- `#/android` page (download / install / move data via Backup), native backup save
- CI: `.github/workflows/android.yml` (signed APK, GitHub Release `android-v<version>`, emulator smoke test)

To revive: branch from `archive/android-steps`, rebase on `main` (manual steps now live in kv `stepLog`; the native
cache was kv `steps`), restore the workflow. Signing: the release keystore backup is kept off-repo on the build box
(`~/.grug-fit-keystore`); the Actions secrets `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD` are still set on the repo but unused by `main`. The published release `android-v1.0.0` was deleted.

Kept on `main`: **manual** steps (typed in per day) with the same calorie estimate.
