package com.framemetrics

import org.junit.Assert.assertEquals
import org.junit.Test

class FrameWindowTest {
  private val hz120 = 1000.0 / 120
  private val hz60 = 1000.0 / 60
  private val hz24 = 1000.0 / 24

  /** Records frames at the given millisecond timestamps, all with one budget. */
  private fun FrameWindow.frames(budgetMs: Double, vararg atMs: Double) {
    for (ms in atMs) recordFrame(nanos(ms), budgetMs)
  }

  private fun nanos(ms: Double) = (ms * 1_000_000).toLong() + BASE_NANOS

  @Test
  fun steadyFramesHaveNoDropsOrStall() {
    val window = FrameWindow()
    window.frames(hz120, *DoubleArray(121) { it * hz120 })
    val sample = window.take()
    assertEquals(120, sample.frameCount)
    assertEquals(0, sample.droppedFrames)
    assertEquals(0.0, sample.uiStallMs, 0.0)
    assertEquals(1000.0, sample.durationMs, 0.01)
    assertEquals(hz120, sample.frameBudgetMs, 1e-9)
  }

  @Test
  fun wholeMissedFramesAreDropsAndStall() {
    val window = FrameWindow()
    window.frames(hz60, 0.0, hz60, 3 * hz60)
    val sample = window.take()
    assertEquals(1, sample.droppedFrames)
    assertEquals(hz60, sample.uiStallMs, 0.01)
  }

  @Test
  fun longFreezeCountsAgainstTheIdleRate() {
    val window = FrameWindow()
    window.frames(hz24, 0.0, 2000.0)
    val sample = window.take()
    assertEquals(47, sample.droppedFrames)
    assertEquals(2000 - hz24, sample.uiStallMs, 0.01)
  }

  @Test
  fun refreshTransitionIntervalsAreNotDrops() {
    // Intervals recorded on a 120 Hz LTPO panel while it changed rate.
    val window = FrameWindow()
    window.frames(hz60, 0.0, 25.33, 50.34)
    window.frames(hz24, 125.36)
    val sample = window.take()
    assertEquals(0, sample.droppedFrames)
    assertEquals(0.0, sample.uiStallMs, 0.0)
    assertEquals(3, sample.frameCount)
  }

  @Test
  fun intervalAcrossARateChangeUsesTheSlowerRate() {
    val window = FrameWindow()
    window.recordFrame(nanos(0.0), hz24)
    window.recordFrame(nanos(75.12), hz120)
    assertEquals(0, window.take().droppedFrames)

    window.recordFrame(nanos(2075.12), hz24)
    window.recordFrame(nanos(4075.12), hz120)
    val sample = window.take()
    assertEquals(47 + 47, sample.droppedFrames)
    assertEquals(hz120, sample.frameBudgetMs, 1e-9)
  }

  @Test
  fun takeKeepsTheBaselineAndClearDropsIt() {
    val window = FrameWindow()
    window.frames(hz60, 0.0, hz60)
    window.take()
    window.frames(hz60, 3 * hz60)
    assertEquals(1, window.take().droppedFrames)

    window.clear()
    window.frames(hz60, 5000.0)
    val sample = window.take()
    assertEquals(0, sample.frameCount)
    assertEquals(0.0, sample.durationMs, 0.0)
  }

  @Test
  fun jsLatencyBeyondTheCurrentBudgetIsStall() {
    val window = FrameWindow()
    window.frames(hz120, 0.0)
    window.recordJsLatency(5_000_000)
    window.recordJsLatency(508_333_333)
    assertEquals(500.0, window.take().jsStallMs, 0.01)
    assertEquals(0.0, window.take().jsStallMs, 0.0)
  }

  @Test
  fun invalidBudgetsFallBackToSixtyHertzAndOldTimestampsAreIgnored() {
    val window = FrameWindow()
    window.recordFrame(nanos(0.0), Double.NaN)
    window.recordFrame(nanos(-5.0), 0.0)
    window.recordFrame(nanos(hz60), -1.0)
    val sample = window.take()
    assertEquals(hz60, sample.frameBudgetMs, 1e-9)
    assertEquals(1, sample.frameCount)
    assertEquals(hz60, sample.durationMs, 0.01)
  }

  private companion object {
    const val BASE_NANOS = 3_755_000_000_000L
  }
}
