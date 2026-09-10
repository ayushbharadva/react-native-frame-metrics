import { AppState } from 'react-native';
import NativeFrameMetrics from './NativeFrameMetrics';
import { JsFrameCounter } from './JsFrameCounter';
import { now } from './clock';

export type FrameMetricsSample = Readonly<{
  /** Native UI callback cadence, not GPU presentation rate. */
  uiThreadFps: number;
  /** JS requestAnimationFrame callback cadence. */
  jsThreadFps: number;
  /** Inferred missed UI callback intervals in this sample, not cumulative. */
  droppedFrames: number;
  frameBudgetMs: number;
  /** Duration covered by the native sample. */
  durationMs: number;
}>;

export type StartOptions = { sampleIntervalMs?: number };
type Listener = (sample: FrameMetricsSample) => void;
const listeners = new Set<Listener>();
const jsFrames = new JsFrameCounter();
let running = false;
let generation = 0;
let intervalMs = 500;
let frame: number | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let appStateSubscription:
  ReturnType<typeof AppState.addEventListener> | undefined;

function cancelLoops() {
  generation += 1;
  if (frame !== undefined) cancelAnimationFrame(frame);
  if (timer !== undefined) clearTimeout(timer);
  frame = undefined;
  timer = undefined;
  jsFrames.reset();
}

function beginLoops() {
  cancelLoops();
  const current = generation;
  const tick = () => {
    if (!running || current !== generation) return;
    jsFrames.record(now());
    frame = requestAnimationFrame(tick);
  };
  const poll = async () => {
    try {
      const native = await NativeFrameMetrics!.getMetrics();
      if (!running || current !== generation) return;
      const jsThreadFps = jsFrames.sample();
      if (native.durationMs > 0) {
        const sample: FrameMetricsSample = Object.freeze({
          uiThreadFps: (native.frameCount * 1000) / native.durationMs,
          jsThreadFps,
          droppedFrames: native.droppedFrames,
          frameBudgetMs: native.frameBudgetMs,
          durationMs: native.durationMs,
        });
        for (const listener of Array.from(listeners)) {
          if (!running || current !== generation) break;
          if (!listeners.has(listener)) continue;
          try {
            listener(sample);
          } catch (error) {
            console.error('[frame-metrics] Subscriber failed:', error);
          }
        }
      }
    } catch (error) {
      if (running && current === generation) {
        stop();
        console.error('[frame-metrics] Sampling stopped:', error);
      }
    }
    if (running && current === generation) {
      timer = setTimeout(poll, intervalMs);
    }
  };
  frame = requestAnimationFrame(tick);
  timer = setTimeout(poll, intervalMs);
}

/** Starts a singleton sampler. Repeated calls are no-ops until stop(). */
export function start(options: StartOptions = {}): void {
  if (running) return;
  const requestedInterval = options.sampleIntervalMs ?? 500;
  if (
    !Number.isFinite(requestedInterval) ||
    requestedInterval < 100 ||
    requestedInterval > 60000
  ) {
    throw new RangeError('sampleIntervalMs must be between 100 and 60000.');
  }
  if (!NativeFrameMetrics) {
    throw new Error(
      'FrameMetrics is unavailable. Rebuild your Android/iOS app with react-native-frame-metrics and the New Architecture enabled.'
    );
  }
  intervalMs = requestedInterval;
  NativeFrameMetrics.start();
  running = true;
  appStateSubscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      NativeFrameMetrics!.start();
      beginLoops();
    } else {
      cancelLoops();
      NativeFrameMetrics!.stop();
    }
  });
  if (AppState.currentState === 'active' || AppState.currentState === null)
    beginLoops();
}

/** Stops sampling and cancels pending delivery. Registered listeners remain. */
export function stop(): void {
  if (!running) return;
  running = false;
  cancelLoops();
  appStateSubscription?.remove();
  appStateSubscription = undefined;
  NativeFrameMetrics?.stop();
}

/** Observe samples; subscribing does not start the sampler. */
export function subscribe(listener: Listener): () => void {
  // Each subscription owns its registration, including duplicate callbacks.
  const registration: Listener = (sample) => listener(sample);
  listeners.add(registration);
  return () => {
    listeners.delete(registration);
  };
}
