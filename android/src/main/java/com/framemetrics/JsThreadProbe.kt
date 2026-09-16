package com.framemetrics

import android.util.Log
import com.facebook.react.bridge.ReactApplicationContext
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/**
 * Measures how long the JS thread takes to pick up a queued task.
 *
 * A background thread posts a no-op onto the JS thread's message queue and times the wait with
 * one native monotonic clock. React Native fires `requestAnimationFrame` and timers from a
 * UI-thread frame callback, so a JS-side loop also slows down when only the UI thread is blocked;
 * posting straight to the JS queue does not depend on the UI thread.
 *
 * One probe is in flight at a time. A fixed cadence would queue many probes behind one stall and
 * count the same wait repeatedly. Stalls shorter than [intervalMs] that start and end between
 * probes are missed.
 *
 * [start] and [stop] must be called on one thread (the UI thread).
 */
internal class JsThreadProbe(
  private val context: ReactApplicationContext,
  private val intervalMs: Long,
  private val onLatency: (latencyNanos: Long) -> Unit,
) {
  private var run: Run? = null

  fun start() {
    if (run == null) run = Run().also { it.thread.start() }
  }

  fun stop() {
    run?.cancel()
    run = null
  }

  /** State for one start/stop cycle, so a thread that is still exiting cannot disturb the next. */
  private inner class Run {
    @Volatile private var active = true
    private val completion = ArrayBlockingQueue<Long>(1)
    private val generation = AtomicLong()
    val thread = Thread(::loop, THREAD_NAME).apply { isDaemon = true }

    fun cancel() {
      active = false
      thread.interrupt()
    }

    private fun loop() {
      while (active) {
        val probe = generation.incrementAndGet()
        completion.clear()
        val sentAt = System.nanoTime()
        val posted =
          try {
            context.runOnJSQueueThread {
              if (generation.get() == probe) completion.offer(System.nanoTime())
            }
          } catch (_: RuntimeException) {
            false
          }
        if (!posted) {
          Log.w(TAG, "JS queue unavailable; JS stall measurement stopped")
          return
        }
        val ranAt =
          try {
            completion.poll(TIMEOUT_MS, TimeUnit.MILLISECONDS)
          } catch (_: InterruptedException) {
            return
          }
        if (!active) return
        if (ranAt == null) generation.incrementAndGet()
        val latencyNanos = (ranAt ?: System.nanoTime()) - sentAt
        onLatency(latencyNanos)
        val sleepMs = intervalMs - latencyNanos / NANOS_PER_MS
        if (sleepMs > 0) {
          try {
            Thread.sleep(sleepMs)
          } catch (_: InterruptedException) {
            return
          }
        }
      }
    }
  }

  private companion object {
    const val TAG = "FrameMetrics"
    const val THREAD_NAME = "frame-metrics-js-probe"
    const val NANOS_PER_MS = 1_000_000L

    /** Bounds the wait so a dead JS thread cannot hang the probe forever. */
    const val TIMEOUT_MS = 10_000L
  }
}
