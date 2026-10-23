package io.github.zingerstackerburgerbox.grugfit.steps

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.time.Duration
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.TimeUnit

/** Takes a reading every ~15 min (Android's minimum; the OS may batch/delay it) and just after midnight, so the
 *  cumulative counter is split into days accurately even when the app isn't opened. No extra battery: the
 *  hardware sensor counts anyway; this only reads it. */
class StepWorker(ctx: Context, p: WorkerParameters) : Worker(ctx, p) {
  override fun doWork(): Result {
    StepStore.sample(applicationContext, background = !AppState.foreground)
    if (inputData.getBoolean("midnight", false)) StepWork.scheduleMidnight(applicationContext)
    return Result.success()
  }
}

object AppState { @Volatile var foreground = false }

object StepWork {
  fun schedule(ctx: Context) {
    if (!StepStore.hasPermission(ctx) || StepStore.sensor(ctx) == null) return
    WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("steps-15min", ExistingPeriodicWorkPolicy.KEEP,
      PeriodicWorkRequestBuilder<StepWorker>(15, TimeUnit.MINUTES).build())
    scheduleMidnight(ctx, ExistingWorkPolicy.KEEP)
    if (StepService.enabled(ctx)) StepService.start(ctx)
  }
  fun scheduleMidnight(ctx: Context, policy: ExistingWorkPolicy = ExistingWorkPolicy.REPLACE) {
    val z = ZoneId.systemDefault(); val next = LocalDate.now(z).plusDays(1).atStartOfDay(z).plusSeconds(30).toInstant()
    val delay = Duration.between(java.time.Instant.now(), next).toMillis().coerceAtLeast(60_000)
    WorkManager.getInstance(ctx).enqueueUniqueWork("steps-midnight", policy,
      OneTimeWorkRequestBuilder<StepWorker>().setInitialDelay(delay, TimeUnit.MILLISECONDS).setInputData(workDataOf("midnight" to true)).build())
  }
}

/** After a reboot the counter restarts at 0: record a reading straight away and re-arm the jobs / always-on counting. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, i: Intent) {
    if (i.action != Intent.ACTION_BOOT_COMPLETED && i.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    val r = goAsync()
    Thread { try { StepStore.sample(ctx, background = true); StepWork.schedule(ctx) } finally { r.finish() } }.start()
  }
}
