package com.framemetrics

import android.content.Context
import android.content.pm.ApplicationInfo
import android.hardware.display.DisplayManager
import android.view.Choreographer
import android.view.Display
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap
import com.facebook.react.common.LifecycleState
import kotlin.math.max
import kotlin.math.roundToLong

/**
 * Samples the UI thread with a self-reposting [Choreographer.FrameCallback],
 * and the JS thread with a [JsThreadProbe].
 *
 * Drops are inferred from the gap between consecutive frame timestamps rather
 * than from missed callbacks: when the UI thread is blocked — the case worth
 * measuring — the callback does not fire at all, so a drop cannot be observed
 * directly.
 *
 * All counters are monotonic. Nothing is reset natively; callers diff two
 * snapshots to get a window. The exceptions are the lifetime values
 * (`worstFrameMs`, the latency percentiles), which cannot be recovered from a
 * diff and are documented as such.
 *
 * ### Two states, not one
 *
 * [started] is what the caller asked for. [sampling] is whether a frame
 * callback is actually posted. They differ while the app is backgrounded: a
 * posted frame callback forces vsync delivery and stops the display pipeline
 * idling, so leaving it running in the background drains the battery of a
 * device sitting in a pocket. Sampling therefore follows
 * `started && foreground`, and [start] / [stop] only move [started].
 *
 * The elapsed clock pauses with sampling. That is deliberate: both headline
 * ratios divide by elapsed seconds, so letting the clock run through a
 * background gap that produced no frames would silently dilute them and make
 * the next window look better than it was.
 */
