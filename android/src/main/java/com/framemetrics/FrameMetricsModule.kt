package com.framemetrics

import android.content.Context
import android.hardware.display.DisplayManager
import android.os.Handler
import android.os.Looper
import android.view.Choreographer
import android.view.Display
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.common.LifecycleState

class FrameMetricsModule(private val context: ReactApplicationContext) :
  NativeFrameMetricsSpec(context), LifecycleEventListener, Choreographer.FrameCallback {
  private val main = Handler(Looper.getMainLooper())
  private val window = FrameWindow()
  private val probe = JsThreadProbe(context, PROBE_INTERVAL_MS, window::recordJsLatency)
  private var requested = false
  private var sampling = false
  @Volatile private var invalidated = false

  init { context.addLifecycleEventListener(this) }

  override fun start() {
    main.post {
      if (!invalidated) {
        requested = true
        if (context.lifecycleState == LifecycleState.RESUMED) resumeSampling()
      }
    }
  }

  override fun stop() {
    main.post { requested = false; pauseSampling() }
  }

  private fun resumeSampling() {
    if (sampling || !requested || invalidated) return
    sampling = true
    window.clear()
    probe.start()
    Choreographer.getInstance().postFrameCallback(this)
  }

  private fun pauseSampling() {
    sampling = false
    Choreographer.getInstance().removeFrameCallback(this)
    probe.stop()
    window.clear()
  }

  private fun displayBudgetMs(): Double {
    val display = context.currentActivity?.window?.decorView?.display
      ?: (context.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager)
        .getDisplay(Display.DEFAULT_DISPLAY)
    val hz = display?.refreshRate?.toDouble() ?: 60.0
    return if (hz.isFinite() && hz > 0) 1000.0 / hz else FrameWindow.DEFAULT_BUDGET_MS
  }

  override fun doFrame(frameTimeNanos: Long) {
    if (!sampling || invalidated) return
    // Re-read every frame: adaptive displays change rate while the app runs.
    window.recordFrame(frameTimeNanos, displayBudgetMs())
    Choreographer.getInstance().postFrameCallback(this)
  }

  override fun getMetrics(promise: Promise) {
    main.post {
      if (invalidated) {
        promise.reject("E_INVALIDATED", "FrameMetrics has been invalidated")
        return@post
      }
      val sample = window.take()
      promise.resolve(Arguments.createMap().apply {
        putDouble("frameCount", sample.frameCount.toDouble())
        putDouble("droppedFrames", sample.droppedFrames.toDouble())
        putDouble("durationMs", sample.durationMs)
        putDouble("uiStallMs", sample.uiStallMs)
        putDouble("jsStallMs", sample.jsStallMs)
        putDouble("frameBudgetMs", sample.frameBudgetMs)
      })
    }
  }

  override fun onHostResume() { main.post { resumeSampling() } }
  override fun onHostPause() { main.post { pauseSampling() } }
  override fun onHostDestroy() { main.post { pauseSampling() } }

  override fun invalidate() {
    invalidated = true
    context.removeLifecycleEventListener(this)
    main.post { requested = false; pauseSampling() }
    super.invalidate()
  }

  companion object {
    const val NAME = NativeFrameMetricsSpec.NAME

    /** Minimum time between JS probes while the JS thread is healthy. */
    private const val PROBE_INTERVAL_MS = 16L
  }
}
