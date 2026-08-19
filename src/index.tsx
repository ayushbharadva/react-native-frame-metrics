import { diff } from './diff';
import { FrameState } from './FrameState';
import { startDriftMeter } from './jsDrift';
import NativeFrameMetrics from './NativeFrameMetrics';
import type {
  FrameMetricsWindow,
  FrameSnapshot,
  FrameStages,
  FrameStateWindow,
  StageWindow,
  StateBucket,
} from './types';
import { useFrameState } from './useFrameState';

export { diff, FrameState, startDriftMeter, useFrameState };
export type { FrameStateProps } from './FrameState';
export type { DriftMeter } from './jsDrift';
export type { SetFrameState } from './useFrameState';
export type {
  FrameMetricsWindow,
  FrameSnapshot,
  FrameStages,
  FrameStateWindow,
  StageWindow,
  StateBucket,
};

const DEFAULT_INTERVAL_MS = 500;

/**
 * Begin sampling the UI thread.
 *
 * This re-posts a frame callback on every vsync, which keeps the display
 * pipeline from idling. It is a development tool — pair every `start()` with a
 * `stop()`.
 */
export function start(): void {
  NativeFrameMetrics.start();
}

/** Stop sampling. Counters are retained, not reset. */
export function stop(): void {
  NativeFrameMetrics.stop();
}

/** Read the native accumulators. Synchronous — no bridge round trip. */
export function getSnapshot(): FrameSnapshot {
  return NativeFrameMetrics.getSnapshot();
}

/**
 * Sleeps the UI thread. **Testing only — this must not survive to a release.**
 *
 * Exists so the acceptance fixture can block the UI thread with a controlled,
 * deterministic stimulus rather than hoping real load produces one. No-op
 * unless the host app is debuggable.
 *
 * Asynchronous by design: a synchronous version would block the JS thread
 * waiting on the UI thread and fabricate the exact false positive this library
 * exists to avoid.
 *
 * Scheduled for removal at M11.
 */
export function unstable_blockUiThreadForTesting(ms: number): void {
  NativeFrameMetrics.unstable_blockUiThreadForTesting(ms);
}

/**
 * Label what the app is doing, so jank can be attributed to it.
 *
 * Frames are bucketed by the **combination** of every active label, so
 * `screen=FeedList` plus `interaction=scrolling` produces one bucket naming
 * both. That is the useful question — a feed that is fine at rest and terrible
 * under scroll is invisible if the two are bucketed separately.
 *
 * ```ts
 * setState('screen', 'FeedList');
 * setState('interaction', 'scrolling');
 * ```
 *
 * Prefer `<FrameState>` or `useFrameState()` in components: both clear up after
 * themselves, and a label left set outlives whatever it was describing.
 *
 * **One key, one owner.** The labels are a single global map, so the last
 * writer to a key wins and `clearState` clears it for everyone. Calling
 * `setState('screen', ...)` imperatively while a `<FrameState name="screen">`
 * is mounted will silently take the key from it — the component only re-asserts
 * when its own `value` changes. Pick one owner per key.
 *
 * **Attribution is only as timely as the JS thread.** This call originates in
 * JS, so a stalled JS thread delays the change and the frames in between keep
 * the previous label — worst exactly when the app is janky. Strong attribution,
 * not exact accounting.
 */
export function setState(key: string, value: string): void {
  NativeFrameMetrics.setState(key, value);
}

/** Remove one label. Frames revert to whatever combination is left. */
export function clearState(key: string): void {
  NativeFrameMetrics.clearState(key);
}

/**
 * Turn the per-frame stage breakdown on or off. **Android only** — a no-op on
 * iOS, where there is no `FrameMetrics` equivalent.
 *
 * On by default. The listener runs on its own background thread rather than the
 * UI thread, so it does not add work to the thread being measured, but the
 * switch is here so its cost can be measured against itself and dropped by
 * anyone who finds it expensive on low-end hardware.
 */
export function setStageCaptureEnabled(enabled: boolean): void {
  NativeFrameMetrics.setStageCaptureEnabled(enabled);
}

/**
 * Poll `getSnapshot()` and report the difference between consecutive reads.
 *
 * Polling runs on a JS timer, so a blocked JS thread delays *reporting* — it
 * does not lose data. The native side never stopped counting, and the next
 * window simply covers a longer stretch of wall time.
 *
 * Does not call `start()`. Returns an unsubscribe function.
 */
export function subscribe(
  listener: (window: FrameMetricsWindow) => void,
  intervalMs: number = DEFAULT_INTERVAL_MS
): () => void {
  let previous = getSnapshot();

  const timer = setInterval(() => {
    const current = getSnapshot();
    const window = diff(previous, current);
    previous = current;

    // A window with no elapsed time carries no information — it happens when
    // sampling is stopped, since `elapsedMs` only advances while running.
    if (window.elapsedMs > 0) {
      listener(window);
    }
  }, intervalMs);

  return () => clearInterval(timer);
}
