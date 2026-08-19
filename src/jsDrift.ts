/**
 * The contaminated metric, kept deliberately.
 *
 * This is a plain `setTimeout` drift loop — the technique most JS-thread
 * monitors use, and the one this library exists to argue against.
 *
 * RN dispatches `setTimeout` (and `requestAnimationFrame`) from a
 * **main-thread frame callback** on both platforms: `JavaTimerManager.kt` uses
 * `TimerFrameCallback : Choreographer.FrameCallback` on Android, `RCTTiming.mm`
 * uses a main-run-loop `CADisplayLink` on iOS. So blocking the **UI** thread
 * stops timers firing, and a drift loop reports a JS stall that never happened.
 *
 * Keeping it next to the clean number makes the argument concrete: in row 2 of
 * the acceptance test, `jsStallRatioMs` stays near zero while this number blows
 * up. That inversion is the demonstration.
 *
 * **Do not use this as a health metric.** It is here to be wrong.
 */

const DEFAULT_INTERVAL_MS = 16;
const DEFAULT_BUDGET_MS = 1000 / 60;
const MS_PER_SECOND = 1000;

const now: () => number =
  typeof globalThis.performance?.now === 'function'
    ? () => globalThis.performance.now()
    : () => Date.now();

export type DriftMeter = {
  /**
   * Drift beyond the frame budget since the previous `read()`, in ms/s.
   *
   * Deliberately the same shape and unit as `jsStallRatioMs`, so the two can be
   * put side by side.
   */
  read(): number;
  stop(): void;
};

export function startDriftMeter(
  frameBudgetMs: number = DEFAULT_BUDGET_MS,
  intervalMs: number = DEFAULT_INTERVAL_MS
): DriftMeter {
  let lateMs = 0;
  let windowStartedAt = now();
  let expectedAt = now() + intervalMs;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;

  const tick = () => {
    if (stopped) return;

    const at = now();
    // How late the timer fired. This is the drift-loop analogue of the native
    // probe's queue latency — and, unlike it, it is UI-thread-coupled.
    const lateness = at - expectedAt;
    lateMs += Math.max(0, lateness - frameBudgetMs);

    expectedAt = at + intervalMs;
    timer = setTimeout(tick, intervalMs);
  };

  timer = setTimeout(tick, intervalMs);

  return {
    read() {
      const at = now();
      const elapsedSeconds = (at - windowStartedAt) / MS_PER_SECOND;
      const ratio = elapsedSeconds > 0 ? lateMs / elapsedSeconds : 0;

      lateMs = 0;
      windowStartedAt = at;
      return ratio;
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
