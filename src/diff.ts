import type { FrameMetricsWindow, FrameSnapshot } from './types';

const MS_PER_SECOND = 1000;

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

    refreshRateHz: current.refreshRateHz,
    frameBudgetMs: current.frameBudgetMs,

    worstFrameMsSinceStart: current.worstFrameMs,
    jsQueueLatencyP50MsSinceStart: current.jsQueueLatencyP50Ms,
    jsQueueLatencyP95MsSinceStart: current.jsQueueLatencyP95Ms,
    jsQueueLatencyMaxMsSinceStart: current.jsQueueLatencyMaxMs,
  };
}
