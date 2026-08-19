import type {
  FrameMetricsWindow,
  FrameSnapshot,
  FrameStateWindow,
  StateBucket,
} from './types';

const MS_PER_SECOND = 1000;

/**
 * Difference the per-state buckets, keyed by their composed label.
 *
 * Each bucket divides by its **own** elapsed time rather than the window's.
 * Dividing every bucket by the window would understate all of them by however
 * long the other states were active, and the whole point is that the buckets
 * are comparable with each other and with the global headline.
 *
 * Buckets that saw no frames this window are dropped rather than reported as a
 * row of zeroes — the list answers "what happened just now", and a screen you
 * left five minutes ago is not that.
 */
function diffStates(
  previous: StateBucket[],
  current: StateBucket[]
): FrameStateWindow[] {
  const before = new Map(previous.map((bucket) => [bucket.key, bucket]));

  return current
    .map((bucket) => {
      const prior = before.get(bucket.key);
      const elapsedMs = Math.max(0, bucket.elapsedMs - (prior?.elapsedMs ?? 0));
      const hitchMs = Math.max(0, bucket.hitchMs - (prior?.hitchMs ?? 0));
      const elapsedSeconds = elapsedMs / MS_PER_SECOND;

      return {
        key: bucket.key,
        hitchRatioMs: elapsedSeconds > 0 ? hitchMs / elapsedSeconds : 0,
        frameCount: Math.max(0, bucket.frameCount - (prior?.frameCount ?? 0)),
        droppedFrames: Math.max(
          0,
          bucket.droppedFrames - (prior?.droppedFrames ?? 0)
        ),
        elapsedMs,
      };
    })
    .filter((window) => window.frameCount > 0)
    .sort((a, b) => b.hitchRatioMs - a.hitchRatioMs);
}

/**
 * Difference two snapshots.
 *
 * Kept free of any native import so it stays testable — and so the pure part
 * of the API does not depend on a binary being present.
 *
 * Deltas are clamped at zero. Counters are monotonic natively, so a negative
 * delta only happens when the native module was rebuilt underneath us — a Fast
 * Refresh or a reload in development. Clamping turns that into one short
 * window rather than a wild negative.
 */
export function diff(
  previous: FrameSnapshot,
  current: FrameSnapshot
): FrameMetricsWindow {
  const elapsedMs = Math.max(0, current.elapsedMs - previous.elapsedMs);
  const hitchMs = Math.max(0, current.hitchMs - previous.hitchMs);
  const jsStallMs = Math.max(0, current.jsStallMs - previous.jsStallMs);
  const frameCount = Math.max(0, current.frameCount - previous.frameCount);

  // All three rates share this denominator, which is what makes them
  // comparable. It excludes background pauses: the native clock stops with the
  // sampler, so a window spanning a pause covers only the time we measured.
  const elapsedSeconds = elapsedMs / MS_PER_SECOND;

  return {
    elapsedMs,
    frameCount,
    droppedFrames: Math.max(0, current.droppedFrames - previous.droppedFrames),

    hitchRatioMs: elapsedSeconds > 0 ? hitchMs / elapsedSeconds : 0,
    jsStallRatioMs: elapsedSeconds > 0 ? jsStallMs / elapsedSeconds : 0,
    fps: elapsedSeconds > 0 ? frameCount / elapsedSeconds : 0,

    jsStallCount: Math.max(0, current.jsStallCount - previous.jsStallCount),
    jsProbeCount: Math.max(0, current.jsProbeCount - previous.jsProbeCount),

    outlierCount: Math.max(0, current.outlierCount - previous.outlierCount),
    outlierMs: Math.max(0, current.outlierMs - previous.outlierMs),

    backgroundPauses: Math.max(0, current.pauseCount - previous.pauseCount),
    sampling: current.sampling,

    states: diffStates(previous.states ?? [], current.states ?? []),

    refreshRateHz: current.refreshRateHz,
    frameBudgetMs: current.frameBudgetMs,

    worstFrameMsSinceStart: current.worstFrameMs,
    jsQueueLatencyP50MsSinceStart: current.jsQueueLatencyP50Ms,
    jsQueueLatencyP95MsSinceStart: current.jsQueueLatencyP95Ms,
    jsQueueLatencyMaxMsSinceStart: current.jsQueueLatencyMaxMs,
  };
}
