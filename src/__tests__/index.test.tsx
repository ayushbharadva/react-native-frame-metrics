import { describe, expect, it } from '@jest/globals';
import { diff } from '../diff';
import type { FrameSnapshot } from '../types';

function snapshot(overrides: Partial<FrameSnapshot> = {}): FrameSnapshot {
  return {
    elapsedMs: 0,
    frameCount: 0,
    droppedFrames: 0,
    hitchMs: 0,
    refreshRateHz: 60,
    frameBudgetMs: 1000 / 60,
    jsStallMs: 0,
    jsStallCount: 0,
    jsProbeCount: 0,
    worstFrameMs: 0,
    jsQueueLatencyP50Ms: 0,
    jsQueueLatencyP95Ms: 0,
    jsQueueLatencyMaxMs: 0,
    ...overrides,
  };
}

describe('diff', () => {
  it('subtracts the monotonic counters', () => {
    const window = diff(
      snapshot({ elapsedMs: 1000, frameCount: 60, droppedFrames: 2 }),
      snapshot({ elapsedMs: 1500, frameCount: 90, droppedFrames: 5 })
    );

    expect(window.elapsedMs).toBe(500);
    expect(window.frameCount).toBe(30);
    expect(window.droppedFrames).toBe(3);
  });

  it('reports the worst frame as a lifetime value, not a delta', () => {
    const window = diff(
      snapshot({ worstFrameMs: 120 }),
      snapshot({ worstFrameMs: 120 })
    );

    expect(window.worstFrameMsSinceStart).toBe(120);
  });

  it('takes the refresh rate from the end of the window', () => {
    const window = diff(
      snapshot({ refreshRateHz: 120, frameBudgetMs: 1000 / 120 }),
      snapshot({ refreshRateHz: 60, frameBudgetMs: 1000 / 60 })
    );

    expect(window.refreshRateHz).toBe(60);
    expect(window.frameBudgetMs).toBeCloseTo(16.67, 2);
  });

  it('clamps at zero when the native module was rebuilt underneath us', () => {
    // A reload resets the native accumulators, so the new snapshot reads lower
    // than the one held in JS.
    const window = diff(
      snapshot({ elapsedMs: 9000, frameCount: 540, droppedFrames: 12 }),
      snapshot({ elapsedMs: 100, frameCount: 6, droppedFrames: 0 })
    );

    expect(window.elapsedMs).toBe(0);
    expect(window.frameCount).toBe(0);
    expect(window.droppedFrames).toBe(0);
  });
});

describe('ratios', () => {
  it('expresses both headline numbers as ms per second', () => {
    // 2s window, 100ms of hitch and 40ms of stall accumulated within it.
    const window = diff(
      snapshot({ elapsedMs: 1000, hitchMs: 10, jsStallMs: 5 }),
      snapshot({ elapsedMs: 3000, hitchMs: 110, jsStallMs: 45 })
    );

    expect(window.hitchRatioMs).toBeCloseTo(50, 5);
    expect(window.jsStallRatioMs).toBeCloseTo(20, 5);
  });

  it('shares one denominator so the two are comparable', () => {
    // Equal accumulation must produce equal ratios regardless of magnitude.
    const window = diff(
      snapshot(),
      snapshot({ elapsedMs: 500, hitchMs: 7, jsStallMs: 7 })
    );

    expect(window.hitchRatioMs).toBeCloseTo(window.jsStallRatioMs, 10);
  });

  it('is zero rather than NaN when no time elapsed', () => {
    // Happens whenever sampling is stopped: elapsedMs does not advance.
    const window = diff(
      snapshot({ elapsedMs: 5000, hitchMs: 20, jsStallMs: 20 }),
      snapshot({ elapsedMs: 5000, hitchMs: 20, jsStallMs: 20 })
    );

    expect(window.hitchRatioMs).toBe(0);
    expect(window.jsStallRatioMs).toBe(0);
  });

  it('keeps row 2 of the acceptance matrix legible', () => {
    // A blocked UI thread with an idle JS thread: the two must disagree.
    const window = diff(
      snapshot(),
      snapshot({ elapsedMs: 1000, hitchMs: 480, jsStallMs: 0.2 })
    );

    expect(window.hitchRatioMs).toBeGreaterThan(10);
    expect(window.jsStallRatioMs).toBeLessThan(5);
  });
});
