package com.framemetrics

import java.util.TreeMap

/**
 * Buckets frame cost by what the app said it was doing.
 *
 * A global hitch ratio tells you something is wrong. It does not tell you where
 * to look. This is the piece that turns "your app is janky" into "your feed's
 * scroll is janky" — the app labels its states, and every frame is attributed
 * to whichever labels were active when it landed.
 *
 * ### Bucketing is per combination, not per key
 *
 * With `screen=FeedList` and `interaction=scrolling` both active, the frame goes
 * to one bucket named for both. Per-key bucketing would answer "is scrolling
 * janky" and "is FeedList janky" separately, which is strictly less useful: the
 * interesting question is almost always the intersection, and splitting it loses
 * exactly that. The cost is that buckets multiply, which is the other reason
 * [maxBuckets] exists.
 *
 * Keys are composed as `a=1,b=2` with the state keys sorted, so the same set of
 * states always produces the same bucket regardless of the order they were set.
 *
 * ### Not thread-safe on its own
 *
 * Every entry point is called under [FrameMetricsModule]'s lock — [recordFrame]
 * from the UI thread inside the accumulator's critical section, [setState] and
 * [clearState] from the JS thread. Keeping the synchronisation in one place
 * means the state a frame is tagged with and the counters it updates cannot
 * disagree.
 */
internal class StateTracker(private val maxBuckets: Int = MAX_BUCKETS) {

  internal class Bucket {
    var frameCount = 0L
    var droppedFrames = 0L
    var hitchNanos = 0L

    /**
     * Sum of the frame intervals attributed here — the bucket's own denominator.
     *
     * A per-bucket ratio needs per-bucket wall time; dividing a bucket's hitch
     * by the global elapsed would understate every bucket by however long the
     * others were active.
     */
    var elapsedNanos = 0L
  }

  /** Sorted so the composed key is stable across set order. */
  private val active = TreeMap<String, String>()

  private val buckets = LinkedHashMap<String, Bucket>()

  private var currentKey = UNTAGGED

  /** The label frames are being attributed to right now. */
  val activeKey: String
    get() = currentKey

  fun setState(key: String, value: String) {
    if (key.isEmpty()) return
    active[key] = value
    currentKey = composeKey()
  }

  fun clearState(key: String) {
    if (active.remove(key) != null) currentKey = composeKey()
  }

  fun clearAll() {
    active.clear()
    currentKey = UNTAGGED
  }

  /**
   * Attribute one frame to the currently active states.
   *
   * Outlier intervals never reach here: they are excluded from the global hitch
   * accumulators, so letting them into a bucket would make the per-state numbers
   * disagree with the global one.
   */
  fun recordFrame(deltaNanos: Long, dropped: Long, hitchNanos: Long) {
    val bucket = bucketFor(currentKey)
    bucket.frameCount++
    bucket.droppedFrames += dropped
    bucket.hitchNanos += hitchNanos
    bucket.elapsedNanos += deltaNanos
  }

  fun forEachBucket(action: (key: String, bucket: Bucket) -> Unit) {
    buckets.forEach { (key, bucket) -> action(key, bucket) }
  }

  /**
   * The bucket for [key], or the overflow bucket once the cap is reached.
   *
   * Existing buckets are never evicted. Someone will eventually tag with a user
   * id or a timestamp, and evicting would mean the numbers silently changed
   * depending on which states happened to churn — worse than an honest
   * `(other)` row that shows the cardinality is wrong.
   */
  private fun bucketFor(key: String): Bucket {
    buckets[key]?.let { return it }
    if (buckets.size >= maxBuckets) {
      return buckets.getOrPut(OVERFLOW) { Bucket() }
    }
    return buckets.getOrPut(key) { Bucket() }
  }

  private fun composeKey(): String {
    if (active.isEmpty()) return UNTAGGED
    return active.entries.joinToString(",") { "${it.key}=${it.value}" }
  }

  companion object {
    const val UNTAGGED = "(untagged)"
    const val OVERFLOW = "(other)"

    /**
     * Deliberately small. State tagging is meant to be coarse — a screen, an
     * interaction — and a cap this low makes an accidental high-cardinality key
     * show up as a fat `(other)` row almost immediately rather than as a slow
     * leak.
     */
    const val MAX_BUCKETS = 32
  }
}
