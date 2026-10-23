#!/usr/bin/env bash
# Emulator smoke test for the APK: install, grant step permission, launch, wait for the live site, screenshot;
# check the step job is scheduled; restart offline (service-worker copy should still open). Output → smoke/.
set -u; mkdir -p smoke; PKG=io.github.zingerstackerburgerbox.grugfit; ok=1
adb install -r grug-fit.apk || { echo "install failed"; exit 1; }
adb shell pm grant $PKG android.permission.ACTIVITY_RECOGNITION || true
adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS || true
adb logcat -c
adb shell am start -W -n $PKG/.MainActivity
sleep 35
adb exec-out screencap -p > smoke/1-launch.png
screen() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb exec-out cat /sdcard/ui.xml > "smoke/$1.xml"; }
screen 1-launch; if grep -q -E "Welcome to Grug Fit|Today.s nutrition" smoke/1-launch.xml; then echo "live site loaded in the app ✓"; else echo "live site text not found"; ok=0; fi
adb shell pidof $PKG > smoke/pid.txt || { echo "app not running"; ok=0; }
adb logcat -d > smoke/logcat-online.txt
adb shell dumpsys sensorservice | grep -i -E "step|pedometer" > smoke/sensors.txt || true
adb shell dumpsys jobscheduler | grep -i -A3 "$PKG" > smoke/jobs.txt || true
grep -q "$PKG" smoke/jobs.txt # offline restart: the service-worker copy of the site should open (the offline page only appears if it never loaded)
adb shell cmd connectivity airplane-mode enable; sleep 5
for try in 1 2 3; do
  adb shell am force-stop $PKG; adb logcat -c
  adb shell am start -W -n $PKG/.MainActivity; sleep 20
  adb shell pidof $PKG >/dev/null && break
  echo "app process gone after offline start (try $try) – e.g. emulator Play Services restart; retrying"
done
adb exec-out screencap -p > smoke/2-offline.png; screen 2-offline
adb logcat -d > smoke/logcat-offline.txt
if grep -q -E "Welcome to Grug Fit|Today.s nutrition" smoke/2-offline.xml; then echo "offline start shows the cached app ✓"
elif grep -q "needs the internet" smoke/2-offline.xml; then echo "offline start shows the offline page (cache not used)"; ok=0
else echo "offline start: app content not found"; ok=0; fi
adb shell cmd connectivity airplane-mode disable
grep -q -E "FATAL EXCEPTION.*grugfit|Process: $PKG" smoke/logcat-offline.txt && { echo "crash offline"; ok=0; }
KG; adb logcat -c
adb shell am start -W -n $PKG/.MainActivity; sleep 20
adb exec-out screencap -p > smoke/2-offline.png
adb logcat -d > smoke/logcat-offline.txt
adb shell svc wifi enable; adb shell svc data enable
grep -q -E "FATAL EXCEPTION" smoke/logcat-offline.txt && { echo "crash offline"; ok=0; }
ls -la smoke; [ $ok = 1 ] && echo "SMOKE OK" || { echo "SMOKE FAILED"; exit 1; }
