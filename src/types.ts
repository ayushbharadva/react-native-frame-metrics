/**
 * A reading of the native accumulators at one instant.
 *
 * Most fields are monotonic — they only ever grow, across the whole lifetime of
 * the native module. To measure a window, take two snapshots and diff them
 * (see `subscribe`).
 */
export type FrameSnapshot = {
  /** Total time `start()` has been running, in ms. Excludes stopped periods. */
  elapsedMs: number;
  /** Frames delivered by Choreographer. */
  frameCount: number;
  /** Frames inferred as dropped from the gaps between those deliveries. */
  droppedFrames: number;
  /** Sum of per-frame overrun beyond the budget. */
  hitchMs: number;
  /** The panel's refresh rate right now. Adaptive displays change this at runtime. */
  refreshRateHz: number;
  /** `1000 / refreshRateHz` — how long one frame is allowed to take. */
  frameBudgetMs: number;

  /** Sum of JS-thread queue latency beyond the frame budget. */
  jsStallMs: number;
  /** Probes whose latency exceeded the frame budget. */
  jsStallCount: number;
  /** Probes completed. Sanity check on sampling coverage. */
  jsProbeCount: number;

  /** Longest interval between two consecutive frames since the first `start()`. */
  worstFrameMs: number;
  /** Median probe latency since the first `start()`. */
  jsQueueLatencyP50Ms: number;
  /** 95th-percentile probe latency since the first `start()`. */
  jsQueueLatencyP95Ms: number;
  /** Worst single probe latency since the first `start()`. */
  jsQueueLatencyMaxMs: number;
};

/**
 * The difference between two snapshots: what happened during one window.
 *
 * The two headline numbers are `hitchRatioMs` and `jsStallRatioMs`. Both are in
 * **milliseconds per second**, so they sit on the same scale and can be read
 * side by side:
 *
 * ```
 * UI  hitch ratio   14.2 ms/s   <- bad
 * JS  stall ratio    0.4 ms/s   <- fine
 * ```
 *
 * Thresholds for both: <5 good, 5-10 warning, >10 critical.
 */
export type FrameMetricsWindow = {
  /** Wall time covered by this window, in ms. */
  elapsedMs: number;
  /** Frames delivered during the window. */
  frameCount: number;
  /** Frames dropped during the window. */
  droppedFrames: number;

  /**
   * **Headline.** UI-thread stutter per second of wall time, in ms/s.
   *
   * Refresh-rate independent, and meaningful on an idle screen — unlike FPS,
   * which reports a perfect 60 for a screen that drew nothing.
   */
  hitchRatioMs: number;

  /**
   * **Headline.** JS-thread queue wait beyond the frame budget, per second of
   * wall time, in ms/s.
   *
   * Measured by a native probe, not a `setTimeout` drift loop — see
   * `jsEventLoopDriftMs` in `jsDrift.ts` for why that distinction is the whole
   * point of this library.
   */
  jsStallRatioMs: number;

  /** Probes that exceeded the budget during the window. */
  jsStallCount: number;
  /** Probes completed during the window. */
  jsProbeCount: number;

  /** Refresh rate as of the end of the window. */
  refreshRateHz: number;
  /** Frame budget as of the end of the window. */
  frameBudgetMs: number;

  /**
   * Longest frame interval since the first `start()` — **not** windowed.
   *
   * The native side keeps a lifetime maximum, which cannot be recovered from a
   * diff. Windowing this is deferred; see M3.
   */
  worstFrameMsSinceStart: number;
  /** Median probe latency since the first `start()`. Not windowed — a histogram cannot be diffed. */
  jsQueueLatencyP50MsSinceStart: number;
  /** 95th-percentile probe latency since the first `start()`. Not windowed. */
  jsQueueLatencyP95MsSinceStart: number;
  /** Worst probe latency since the first `start()`. Not windowed. */
  jsQueueLatencyMaxMsSinceStart: number;
};
