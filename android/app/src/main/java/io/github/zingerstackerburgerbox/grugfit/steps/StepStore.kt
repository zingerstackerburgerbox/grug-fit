package io.github.zingerstackerburgerbox.grugfit.steps

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.HandlerThread
import android.os.Handler
import android.os.SystemClock
import android.provider.Settings
import androidx.core.content.ContextCompat
import java.time.ZoneId
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Persists the [StepLedger] (SharedPreferences) and takes one-off readings of the hardware step counter. */
object StepStore {
  private const val PREFS = "grug_steps"; private const val KEY = "ledger"
  private val lock = Any()

  fun sensor(ctx: Context): Sensor? = (ctx.getSystemService(Context.SENSOR_SERVICE) as SensorManager).getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
  fun hasPermission(ctx: Context) = Build.VERSION.SDK_INT < 29 || ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED
  fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  fun ledger(ctx: Context): StepLedger = synchronized(lock) { StepLedger.fromJson(prefs(ctx).getString(KEY, null)) }
  fun bootCount(ctx: Context) = try { Settings.Global.getInt(ctx.contentResolver, Settings.Global.BOOT_COUNT) } catch (e: Exception) { -1 }

  /** add one counter value to the ledger; returns steps added */
  fun record(ctx: Context, counter: Long, background: Boolean): Long = synchronized(lock) {
    val l = StepLedger.fromJson(prefs(ctx).getString(KEY, null)); val now = System.currentTimeMillis()
    val added = l.record(counter, bootCount(ctx), now, now - SystemClock.elapsedRealtime(), ZoneId.systemDefault(), background)
    prefs(ctx).edit().putString(KEY, l.toJson().toString()).apply(); added
  }

  /** Read the cumulative counter once (the sensor reports its current value shortly after registering). Null if no sensor,
   *  no permission, or no value within the timeout (some phones withhold sensor events from apps in the background). */
  fun readCounter(ctx: Context, timeoutMs: Long = 4000): Long? {
    if (!hasPermission(ctx)) return null
    val s = sensor(ctx) ?: return null
    val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    val th = HandlerThread("step-read").apply { start() }; val latch = CountDownLatch(1); var v: Long? = null
    val l = object : SensorEventListener {
      override fun onSensorChanged(e: SensorEvent) { if (v == null) { v = e.values[0].toLong(); latch.countDown() } }
      override fun onAccuracyChanged(sn: Sensor?, a: Int) {}
    }
    return try { sm.registerListener(l, s, SensorManager.SENSOR_DELAY_FASTEST, Handler(th.looper)); latch.await(timeoutMs, TimeUnit.MILLISECONDS); v }
    finally { sm.unregisterListener(l); th.quitSafely() }
  }

  fun sample(ctx: Context, background: Boolean): Long? { val c = readCounter(ctx) ?: return null; record(ctx, c, background); return c }
}
