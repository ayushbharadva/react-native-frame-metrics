package com.framemetrics

import android.app.Activity
import android.os.Handler
import android.os.HandlerThread
import android.view.FrameMetrics
import android.view.Window

/**
 * Where each frame's time actually went.
 *
 * `Choreographer` tells us a frame took 31ms. [FrameMetrics] tells us 19ms of it
 * was layout and measure — which points at the view hierarchy instead of just
 * saying "slow". That is the difference between a symptom and a diagnosis, and
 * nothing on npm exposes it to React Native.
 *
 * ### The listener does not run on the UI thread
 *
 * `addOnFrameMetricsAvailableListener` takes a [Handler], and putting it on the
 * main looper would add per-frame work to the exact thread this library exists
 * to measure — the tool would become part of the problem. It runs on a dedicated
 * [HandlerThread] instead.
 *
 * That thread is why this class keeps its own lock rather than sharing
 * [FrameMetricsModule]'s. The module's lock is held on the UI thread once per
 * frame; letting a background thread contend for it would put stage capture in
 * the UI thread's way. The two locks are never nested — the module reads this
 * one outside its own.
 *
 * ### Values are copied inside the callback
 *
 * The [FrameMetrics] instance handed to the listener is only valid for the
 * duration of the call. Every metric is read into a long there and then.
 */
internal class StageBreakdown {

  private val lock = Any()

  /** Cumulative nanos per stage, indexed by [STAGE_METRICS]. */
  private val totals = LongArray(STAGE_COUNT)

  private var frameCount = 0L

  /**
   * The single worst frame's full breakdown, since the first `start()`.
   *
   * An average tells you the steady state; the worst frame tells you what broke.
   * It cannot be recovered from a diff, so like `worstFrameMs` it is a lifetime
   * value and is named as one on the JS side.
   */
  private var worstTotalNanos = 0L
  private val worstStages = LongArray(STAGE_COUNT)

  /** Frames the system reported as dropped between listener invocations. */
  private var systemDropCount = 0L

  @Volatile private var enabled = true

  private var thread: HandlerThread? = null
  private var handler: Handler? = null

  /** The window we are currently attached to, so detach cannot miss. */
  private var attachedWindow: Window? = null

  private val listener =
    Window.OnFrameMetricsAvailableListener { _, metrics, dropCountSinceLastInvocation ->
      if (!enabled) return@OnFrameMetricsAvailableListener

      // Copy out before the instance goes out of scope.
      val sample = LongArray(STAGE_COUNT)
      for (i in 0 until STAGE_COUNT) {
        sample[i] = metrics.getMetric(STAGE_METRICS[i])
      }
      val total = sample[INDEX_TOTAL]

      synchronized(lock) {
        frameCount++
        systemDropCount += dropCountSinceLastInvocation.toLong()
        for (i in 0 until STAGE_COUNT) totals[i] += sample[i]
        if (total > worstTotalNanos) {
          worstTotalNanos = total
          sample.copyInto(worstStages)
        }
      }
    }

  /**
   * Gate accumulation. [FrameMetricsModule] also detaches the listener when
   * this goes false — skipping the work inside a callback that still fires
   * every frame would make "measure the cost by turning it off" meaningless.
   */
  fun setEnabled(value: Boolean) {
    enabled = value
  }

  fun isEnabled(): Boolean = enabled

  /**
   * Attach to an Activity's window.
   *
   * Idempotent, and detaches from any previous window first. Activity
   * recreation — a rotation, a theme change — produces a brand new window, so
   * the listener has to follow it or stage capture silently stops.
   */
  fun attach(activity: Activity) {
    val window = activity.window ?: return
    if (attachedWindow === window) return
    detach()

    val handlerThread =
      thread
        ?: HandlerThread(THREAD_NAME).also {
          it.start()
          thread = it
          handler = Handler(it.looper)
        }
    if (handler == null) handler = Handler(handlerThread.looper)

    window.addOnFrameMetricsAvailableListener(listener, handler)
    attachedWindow = window
  }

  fun detach() {
    val window = attachedWindow ?: return
    attachedWindow = null
    try {
      window.removeOnFrameMetricsAvailableListener(listener)
    } catch (_: IllegalArgumentException) {
      // Never added, or the window is already gone. Nothing to undo.
    }
  }

  /** Stop the handler thread. Called when the module goes away. */
  fun release() {
    detach()
    thread?.quitSafely()
    thread = null
    handler = null
  }

  fun isAttached(): Boolean = attachedWindow != null

  /**
   * Read the accumulators.
   *
   * Returns `null` when no frame has been measured — either capture is off, or
   * nothing has rendered yet. A caller must be able to tell "no data" from
   * "zero milliseconds", which is the same reason the whole breakdown is null
   * on iOS rather than a row of zeroes.
   */
  fun read(): Reading? = synchronized(lock) {
    if (frameCount == 0L) return null
    Reading(
      frameCount = frameCount,
      systemDropCount = systemDropCount,
      totals = totals.copyOf(),
      worstTotalNanos = worstTotalNanos,
      worstStages = worstStages.copyOf(),
    )
  }

  internal class Reading(
    val frameCount: Long,
    val systemDropCount: Long,
    val totals: LongArray,
    val worstTotalNanos: Long,
    val worstStages: LongArray,
  )

  companion object {
    private const val THREAD_NAME = "frame-metrics-stages"

    /**
     * Stage names as reported to JS, in the same order as [STAGE_METRICS].
     *
     * `swapBuffers` and `commandIssue` are the GPU-side pair. `layoutMeasure` is
     * the React Native hot spot — a deep or unmemoised tree shows up there first.
     */
    val STAGE_NAMES = arrayOf(
      "unknownDelay",
      "inputHandling",
      "animation",
      "layoutMeasure",
      "draw",
      "sync",
      "commandIssue",
      "swapBuffers",
      "total",
    )

    private val STAGE_METRICS = intArrayOf(
      FrameMetrics.UNKNOWN_DELAY_DURATION,
      FrameMetrics.INPUT_HANDLING_DURATION,
      FrameMetrics.ANIMATION_DURATION,
      FrameMetrics.LAYOUT_MEASURE_DURATION,
      FrameMetrics.DRAW_DURATION,
      FrameMetrics.SYNC_DURATION,
      FrameMetrics.COMMAND_ISSUE_DURATION,
      FrameMetrics.SWAP_BUFFERS_DURATION,
      FrameMetrics.TOTAL_DURATION,
    )

    val STAGE_COUNT = STAGE_METRICS.size

    /** `total` is the last entry — it is the whole frame, not one of the parts. */
    val INDEX_TOTAL = STAGE_COUNT - 1
  }
}
