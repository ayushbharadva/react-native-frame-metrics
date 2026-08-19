import { TurboModuleRegistry, type TurboModule } from 'react-native';

/**
 * Where a frame's time went, split into the stages Android reports.
 *
 * All values in milliseconds. `total` is the whole frame, not one of the parts —
 * the others should roughly sum to it.
 *
 * | Stage | Meaning |
 * |---|---|
 * | `unknownDelay` | Waiting for the UI thread to become responsive. Should be ~0. |
 * | `inputHandling` | Input processing |
 * | `animation` | Animation callbacks |
 * | `layoutMeasure` | Layout and measure — **the React Native hot spot** |
 * | `draw` | Building display lists |
 * | `sync` | Sync with the render thread |
 * | `commandIssue` | Issuing GPU draw commands |
 * | `swapBuffers` | Handing the buffer to the compositor |
 * | `total` | Total time taken to produce the frame |
 */
export type FrameStages = {
  unknownDelay: number;
  inputHandling: number;
  animation: number;
  layoutMeasure: number;
  draw: number;
  sync: number;
  commandIssue: number;
  swapBuffers: number;
  total: number;
};

/**
 * Android `FrameMetrics` accumulators.
 *
 * **Android only.** `stages` is `null` on iOS, where no equivalent API exists —
 * not zeroes, and not an approximation.
 */
export type NativeStages = {
  /** Frames the stage listener saw. Lower than `frameCount`; it starts later. */
  frameCount: number;
  /** Frames the system reported dropped between listener invocations. */
  systemDropCount: number;
  /** Cumulative time per stage. Diff two of these for a window average. */
  totalMs: FrameStages;
  /** The single worst frame's full breakdown, since the first `start()`. */
  worstFrameMs: FrameStages;
};

/**
 * One state combination's share of the frame cost.
 *
 * `key` is the composed label — `screen=FeedList,interaction=scrolling`, with
 * the state keys sorted so the same set always produces the same bucket. Two
 * reserved keys: `(untagged)` for frames that landed while nothing was labelled,
 * and `(other)` for everything past the bucket cap.
 */
export type NativeStateBucket = {
  key: string;
  frameCount: number;
  droppedFrames: number;
  hitchMs: number;
  /** Sum of frame intervals attributed here — this bucket's own denominator. */
  elapsedMs: number;
};

/**
 * Raw counters read straight off the native accumulators.
 *
 * The counters are monotonic and never reset natively — callers diff two
 * snapshots to get a window. The exceptions are noted below: they are values
 * that cannot be recovered from a diff.
 *
 * See src/types.ts for the diffed shape.
 */
export type NativeFrameSnapshot = {
  elapsedMs: number;
  frameCount: number;
  droppedFrames: number;
  refreshRateHz: number;
  frameBudgetMs: number;

  /** Sum of per-frame overrun beyond the budget. Drives `hitchRatioMs`. */
  hitchMs: number;

  /** Sum of probe latency beyond the budget. Drives `jsStallRatioMs`. */
  jsStallMs: number;
  /** Probes whose latency exceeded the frame budget. */
  jsStallCount: number;
  /** Probes completed. Sanity check on sampling coverage. */
  jsProbeCount: number;

  /** Frame intervals too long to be jank — see `outlierMs`. */
  outlierCount: number;
  /**
   * Total time inside those intervals.
   *
   * Excluded from `hitchMs` and `worstFrameMs`. A gap beyond five seconds means
   * the process was not running rather than that a frame was slow, so counting
   * it as jank would report thousands of ms/s for something the app never did.
   * Bucketed rather than discarded so it stays auditable.
   */
  outlierMs: number;

  // --- Sampling state. Not counters; the current value, not a total.
  /** Times sampling auto-paused because the app went to the background. */
  pauseCount: number;
  /** Whether a frame callback is posted right now. False while backgrounded. */
  sampling: boolean;
  /** Whether `start()` is in effect. Stays true across a background pause. */
  started: boolean;

  /** Per-state-combination buckets. Monotonic, like the global counters. */
  states: NativeStateBucket[];

  /** Android `FrameMetrics`. `null` on iOS, or before the first frame lands. */
  stages: NativeStages | null;

  /**
   * The label frames are being attributed to right now — a current value, not
   * a counter. `(untagged)` when nothing is set.
   */
  currentStateKey: string;

  // --- Lifetime values. Not diffable; a histogram and a max cannot be
  // --- subtracted. Reported since the first start().
  worstFrameMs: number;
  jsQueueLatencyP50Ms: number;
  jsQueueLatencyP95Ms: number;
  jsQueueLatencyMaxMs: number;
};

export interface Spec extends TurboModule {
  start(): void;
  stop(): void;
  getSnapshot(): NativeFrameSnapshot;

  /** Label what the app is doing. Frames are attributed to every active label. */
  setState(key: string, value: string): void;
  /** Remove one label. */
  clearState(key: string): void;

  /** Turn the per-frame stage listener on or off. On by default. Android only. */
  setStageCaptureEnabled(enabled: boolean): void;

  /**
   * Sleeps the UI thread. **Testing only — must not ship.**
   *
   * This exists so the 2x2 acceptance fixture can block the UI thread with a
   * controlled, deterministic stimulus. It is a no-op outside a debug build.
   *
   * Removal is a blocking checklist item for M11. If you are reading this in a
   * published release, that is a bug.
   */
  unstable_blockUiThreadForTesting(ms: number): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('FrameMetrics');
