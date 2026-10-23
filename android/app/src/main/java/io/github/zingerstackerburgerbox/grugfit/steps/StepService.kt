package io.github.zingerstackerburgerbox.grugfit.steps

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import io.github.zingerstackerburgerbox.grugfit.MainActivity
import io.github.zingerstackerburgerbox.grugfit.R
import java.time.LocalDate

/**
 * Optional "always count" mode (Settings › Step counter, off by default): a low-priority foreground service that
 * listens to the step counter with 5-minute hardware batching, so readings keep arriving on phones that withhold
 * sensor events from background jobs. Shows a silent persistent notification "Grug Fit counting steps".
 */
class StepService : Service(), SensorEventListener {
  private var lastWrite = 0L
  override fun onBind(i: Intent?): IBinder? = null

  override fun onStartCommand(i: Intent?, flags: Int, id: Int): Int {
    if (!StepStore.hasPermission(this) || StepStore.sensor(this) == null) { stopSelf(); return START_NOT_STICKY }
    val n = notification(StepStore.ledger(this).stepsOn(LocalDate.now()))
    try {
      if (Build.VERSION.SDK_INT >= 34) startForeground(NID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH) else startForeground(NID, n)
    } catch (e: Exception) { stopSelf(); return START_NOT_STICKY }
    val sm = getSystemService(Context.SENSOR_SERVICE) as SensorManager
    sm.unregisterListener(this); sm.registerListener(this, StepStore.sensor(this), SensorManager.SENSOR_DELAY_NORMAL, 5 * 60 * 1_000_000)
    return START_STICKY
  }

  override fun onSensorChanged(e: SensorEvent) {
    val now = System.currentTimeMillis(); if (now - lastWrite < 60_000) return; lastWrite = now
    StepStore.record(this, e.values[0].toLong(), background = !AppState.foreground)
    getSystemService(NotificationManager::class.java).notify(NID, notification(StepStore.ledger(this).stepsOn(LocalDate.now())))
  }
  override fun onAccuracyChanged(s: Sensor?, a: Int) {}
  override fun onDestroy() { (getSystemService(Context.SENSOR_SERVICE) as SensorManager).unregisterListener(this); super.onDestroy() }

  private fun notification(steps: Long): Notification {
    val nm = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CH) == null)
      nm.createNotificationChannel(NotificationChannel(CH, "Step counting", NotificationManager.IMPORTANCE_MIN).apply { description = "Shown while Grug Fit counts steps in the background"; setShowBadge(false) })
    val pi = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
    return NotificationCompat.Builder(this, CH).setSmallIcon(R.drawable.ic_stat_steps).setContentTitle("Grug Fit counting steps")
      .setContentText("%,d steps today".format(steps)).setOngoing(true).setSilent(true).setPriority(NotificationCompat.PRIORITY_MIN)
      .setContentIntent(pi).build()
  }

  companion object {
    const val NID = 7001; const val CH = "steps"
    fun enabled(ctx: Context) = StepStore.prefs(ctx).getBoolean("alwaysOn", false)
    fun setEnabled(ctx: Context, on: Boolean) { StepStore.prefs(ctx).edit().putBoolean("alwaysOn", on).apply(); if (on) start(ctx) else ctx.stopService(Intent(ctx, StepService::class.java)) }
    fun start(ctx: Context) { try { ContextCompat.startForegroundService(ctx, Intent(ctx, StepService::class.java)) } catch (e: Exception) { /* not allowed from background right now; retried on next app open */ } }
  }
}
