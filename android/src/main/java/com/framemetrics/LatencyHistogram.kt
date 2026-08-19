package com.framemetrics

/**
 * Fixed-size latency histogram with two resolution tiers.
 *
 * Percentiles need a bounded structure — this runs for the length of a
 * profiling session, so a growing array is not an option.
 *
 * Uniform 1ms buckets would be wrong in both directions: the idle floor is
 * sub-millisecond, so a median would read a useless `0`, while a 2-second stall
 * would need 2000 buckets. Two tiers fix both:
 *
 * | Tier     | Range      | Width  | Buckets |
 * |----------|------------|--------|---------|
 * | 1        | 0–64ms     | 0.25ms | 256     |
 * | 2        | 64–1088ms  | 4ms    | 256     |
 * | overflow | >1088ms    | —      | 1       |
 *
 * Fine resolution around the frame budget, where the decisions actually get
 * made, and graceful degradation past it. ~2KB, allocated once.
 *
 * Not thread-safe. The caller holds the lock — see [FrameMetricsModule].
 */
internal class LatencyHistogram {

  private val tier1 = IntArray(TIER1_BUCKETS)
  private val tier2 = IntArray(TIER2_BUCKETS)
  private var overflow = 0

  private var count = 0L
  private var maxNanos = 0L

  val sampleCount: Long
    get() = count

  val maxMs: Double
    get() = maxNanos / NANOS_PER_MILLI

  fun record(latencyNanos: Long) {
    val clamped = if (latencyNanos < 0L) 0L else latencyNanos
    count++
    if (clamped > maxNanos) maxNanos = clamped

    when {
      clamped < TIER1_LIMIT_NANOS ->
        tier1[(clamped / TIER1_WIDTH_NANOS).toInt()]++
      clamped < TIER2_LIMIT_NANOS ->
        tier2[((clamped - TIER1_LIMIT_NANOS) / TIER2_WIDTH_NANOS).toInt()]++
      else -> overflow++
    }
  }

  /**
   * Value below which [fraction] of samples fall.
   *
   * Returns the **upper edge** of the containing bucket, so the result is an
   * over-estimate bounded by that bucket's width — 0.25ms in tier 1. Reporting
   * the upper edge rather than the midpoint keeps the number conservative: a
   * P95 is never quietly better than reality.
   *
   * Samples in the overflow bucket report [maxMs], the only real value we still
   * hold for them.
   */
  fun percentileMs(fraction: Double): Double {
    if (count == 0L) return 0.0

    // Ceiling, so P50 of a single sample lands on that sample rather than
    // before it.
    val target = Math.ceil(fraction * count).toLong().coerceIn(1L, count)
    var seen = 0L

    for (i in tier1.indices) {
      seen += tier1[i]
      if (seen >= target) {
        return ((i + 1) * TIER1_WIDTH_NANOS) / NANOS_PER_MILLI
      }
    }

    for (i in tier2.indices) {
      seen += tier2[i]
      if (seen >= target) {
        return (TIER1_LIMIT_NANOS + (i + 1) * TIER2_WIDTH_NANOS) / NANOS_PER_MILLI
      }
    }

    return maxMs
  }

  fun reset() {
    tier1.fill(0)
    tier2.fill(0)
    overflow = 0
    count = 0L
    maxNanos = 0L
  }

  private companion object {
    const val NANOS_PER_MILLI = 1_000_000.0

    const val TIER1_BUCKETS = 256
    const val TIER1_WIDTH_NANOS = 250_000L // 0.25ms
    const val TIER1_LIMIT_NANOS = TIER1_BUCKETS * TIER1_WIDTH_NANOS // 64ms

    const val TIER2_BUCKETS = 256
    const val TIER2_WIDTH_NANOS = 4_000_000L // 4ms
    const val TIER2_LIMIT_NANOS =
      TIER1_LIMIT_NANOS + TIER2_BUCKETS * TIER2_WIDTH_NANOS // 1088ms
  }
}
