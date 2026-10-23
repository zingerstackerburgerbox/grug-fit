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
adb shell pidof $PKG > smoke/pid.txt || { echo "app not running"; ok=0; }
adb logcat -d > smoke/logcat-online.txt
adb shell dumpsys sensorservice | grep -i -E "step|pedometer" > smoke/sensors.txt || true
adb shell dumpsys jobscheduler | grep -i -A3 "$PKG" > smoke/jobs.txt || true
grep -q "$PKG" smoke/jobs.txt && echo "step job scheduled ✓" || echo "step job not seen in jobscheduler"
grep -E "Capacitor|chromium" smoke/logcat-online.txt | grep -i -E "grug|console|error" | head -40 > smoke/console-online.txt || true
if grep -q -E "FATAL EXCEPTION" smoke/logcat-online.txt; then echo "crash in logcat"; ok=0; fi
# offline restart: the service worker copy of the site should open (or the offline page if never loaded)
adb shell svc wifi disable; adb shell svc data disable; sleep 3
adb shell am force-stop $PKG; adb logcat -c
adb shell am start -W -n $PKG/.MainActivity; sleep 20
adb exec-out screencap -p > smoke/2-offline.png
adb logcat -d > smoke/logcat-offline.txt
adb shell svc wifi enable; adb shell svc data enable
grep -q -E "FATAL EXCEPTION" smoke/logcat-offline.txt && { echo "crash offline"; ok=0; }
ls -la smoke; [ $ok = 1 ] && echo "SMOKE OK" || { echo "SMOKE FAILED"; exit 1; }
