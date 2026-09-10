import {
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { AppState, type AppStateStatus } from 'react-native';
import NativeFrameMetrics, { type NativeSample } from '../NativeFrameMetrics';
import { start, stop, subscribe } from '../metrics';
import { JsFrameCounter } from '../JsFrameCounter';

jest.mock('../NativeFrameMetrics', () => ({
  __esModule: true,
  default: { start: jest.fn(), stop: jest.fn(), getMetrics: jest.fn() },
}));

const native = jest.mocked(NativeFrameMetrics!);
const healthy: NativeSample = {
  frameCount: 30,
  durationMs: 500,
  droppedFrames: 0,
  frameBudgetMs: 1000 / 60,
};
let changeState: (state: AppStateStatus) => void;
let remove: ReturnType<typeof jest.fn>;
const unsubscriptions: Array<() => void> = [];

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetAllMocks();
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    writable: true,
    value: 'active',
  });
  remove = jest.fn();
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      changeState = listener;
      return { remove };
    });
  native.getMetrics.mockResolvedValue(healthy);
});

afterEach(() => {
  stop();
  unsubscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('JS cadence', () => {
  it.each([60, 90, 120])('measures %i Hz without assuming 60 Hz', (hz) => {
    const counter = new JsFrameCounter();
    for (let index = 0; index <= hz; index++)
      counter.record((index * 1000) / hz);
    expect(counter.sample()).toBeCloseTo(hz);
  });
  it('includes stalled time and preserves the boundary across windows', () => {
    const counter = new JsFrameCounter();
    counter.record(0);
    counter.record(20);
    expect(counter.sample()).toBe(50);
    counter.record(220);
    expect(counter.sample()).toBe(5);
    counter.reset();
    counter.record(10000);
    expect(counter.sample()).toBe(0);
  });
});

it('starts once, emits native metrics, and cancels work on stop', async () => {
  const listener = jest.fn();
  unsubscriptions.push(subscribe(listener));
  start();
  start();
  expect(native.start).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(500);
  expect(listener).toHaveBeenCalledWith(
    expect.objectContaining({
      uiThreadFps: 60,
      droppedFrames: 0,
      durationMs: 500,
    })
  );
  stop();
  stop();
  await jest.advanceTimersByTimeAsync(1000);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(native.stop).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledTimes(1);
});

it('owns duplicate subscriptions independently and supports unsubscribe', async () => {
  const listener = jest.fn();
  const unsubscribe = subscribe(listener);
  unsubscriptions.push(subscribe(listener));
  unsubscribe();
  unsubscribe();
  start();
  await jest.advanceTimersByTimeAsync(500);
  expect(listener).toHaveBeenCalledTimes(1);
});

it('does not deliver a stale response into a new session', async () => {
  let resolve!: (sample: NativeSample) => void;
  native.getMetrics.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    })
  );
  const listener = jest.fn();
  unsubscriptions.push(subscribe(listener));
  start();
  await jest.advanceTimersByTimeAsync(500);
  stop();
  start();
  resolve(healthy);
  await jest.advanceTimersByTimeAsync(0);
  expect(listener).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(500);
  expect(listener).toHaveBeenCalledTimes(1);
});

it('pauses in background and resets on resume', async () => {
  const listener = jest.fn();
  unsubscriptions.push(subscribe(listener));
  start();
  changeState('background');
  await jest.advanceTimersByTimeAsync(2000);
  expect(native.getMetrics).not.toHaveBeenCalled();
  changeState('active');
  await jest.advanceTimersByTimeAsync(500);
  expect(listener).toHaveBeenCalledTimes(1);
});

it('isolates subscriber errors and stops on native errors', async () => {
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  const listener = jest.fn();
  unsubscriptions.push(
    subscribe(() => {
      throw new Error('listener');
    }),
    subscribe(listener)
  );
  start();
  await jest.advanceTimersByTimeAsync(500);
  expect(listener).toHaveBeenCalledTimes(1);
  native.getMetrics.mockRejectedValueOnce(new Error('native'));
  await jest.advanceTimersByTimeAsync(1000);
  expect(native.stop).toHaveBeenCalledTimes(1);
  expect(error).toHaveBeenCalledTimes(2);
});

it('skips empty native windows and rejects invalid intervals', async () => {
  for (const sampleIntervalMs of [0, 99, 60001, NaN, Infinity]) {
    expect(() => start({ sampleIntervalMs })).toThrow(RangeError);
  }
  native.getMetrics.mockResolvedValueOnce({ ...healthy, durationMs: 0 });
  const listener = jest.fn();
  unsubscriptions.push(subscribe(listener));
  start({ sampleIntervalMs: 100 });
  await jest.advanceTimersByTimeAsync(100);
  expect(listener).not.toHaveBeenCalled();
});
