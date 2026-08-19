import { TurboModuleRegistry, type TurboModule } from 'react-native';

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
