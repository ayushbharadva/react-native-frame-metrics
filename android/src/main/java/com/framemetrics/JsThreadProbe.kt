package com.framemetrics

import com.facebook.react.bridge.ReactApplicationContext
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/**
 * Measures JS-thread queueing latency without touching the JS thread's clock.
 *
 * A background thread posts a no-op **Kotlin lambda** onto the JS thread's
 * queue and times how long it waits. Both timestamps come from the same native
 * monotonic clock, so there is no cross-domain arithmetic, and because the task
 * is native there is no JSI allocation, no JS frame and no re-render.
 *
 * This is deliberately *not* a `setTimeout` drift loop. RN dispatches timers
 * from a main-thread frame callback (`JavaTimerManager.kt` uses
 * `TimerFrameCallback : Choreographer.FrameCallback`), so a drift loop reports a
 * JS stall whenever the **UI** thread is blocked — a false positive on exactly
 * the case this library exists to disambiguate.
 * `MessageQueueThreadImpl.runOnQueue` is a plain `handler.post` onto the JS
 * Looper, with no Choreographer anywhere in the path.
 *
 * ### Why only one probe is ever in flight
 *
 * A fixed cadence that ignores completion piles probes up behind a stall, and
 * every one of them counts the same wait. A 2000ms block at 16ms cadence would
 * queue ~125 probes with latencies 2000, 1984, 1968 … 16, summing to roughly
 * 125,000ms of "stall" — a 60x overcount, worst exactly where the number
 * matters most. Waiting for each probe to return means that same block produces
 * one sample of ~2000ms, which is the true answer.
 *
 * Sleeping `interval - latency` rather than a flat `interval` keeps the cadence
 * near [intervalMs] while healthy, and collapses it to zero during a stall so
 * coverage stays continuous instead of sampling the stall once and napping.
 *
 * **Known limitation:** this is a sampled estimate, not an exact integral. A
 * stall that begins and ends entirely inside one sleep window is missed. At a
 * 16ms interval that bounds the blind spot to sub-frame stalls.
 */
internal class JsThreadProbe(
  private val reactContext: ReactApplicationContext,
  private val intervalMs: Long,
  private val onSample: (latencyNanos: Long) -> Unit,
) {

  @Volatile private var running = false
  private var thread: Thread? = null

  /** Holds the completion timestamp of the probe currently in flight. */
  private val completion = ArrayBlockingQueue<Long>(1)

  /**
   * Identifies the in-flight probe. A probe that times out is abandoned; if its
   * runnable eventually executes, this lets it recognise that it is stale and
   * discard its result rather than double-counting.
   */
  private val generation = AtomicLong(0L)

  fun start() {
    if (running) return
    running = true
    thread = Thread(::loop, THREAD_NAME).apply {
      isDaemon = true
      priority = Thread.NORM_PRIORITY
      start()
    }
  }

  fun stop() {
    running = false
    thread?.interrupt()
    thread = null
  }

  private fun loop() {
    while (running) {
      val myGeneration = generation.incrementAndGet()
      completion.clear()

      val sentAt = System.nanoTime()
      val posted =
        try {
          reactContext.runOnJSQueueThread {
            // Discard if this probe was already abandoned as timed out.
            if (generation.get() == myGeneration) {
              completion.offer(System.nanoTime())
            }
          }
        } catch (_: Exception) {
          // The queue thread is gone — the instance is being torn down.
          false
        }

      if (!posted) break

      val ranAt =
        try {
          completion.poll(PROBE_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        } catch (_: InterruptedException) {
          break
        }

      val latencyNanos =
        if (ranAt != null) {
          ranAt - sentAt
        } else {
          // No answer within the timeout. That is itself a sample — the JS
          // thread was unavailable for at least this long. Abandon the probe so
          // a late completion cannot also record it.
          generation.incrementAndGet()
          System.nanoTime() - sentAt
        }

      onSample(latencyNanos)

      val sleepMs = intervalMs - (latencyNanos / NANOS_PER_MILLI)
      if (sleepMs > 0L) {
        try {
          Thread.sleep(sleepMs)
        } catch (_: InterruptedException) {
          break
        }
      }
    }
  }

  private companion object {
    const val THREAD_NAME = "frame-metrics-js-probe"
    const val NANOS_PER_MILLI = 1_000_000L

    /**
     * Generous by design. A probe waiting this long means something is badly
     * wrong; the bound exists so the loop cannot hang forever, not to classify
     * stalls.
     */
    const val PROBE_TIMEOUT_MS = 10_000L
  }
}
