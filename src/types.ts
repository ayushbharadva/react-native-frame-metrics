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
 * A frame-stage reading, averaged over a window.
 *
 * **Android only — `null` on iOS.** There is no public iOS equivalent of
 * `FrameMetrics`, so rather than approximate one or return zeroes, the whole
 * object is absent and the type says so.
 */
export type StageWindow = {
  /** Frames the stage listener saw during the window. */
  frameCount: number;
  /** Frames the system reported dropped during the window. */
  systemDropCount: number;

  /**
   * Mean time per stage across the window's frames.
   *
   * This is the steady state — where the time goes on a typical frame. Read
   * `worstFrameMsSinceStart` for what broke.
   */
  averageMs: FrameStages;

  /**
   * The single worst frame's full breakdown since the first `start()` — **not**
   * windowed.
   *
   * A maximum cannot be recovered from a diff. More actionable than the average:
   * an average of 4ms layout hides one 58ms frame, and the 58ms frame is the bug.
   */
  worstFrameMsSinceStart: FrameStages;
};

/**
 * One state combination's share of the frame cost, as read from native.
 *
 * `key` is the composed label — `screen=FeedList,interaction=scrolling`, state
 * keys sorted so the same set always maps to the same bucket. `(untagged)` and
 * `(other)` are reserved: nothing was labelled, and past the bucket cap.
 */
export type StateBucket = {
  key: string;
  frameCount: number;
  droppedFrames: number;
  hitchMs: number;
  /** Sum of frame intervals attributed here — this bucket's own denominator. */
  elapsedMs: number;
};

/**
 * What one state combination cost during a window.
 *
 * `hitchRatioMs` uses the bucket's own elapsed time, not the window's, so the
 * buckets are comparable with each other and with the global headline number:
 *
 * ```
 * screen=FeedList,interaction=scrolling  14.2 ms/s   <- go look here
 * screen=FeedList,interaction=idle        0.3 ms/s
 * screen=Profile                          0.0 ms/s
 * ```
 */
export type FrameStateWindow = {
  /** The composed state label this bucket covers. */
  key: string;
  /** Stutter per second of time spent in this state, in ms/s. */
  hitchRatioMs: number;
  /** Frames that landed while this state was active. */
  frameCount: number;
  /** Frames dropped while this state was active. */
  droppedFrames: number;
  /** Time attributed to this state during the window, in ms. */
  elapsedMs: number;
};

/**
 * A reading of the native accumulators at one instant.
 *
 * Most fields are monotonic — they only ever grow, across the whole lifetime of
 * the native module. To measure a window, take two snapshots and diff them
 * (see `subscribe`).
 */
export type FrameSnapshot = {
  /**
   * Total time sampling has been running, in ms.
   *
   * Excludes stopped periods *and* periods auto-paused in the background. Both
   * headline ratios divide by this, so letting it run through a gap that
   * produced no frames would silently flatter the next window.
   */
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

  /** Frame intervals too long to be jank, bucketed out of `hitchMs`. */
  outlierCount: number;
  /** Total time inside those intervals. */
  outlierMs: number;

  /** Times sampling auto-paused because the app went to the background. */
  pauseCount: number;
  /** Whether a frame callback is posted right now. False while backgrounded. */
  sampling: boolean;
  /** Whether `start()` is in effect. Stays true across a background pause. */
  started: boolean;

  /** Per-state-combination buckets. Monotonic, like the global counters. */
  states: StateBucket[];

  /** Raw Android `FrameMetrics` accumulators. `null` on iOS. */
  stages: {
    frameCount: number;
    systemDropCount: number;
    totalMs: FrameStages;
    worstFrameMs: FrameStages;
  } | null;

  /**
   * The label frames are being attributed to right now — a current value, not
   * a counter. `(untagged)` when nothing is set.
   */
  currentStateKey: string;

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
  /** Wall time covered by this window, in ms. Excludes background pauses. */
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

  /**
   * **Secondary. Kept for familiarity, not because it is a good metric.**
   *
   * Frames delivered per second during the window. It is deliberately not the
   * headline: our frame callback re-posts on every vsync whether or not
   * anything was drawn, so a blank screen scores a perfect 60 while
   * `hitchRatioMs` correctly reports 0. Useful mainly for making that argument
   * concrete — put it next to the hitch ratio and the difference is obvious.
   */
  fps: number;

  /** Probes that exceeded the budget during the window. */
  jsStallCount: number;
  /** Probes completed during the window. */
  jsProbeCount: number;

  /**
   * Frame intervals during the window too long to be jank — a frozen process,
   * doze, or a lifecycle transition the module did not see.
   *
   * Non-zero here means part of the wall clock is unaccounted for, so read the
   * ratios with that in mind. Under normal use it stays at zero: backgrounding
   * is handled by the lifecycle pause, which resets the baseline so no gap is
   * ever measured.
   */
  outlierCount: number;
  /** Total time inside those intervals, in ms. */
  outlierMs: number;

  /** Times sampling auto-paused for the background during this window. */
  backgroundPauses: number;
  /** Whether sampling was active as of the end of the window. */
  sampling: boolean;

  /**
   * What each active state combination cost during this window.
   *
   * Ordered worst-first by `hitchRatioMs`, so the bucket worth looking at is
   * the first one. Empty until something calls `setState`.
   *
   * **Attribution is only as timely as the JS thread.** `setState` originates
   * in JS, so while the JS thread is stalled the change waits in its queue and
   * intervening frames keep the previous label — worst exactly when the app is
   * janky. Treat these as strong attribution, not exact accounting.
   */
  states: FrameStateWindow[];

  /**
   * Where the frame time actually went — **Android only, `null` on iOS.**
   *
   * The rest of this object tells you a frame was slow. This tells you why: a
   * 31ms frame with 19ms in `layoutMeasure` points at the view hierarchy, and
   * that is a diagnosis rather than a symptom.
   *
   * Also `null` before the first frame reaches the listener, and while stage
   * capture is switched off.
   */
  stages: StageWindow | null;

  /** Refresh rate as of the end of the window. */
  refreshRateHz: number;
  /** Frame budget as of the end of the window. */
  frameBudgetMs: number;

  /**
   * Longest frame interval since the first `start()` — **not** windowed.
   *
   * The native side keeps a lifetime maximum, which cannot be recovered from a
   * diff. Windowing this is deferred; see M3's outcome for why.
   */
  worstFrameMsSinceStart: number;
  /** Median probe latency since the first `start()`. Not windowed — a histogram cannot be diffed. */
  jsQueueLatencyP50MsSinceStart: number;
  /** 95th-percentile probe latency since the first `start()`. Not windowed. */
  jsQueueLatencyP95MsSinceStart: number;
  /** Worst probe latency since the first `start()`. Not windowed. */
  jsQueueLatencyMaxMsSinceStart: number;
};
