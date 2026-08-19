import { diff } from './diff';
import { startDriftMeter } from './jsDrift';
import NativeFrameMetrics from './NativeFrameMetrics';
import type { FrameMetricsWindow, FrameSnapshot } from './types';

export { diff, startDriftMeter };
export type { DriftMeter } from './jsDrift';
export type { FrameMetricsWindow, FrameSnapshot };

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
