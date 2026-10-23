package io.github.zingerstackerburgerbox.grugfit

import android.os.Bundle
import com.getcapacitor.BridgeActivity
import io.github.zingerstackerburgerbox.grugfit.steps.AppState
import io.github.zingerstackerburgerbox.grugfit.steps.StepWork

/** The Grug Fit web app (live site, see capacitor.config.json) + the GrugNative plugin. */
class MainActivity : BridgeActivity() {
  override fun onCreate(savedInstanceState: Bundle?) { registerPlugin(GrugNativePlugin::class.java); super.onCreate(savedInstanceState) }
  override fun onResume() { super.onResume(); AppState.foreground = true; Thread { StepWork.schedule(applicationContext) }.start() }
  override fun onPause() { AppState.foreground = false; super.onPause() }
}
