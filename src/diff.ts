import type {
  FrameMetricsWindow,
  FrameSnapshot,
  FrameStages,
  FrameStateWindow,
  StageWindow,
  StateBucket,
} from './types';

const STAGE_KEYS: (keyof FrameStages)[] = [
  'unknownDelay',
  'inputHandling',
  'animation',
  'layoutMeasure',
  'draw',
  'sync',
  'commandIssue',
  'swapBuffers',
  'total',
];

function emptyStages(): FrameStages {
  return {
    unknownDelay: 0,
    inputHandling: 0,
    animation: 0,
    layoutMeasure: 0,
    draw: 0,
    sync: 0,
    commandIssue: 0,
    swapBuffers: 0,
    total: 0,
  };
}

/**
 * Difference the stage accumulators into per-frame averages.
 *
 * Returns `null` whenever there is no data to report — iOS, stage capture off,
 * or nothing rendered yet. Never a row of zeroes: "no measurement" and "zero
 * milliseconds" are different facts, and a caller charting the breakdown has to
 * be able to tell them apart.
 *
 * The divisor is the *stage* listener's own frame count, not the Choreographer
 * frame count. The two differ — the listener attaches later and only counts
 * frames the system actually produced — and dividing by the wrong one would
 * quietly scale every stage.
 */
function diffStages(
  previous: FrameSnapshot['stages'],
  current: FrameSnapshot['stages']
): StageWindow | null {
  if (current === null) return null;

  const frameCount = Math.max(
    0,
    current.frameCount - (previous?.frameCount ?? 0)
  );
  const averageMs = emptyStages();

  if (frameCount > 0) {
    for (const key of STAGE_KEYS) {
      const delta = Math.max(
        0,
        current.totalMs[key] - (previous?.totalMs[key] ?? 0)
      );
      averageMs[key] = delta / frameCount;
    }
  }

  return {
    frameCount,
    systemDropCount: Math.max(
      0,
      current.systemDropCount - (previous?.systemDropCount ?? 0)
    ),
    averageMs,
    worstFrameMsSinceStart: { ...current.worstFrameMs },
  };
}

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
    stages: diffStages(previous.stages ?? null, current.stages ?? null),

    refreshRateHz: current.refreshRateHz,
    frameBudgetMs: current.frameBudgetMs,

    worstFrameMsSinceStart: current.worstFrameMs,
    jsQueueLatencyP50MsSinceStart: current.jsQueueLatencyP50Ms,
    jsQueueLatencyP95MsSinceStart: current.jsQueueLatencyP95Ms,
    jsQueueLatencyMaxMsSinceStart: current.jsQueueLatencyMaxMs,
  };
}