class FrameMetricsModule(reactContext: ReactApplicationContext) :
  NativeFrameMetricsSpec(reactContext), LifecycleEventListener {

  /**
   * Guards the accumulators below, which are written from the UI thread
   * ([recordFrame]) and the JS thread ([onProbeSample]) and read from the JS
   * thread ([getSnapshot]). A snapshot must be internally coherent — pairing a
   * frame count from before an update with a drop count from after it would
   * corrupt the caller's diff.
   */
  private val lock = Any()

  private var frameCount = 0L
  private var droppedFrames = 0L
  private var worstFrameNanos = 0L
  private var hitchNanos = 0L

  /** Intervals too long to be jank. See [OUTLIER_FRAME_INTERVAL_NANOS]. */
  private var outlierCount = 0L
  private var outlierNanos = 0L

  private var jsStallNanos = 0L
  private var jsStallCount = 0L
  private val latencyHistogram = LatencyHistogram()

  /** Running time from previous sampling periods. */
  private var accumulatedNanos = 0L

  /** Start of the current sampling period, or 0 when not sampling. */
  private var runStartedAtNanos = 0L

  /** What the caller asked for. Read on the UI thread, written from JS. */
  private var started = false

  /** Number of background pauses. Diagnostic — proves the pause fired. */
  private var pauseCount = 0L

  // UI thread only — never read from JS.
  private var sampling = false
  private var lastFrameTimeNanos = 0L
  private var choreographer: Choreographer? = null

  /**
   * Whether the host activity is resumed. UI thread only: RN dispatches
   * lifecycle callbacks there, and [syncSamplingState] is the only reader.
   *
   * Seeded from the context rather than assumed `true`, so a module created
   * while the host is already paused does not sample into the background until
   * the first callback arrives.
   */
  private var foreground = reactContext.lifecycleState == LifecycleState.RESUMED

  /**
   * Resolved once; [Display.getRefreshRate] is re-read on every frame because
   * the rate is not constant — adaptive panels downclock at runtime and a
   * cached budget would manufacture phantom drops the moment they do.
   *
   * Still [Display.DEFAULT_DISPLAY], which is the wrong display on a foldable's
   * cover screen or when the app is on an external panel. Deferred to M5 rather
   * than fixed here: doing it properly means tracking the current Activity
   * across recreation, which is exactly the reference M5 has to hold anyway for
   * `Window.addOnFrameMetricsAvailableListener`. Solving it twice would be
   * wasted work.
   */
  private val display: Display? =
    (reactContext.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager)
      ?.getDisplay(Display.DEFAULT_DISPLAY)

  private val probe =
    JsThreadProbe(reactContext, PROBE_INTERVAL_MS, ::onProbeSample)

  private val frameCallback = object : Choreographer.FrameCallback {
    override fun doFrame(frameTimeNanos: Long) {
      if (!sampling) return
      choreographer?.postFrameCallback(this)
      recordFrame(frameTimeNanos)
    }
  }

  init {
    reactContext.addLifecycleEventListener(this)
  }

  override fun start() {
    synchronized(lock) { started = true }
    UiThreadUtil.runOnUiThread(::syncSamplingState)
  }

  /** Stop sampling. Counters are retained, not reset. */
  override fun stop() {
    synchronized(lock) { started = false }
    UiThreadUtil.runOnUiThread(::syncSamplingState)
  }

  // --- Lifecycle. RN dispatches all three on the UI thread. ------------------

  override fun onHostResume() {
    foreground = true
    syncSamplingState()
  }

  override fun onHostPause() {
    foreground = false
    syncSamplingState()
  }

  override fun onHostDestroy() {
    foreground = false
    syncSamplingState()
  }

  override fun getSnapshot(): WritableMap {
    val refreshRateHz = currentRefreshRateHz()
    val map = Arguments.createMap()

    synchronized(lock) {
      val elapsedNanos = accumulatedNanos +
        if (runStartedAtNanos != 0L) System.nanoTime() - runStartedAtNanos else 0L

      map.putDouble("elapsedMs", elapsedNanos / NANOS_PER_MILLI)
      map.putDouble("frameCount", frameCount.toDouble())
      map.putDouble("droppedFrames", droppedFrames.toDouble())
      map.putDouble("hitchMs", hitchNanos / NANOS_PER_MILLI)
      map.putDouble("worstFrameMs", worstFrameNanos / NANOS_PER_MILLI)

      map.putDouble("outlierCount", outlierCount.toDouble())
      map.putDouble("outlierMs", outlierNanos / NANOS_PER_MILLI)
      map.putDouble("pauseCount", pauseCount.toDouble())
      map.putBoolean("sampling", runStartedAtNanos != 0L)
      map.putBoolean("started", started)

      map.putDouble("jsStallMs", jsStallNanos / NANOS_PER_MILLI)
      map.putDouble("jsStallCount", jsStallCount.toDouble())
      map.putDouble("jsProbeCount", latencyHistogram.sampleCount.toDouble())
      map.putDouble("jsQueueLatencyP50Ms", latencyHistogram.percentileMs(0.50))
      map.putDouble("jsQueueLatencyP95Ms", latencyHistogram.percentileMs(0.95))
      map.putDouble("jsQueueLatencyMaxMs", latencyHistogram.maxMs)
    }

    map.putDouble("refreshRateHz", refreshRateHz)
    map.putDouble("frameBudgetMs", MILLIS_PER_SECOND / refreshRateHz)
    return map
  }

  /**
   * Sleeps the UI thread so the acceptance fixture has a deterministic stimulus.
   *
   * **Testing only. Must be removed before publishing — M11 checklist item.**
   *
   * Gated on the *consuming app's* debuggable flag rather than the library's
   * `BuildConfig.DEBUG`: that reflects the app actually running this code, and
   * it needs no `buildFeatures.buildConfig` change in the library's Gradle.
   *
   * Note this method is deliberately **asynchronous**. A synchronous version
   * would block the JS thread waiting on the UI thread, which would make
   * `jsStallRatioMs` rise during a pure UI-thread block and destroy row 2 of
   * the acceptance test — the fixture would fabricate the exact false positive
   * the library exists to avoid.
   */
  override fun unstable_blockUiThreadForTesting(ms: Double) {
    if (!isDebuggable) return
    val durationMs = ms.toLong()
    if (durationMs <= 0L) return

    UiThreadUtil.runOnUiThread {
      try {
        Thread.sleep(durationMs)
      } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
      }
    }
  }

  override fun invalidate() {
    reactApplicationContext.removeLifecycleEventListener(this)
    stop()
    super.invalidate()
  }

  // --- Sampling state machine. UI thread only. -------------------------------

  private fun syncSamplingState() {
    val shouldSample = synchronized(lock) { started } && foreground
    if (shouldSample == sampling) return
    if (shouldSample) resumeSampling() else pauseSampling()
  }

  private fun resumeSampling() {
    sampling = true
    // Drop the stale timestamp so the gap across a stop or a background pause
    // is not counted as dropped frames. The first callback after this
    // establishes a fresh baseline.
    lastFrameTimeNanos = 0L
    synchronized(lock) { runStartedAtNanos = System.nanoTime() }
    probe.start()
    choreographer = Choreographer.getInstance().also {
      it.postFrameCallback(frameCallback)
    }
  }

  private fun pauseSampling() {
    sampling = false
    choreographer?.removeFrameCallback(frameCallback)
    lastFrameTimeNanos = 0L
    probe.stop()
    synchronized(lock) {
      if (runStartedAtNanos != 0L) {
        accumulatedNanos += System.nanoTime() - runStartedAtNanos
        runStartedAtNanos = 0L
      }
      // Only a background pause is interesting; a caller's stop() is not.
      if (started) pauseCount++
    }
  }

  // --- Accumulation ----------------------------------------------------------

  private fun recordFrame(frameTimeNanos: Long) {
    val budgetNanos = NANOS_PER_SECOND / currentRefreshRateHz()

    val previous = lastFrameTimeNanos
    lastFrameTimeNanos = frameTimeNanos

    // The first callback of a run establishes the baseline: it is a delivered
    // frame, but there is no interval behind it yet to judge.
    val deltaNanos = if (previous == 0L) 0L else frameTimeNanos - previous

    // A gap this long is not the UI thread being slow, it is the UI thread not
    // existing for a while — a frozen process, doze, or a lifecycle transition
    // this module did not see. Counting it as jank would report thousands of
    // ms/s of hitch for something the app never did. Bucketed rather than
    // discarded, so the reading stays visible instead of vanishing.
    //
    // This is a backstop, not the mechanism. Backgrounding is handled by the
    // lifecycle pause above, which resets the baseline so no gap is ever
    // measured. The threshold sits well above any stall worth reporting — the
    // acceptance matrix's worst case is 2000ms — precisely so that a genuine
    // multi-second block is still counted as the jank it is.
    if (deltaNanos > OUTLIER_FRAME_INTERVAL_NANOS) {
      synchronized(lock) {
        frameCount++
        outlierCount++
        outlierNanos += deltaNanos
      }
      return
    }

    val dropped =
      if (deltaNanos == 0L) 0L
      else max(0L, (deltaNanos / budgetNanos).roundToLong() - 1L)
    val hitch = max(0.0, deltaNanos - budgetNanos)

    synchronized(lock) {
      frameCount++
      droppedFrames += dropped
      hitchNanos += hitch.toLong()
      if (deltaNanos > worstFrameNanos) worstFrameNanos = deltaNanos
    }
  }

  /** Runs on the JS thread, as the probe's completion task. */
  private fun onProbeSample(latencyNanos: Long) {
    val budgetNanos = NANOS_PER_SECOND / currentRefreshRateHz()
    val over = latencyNanos - budgetNanos

    synchronized(lock) {
      latencyHistogram.record(latencyNanos)
      if (over > 0.0) {
        jsStallNanos += over.toLong()
        jsStallCount++
      }
    }
  }

  private fun currentRefreshRateHz(): Double {
    val rate = display?.refreshRate?.toDouble() ?: 0.0
    return if (rate > 0.0) rate else FALLBACK_REFRESH_RATE_HZ
  }

  private val isDebuggable: Boolean
    get() =
      (reactApplicationContext.applicationInfo.flags and
        ApplicationInfo.FLAG_DEBUGGABLE) != 0

  companion object {
    const val NAME = NativeFrameMetricsSpec.NAME

    private const val NANOS_PER_MILLI = 1_000_000.0
    private const val NANOS_PER_SECOND = 1_000_000_000.0
    private const val MILLIS_PER_SECOND = 1_000.0

    /** Only used if the platform reports no rate at all. */
    private const val FALLBACK_REFRESH_RATE_HZ = 60.0

    /**
     * A floor on cadence when the JS thread is healthy, not a fixed rate — the
     * probe sleeps `interval - latency`, so it re-arms immediately during a
     * stall. Roughly one frame at 60Hz.
     */
    private const val PROBE_INTERVAL_MS = 16L

    /**
     * Frame intervals longer than this are bucketed as outliers rather than
     * counted as jank.
     *
     * Five seconds is Android's own ANR window for input dispatch: a foreground
     * app that blocks its UI thread this long is killed, not measured. So a gap
     * beyond it means the process was not running, which is a different fact
     * from a slow frame and is reported as one.
     */
    private const val OUTLIER_FRAME_INTERVAL_NANOS = 5_000_000_000L
  }
}
