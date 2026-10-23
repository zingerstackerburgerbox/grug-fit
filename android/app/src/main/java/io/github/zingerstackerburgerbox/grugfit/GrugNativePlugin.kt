package io.github.zingerstackerburgerbox.grugfit

import android.Manifest
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import androidx.core.content.FileProvider
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import io.github.zingerstackerburgerbox.grugfit.steps.StepService
import io.github.zingerstackerburgerbox.grugfit.steps.StepStore
import io.github.zingerstackerburgerbox.grugfit.steps.StepWork
import java.io.File

/** Bridge for the web app (window.Capacitor.Plugins.GrugNative): step counter, saving files, app version. */
@CapacitorPlugin(name = "GrugNative", permissions = [
  Permission(alias = "activity", strings = [Manifest.permission.ACTIVITY_RECOGNITION]),
  Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS]),
])
class GrugNativePlugin : Plugin() {
  private fun bg(call: PluginCall, f: () -> Unit) = Thread { try { f() } catch (e: Exception) { call.reject(e.message ?: "error") } }.start()

  @PluginMethod fun info(call: PluginCall) {
    val pi = context.packageManager.getPackageInfo(context.packageName, 0)
    call.resolve(JSObject().put("versionName", pi.versionName).put("versionCode", if (Build.VERSION.SDK_INT >= 28) pi.longVersionCode else pi.versionCode.toLong()).put("sdk", Build.VERSION.SDK_INT)
      .put("device", "${Build.MANUFACTURER} ${Build.MODEL}"))
  }

  private fun activityState(): String = if (Build.VERSION.SDK_INT < 29) "granted" else getPermissionState("activity").toString().lowercase()
  private fun status(): JSObject {
    val l = StepStore.ledger(context)
    return JSObject().put("sensor", StepStore.sensor(context) != null).put("permission", activityState())
      .put("alwaysOn", StepService.enabled(context)).put("notifications", if (Build.VERSION.SDK_INT < 33) "granted" else getPermissionState("notifications").toString().lowercase())
      .put("readings", l.readings).put("bgReadings", l.bgReadings).put("lastBgT", l.lastBgT).put("lastT", l.lastT).put("lostReboots", l.lostReboots)
  }
  @PluginMethod fun stepStatus(call: PluginCall) = call.resolve(status())

  @PluginMethod fun requestStepPermission(call: PluginCall) {
    if (Build.VERSION.SDK_INT < 29 || getPermissionState("activity") == PermissionState.GRANTED) { afterGrant(call); return }
    requestPermissionForAlias("activity", call, "onActivityPerm")
  }
  @PermissionCallback private fun onActivityPerm(call: PluginCall) { if (getPermissionState("activity") == PermissionState.GRANTED) afterGrant(call) else call.resolve(status()) }
  private fun afterGrant(call: PluginCall) = bg(call) { StepStore.sample(context, false); StepWork.schedule(context); call.resolve(status()) }

  /** take a reading now (app open / resume) and return totals for the last `days` days + recent segments */
  @PluginMethod fun steps(call: PluginCall) = bg(call) {
    if (call.getBoolean("sample", true) == true) StepStore.sample(context, false)
    val l = StepStore.ledger(context); val n = call.getInt("days", 30) ?: 30
    val days = JSObject(); l.days.entries.toList().takeLast(n).forEach { days.put(it.key, it.value) }
    val segs = JSArray(); l.segs.forEach { segs.put(JSArray().put(it.t0).put(it.t1).put(it.steps)) }
    call.resolve(status().put("days", days).put("segs", segs))
  }

  @PluginMethod fun setAlwaysOn(call: PluginCall) {
    val on = call.getBoolean("enabled", false) == true
    if (on && Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) { requestPermissionForAlias("notifications", call, "onNotifPerm"); return }
    StepService.setEnabled(context, on); call.resolve(status())
  }
  @PermissionCallback private fun onNotifPerm(call: PluginCall) { StepService.setEnabled(context, true); call.resolve(status()) } // runs without the permission too (notification hidden)

  @PluginMethod fun openAppSettings(call: PluginCall) {
    activity.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))); call.resolve()
  }

  /** WebView can't download blobs: save text (e.g. a backup) to Downloads (Android 10+) or offer the share sheet. */
  @PluginMethod fun saveFile(call: PluginCall) = bg(call) {
    val name = call.getString("name") ?: "grugfit.json"; val data = call.getString("data") ?: ""; val mime = call.getString("mime") ?: "application/json"
    if (call.getBoolean("share", false) != true && Build.VERSION.SDK_INT >= 29) {
      val v = ContentValues().apply { put(MediaStore.Downloads.DISPLAY_NAME, name); put(MediaStore.Downloads.MIME_TYPE, mime); put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS) }
      val uri = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v) ?: throw Exception("Could not create the file")
      context.contentResolver.openOutputStream(uri)!!.use { it.write(data.toByteArray()) }
      call.resolve(JSObject().put("saved", "Downloads/$name"))
    } else {
      val f = File(context.cacheDir, name).apply { writeText(data) }
      val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", f)
      val send = Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      activity.runOnUiThread { activity.startActivity(Intent.createChooser(send, name)) }
      call.resolve(JSObject().put("shared", true))
    }
  }
}
