#!/usr/bin/env bash
# Emulator smoke test for the release APK → smoke/ (screenshots + logs; uploaded as a CI artifact).
#  1. install, grant step permission, launch online: process alive, our activity in front, no crash, screenshot
#  2. airplane mode, cold start: the service-worker copy of the site should open (offline.html only if it never loaded)
#  3. step sensor / job info (emulators usually have no step-counter sensor, then no job is scheduled – expected)
# WebView text isn't visible to uiautomator in release builds, so page content is checked on the screenshots.
set -u; mkdir -p smoke; PKG=io.github.zingerstackerburgerbox.grugfit; ok=1
front() { adb shell dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity" | grep -q "$PKG/.MainActivity"; }
adb install -r grug-fit.apk || { echo "install failed"; exit 1; }
adb shell pm grant $PKG android.permission.ACTIVITY_RECOGNITION || true
adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS || true
adb logcat -c
adb shell am start -W -n $PKG/.MainActivity
sleep 35
adb exec-out screencap -p > smoke/1-online.png
adb logcat -d > smoke/logcat-online.txt
if adb shell pidof $PKG >/dev/null && front; then echo "online: app running in front ✓"; else echo "online: app not in front"; ok=0; fi
if grep -q "FATAL EXCEPTION" smoke/logcat-online.txt && grep -A2 "FATAL EXCEPTION" smoke/logcat-online.txt | grep -q "$PKG"; then echo "online: crash"; ok=0; fi
adb shell dumpsys sensorservice | grep -i -E "step|pedometer" > smoke/sensors.txt || true
[ -s smoke/sensors.txt ] && echo "step sensor present" || echo "no step-counter sensor on this emulator (expected)"
adb shell dumpsys jobscheduler | grep -i -B1 -A3 "$PKG" > smoke/jobs.txt || true

adb shell cmd connectivity airplane-mode enable; sleep 6
for try in 1 2 3; do
  adb shell am force-stop $PKG; adb logcat -c
  adb shell am start -W -n $PKG/.MainActivity; sleep 25
  adb shell pidof $PKG >/dev/null && front && break
  echo "offline: app not in front after start (try $try) – emulator Play Services restart can kill it; retrying"
done
echo "airplane_mode_on=$(adb shell settings get global airplane_mode_on)"
adb exec-out screencap -p > smoke/2-offline.png
adb logcat -d > smoke/logcat-offline.txt
if adb shell pidof $PKG >/dev/null && front; then echo "offline: app running in front ✓ (see 2-offline.png: app = cached site, dark card 'needs the internet' = offline page)"; else echo "offline: app not in front"; ok=0; fi
if grep -A2 "FATAL EXCEPTION" smoke/logcat-offline.txt | grep -q "$PKG"; then echo "offline: crash"; ok=0; fi
adb shell cmd connectivity airplane-mode disable
ls -la smoke; [ $ok = 1 ] && echo "SMOKE OK" || { echo "SMOKE FAILED"; exit 1; }
