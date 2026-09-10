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
import kotlin.math.abs
import kotlin.math.roundToLong

class FrameMetricsModule(private val context: ReactApplicationContext) :
  NativeFrameMetricsSpec(context), LifecycleEventListener, Choreographer.FrameCallback {
  private val main = Handler(Looper.getMainLooper())
  private var requested = false
  private var sampling = false
  @Volatile private var invalidated = false
  private var previousNanos = 0L
  private var frames = 0L
  private var drops = 0L
  private var durationMs = 0.0
  private var budgetMs = 1000.0 / 60.0

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

  private fun reset() {
    previousNanos = 0L
    frames = 0L
    drops = 0L
    durationMs = 0.0
  }

  private fun resumeSampling() {
    if (sampling || !requested || invalidated) return
    reset()
    sampling = true
    budgetMs = displayBudget()
    Choreographer.getInstance().postFrameCallback(this)
  }

  private fun pauseSampling() {
    sampling = false
    Choreographer.getInstance().removeFrameCallback(this)
    reset()
  }

  private fun displayBudget(): Double {
    val display = context.currentActivity?.window?.decorView?.display
      ?: (context.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager)
        .getDisplay(Display.DEFAULT_DISPLAY)
    val hz = display?.refreshRate?.toDouble() ?: 60.0
    return if (hz.isFinite() && hz > 0) 1000.0 / hz else 1000.0 / 60.0
  }

  override fun doFrame(frameTimeNanos: Long) {
    if (!sampling || invalidated) return
    val nextBudget = displayBudget()
    if (abs(nextBudget - budgetMs) > 0.1) {
      // Discard a mixed-refresh window instead of reporting phantom drops.
      reset()
      budgetMs = nextBudget
    }
    if (previousNanos != 0L && frameTimeNanos > previousNanos) {
      val delta = (frameTimeNanos - previousNanos) / 1_000_000.0
      frames += 1
      durationMs += delta
      drops += ((delta / budgetMs).roundToLong() - 1).coerceAtLeast(0)
    }
    previousNanos = frameTimeNanos
    Choreographer.getInstance().postFrameCallback(this)
  }

  override fun getMetrics(promise: Promise) {
    main.post {
      if (invalidated) {
        promise.reject("E_INVALIDATED", "FrameMetrics has been invalidated")
        return@post
      }
      val result = Arguments.createMap().apply {
        putDouble("frameCount", frames.toDouble())
        putDouble("droppedFrames", drops.toDouble())
        putDouble("durationMs", durationMs)
        putDouble("frameBudgetMs", budgetMs)
      }
      frames = 0L
      drops = 0L
      durationMs = 0.0
      promise.resolve(result)
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

  companion object { const val NAME = NativeFrameMetricsSpec.NAME }
}
