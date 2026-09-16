package com.framemetrics

import kotlin.math.floor
import kotlin.math.max

/**
 * Accumulates one sampling window of UI frame intervals and JS-thread probe latencies.
 *
 * [recordFrame], [take] and [clear] run on the UI thread. [recordJsLatency] runs on the probe
 * thread, so the JS total is guarded by [lock].
 */
internal class FrameWindow {
  private val lock = Any()
  private var previousFrameNanos = 0L
  private var previousBudgetMs = 0.0
  private var frameCount = 0L
  private var droppedFrames = 0L
  private var durationMs = 0.0
  private var uiStallMs = 0.0
  private var jsStallMs = 0.0

  /** Budget of the latest frame. Read by the probe thread. */
  @Volatile
  var frameBudgetMs = DEFAULT_BUDGET_MS
    private set

  fun recordFrame(frameTimeNanos: Long, budgetMs: Double) {
    val budget = if (budgetMs.isFinite() && budgetMs > 0) budgetMs else DEFAULT_BUDGET_MS
    if (previousFrameNanos != 0L && frameTimeNanos <= previousFrameNanos) return
    if (previousFrameNanos != 0L) {
      val deltaMs = (frameTimeNanos - previousFrameNanos) / NANOS_PER_MS
      // An interval that spans a refresh-rate change is judged against the slower rate.
      val intervalBudget = max(previousBudgetMs, budget)
      val dropped = droppedFrames(deltaMs, intervalBudget)
      frameCount += 1
      durationMs += deltaMs
      if (dropped > 0) {
        droppedFrames += dropped
        uiStallMs += deltaMs - intervalBudget
      }
    }
    previousFrameNanos = frameTimeNanos
    previousBudgetMs = budget
    frameBudgetMs = budget
  }

  fun recordJsLatency(latencyNanos: Long) {
    val overMs = latencyNanos / NANOS_PER_MS - frameBudgetMs
    if (overMs > 0) synchronized(lock) { jsStallMs += overMs }
  }

  /** Returns the window so far and starts the next one. The frame baseline is kept. */
  fun take(): Sample {
    val js = synchronized(lock) { jsStallMs.also { jsStallMs = 0.0 } }
    val sample = Sample(frameCount, droppedFrames, durationMs, uiStallMs, js, frameBudgetMs)
    frameCount = 0L
    droppedFrames = 0L
    durationMs = 0.0
    uiStallMs = 0.0
    return sample
  }

  /** Discards the window and the frame baseline, e.g. across a pause. */
  fun clear() {
    previousFrameNanos = 0L
    previousBudgetMs = 0.0
    take()
  }

  data class Sample(
    val frameCount: Long,
    val droppedFrames: Long,
    val durationMs: Double,
    val uiStallMs: Double,
    val jsStallMs: Double,
    val frameBudgetMs: Double,
  )

  companion object {
    const val DEFAULT_BUDGET_MS = 1000.0 / 60.0
    private const val NANOS_PER_MS = 1_000_000.0

    /**
     * Vsync-aligned drops land on whole multiples of the budget, while adaptive-refresh
     * transitions leave single 1.5x-1.8x intervals (measured on a 120 Hz LTPO panel). Counting
     * from 1.85x keeps real drops and ignores those transitions.
     */
    private const val DROP_TOLERANCE = 0.15

    fun droppedFrames(deltaMs: Double, budgetMs: Double): Long =
      max(0L, floor(deltaMs / budgetMs + DROP_TOLERANCE).toLong() - 1L)
  }
}
