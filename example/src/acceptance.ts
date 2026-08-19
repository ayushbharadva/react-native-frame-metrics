import {
  getSnapshot,
  diff,
  startDriftMeter,
  unstable_blockUiThreadForTesting,
  type DriftMeter,
  type FrameMetricsWindow,
} from 'react-native-frame-metrics';

/**
 * The 2x2 acceptance test, as data and pure-ish functions.
 *
 * Kept out of the React component so the same scenarios can be driven either by
 * buttons or by the headless autorun path. A device-farm run is the most likely
 * route to real-hardware numbers, and that is worthless if the matrix can only
 * be driven by hand.
 */

export type ScenarioKey = 'idle' | 'blockUI' | 'blockJS' | 'both';

export type Scenario = {
  key: ScenarioKey;
  label: string;
  /** What the matrix says should happen. Used to compute the verdict. */
  expect: { hitch: 'low' | 'high'; jsStall: 'low' | 'high' };
  run: (durationMs: number) => void;
};

/**
 * Threshold separating "fine" from "bad", in ms/s.
 *
 * The documented scale is <5 good, 5-10 warning, >10 critical. 10 is used as
 * the pass/fail line so a warning-band result does not silently count as a pass.
 */
export const CRITICAL_MS_PER_S = 10;

function busyLoopJs(durationMs: number) {
  const until = Date.now() + durationMs;
  // Intentionally the crudest possible JS block.
  while (Date.now() < until) {
    /* spin */
  }
}

export const SCENARIOS: Scenario[] = [
  {
    key: 'idle',
    label: 'Idle',
    expect: { hitch: 'low', jsStall: 'low' },
    run: () => {},
  },
  {
    key: 'blockUI',
    label: 'Block UI thread',
    // Row 2 — the gate. A blocked UI thread must not make the JS number look bad.
    expect: { hitch: 'high', jsStall: 'low' },
    run: (ms) => unstable_blockUiThreadForTesting(ms),
  },
  {
    key: 'blockJS',
    label: 'Block JS thread',
    expect: { hitch: 'low', jsStall: 'high' },
    run: (ms) => busyLoopJs(ms),
  },
  {
    key: 'both',
    label: 'Block both',
    expect: { hitch: 'high', jsStall: 'high' },
    run: (ms) => {
      unstable_blockUiThreadForTesting(ms);
      busyLoopJs(ms);
    },
  },
];

export type ScenarioResult = {
  key: ScenarioKey;
  durationMs: number;
  window: FrameMetricsWindow;
  driftMsPerS: number;
  pass: boolean;
};

function matches(value: number, expected: 'low' | 'high'): boolean {
  return expected === 'high'
    ? value > CRITICAL_MS_PER_S
    : value <= CRITICAL_MS_PER_S;
}

/**
 * Run one scenario and sample the window it produced.
 *
 * The sample deliberately spans the block itself: `start` is read, the stimulus
 * fires, then we wait long enough for the effect to land in the counters before
 * reading `end`. Native never stopped counting during the block, so a delayed
 * read loses no data — it only delays reporting.
 */
export async function runScenario(
  scenario: Scenario,
  durationMs: number,
  drift: DriftMeter,
  settleMs: number
): Promise<ScenarioResult> {
  // Discard whatever the previous scenario left in the drift accumulator.
  drift.read();
  const start = getSnapshot();

  scenario.run(durationMs);

  // Let the block finish and the counters catch up. The UI blocker is async, so
  // this wait covers it.
  await new Promise((resolve) => setTimeout(resolve, durationMs + settleMs));

  const end = getSnapshot();
  const window = diff(start, end);
  const driftMsPerS = drift.read();

  return {
    key: scenario.key,
    durationMs,
    window,
    driftMsPerS,
    pass:
      matches(window.hitchRatioMs, scenario.expect.hitch) &&
      matches(window.jsStallRatioMs, scenario.expect.jsStall),
  };
}

export function formatResult(result: ScenarioResult): string {
  const { window: w } = result;
  return (
    `[2x2] scenario=${result.key}${result.durationMs || ''} ` +
    `hitch=${w.hitchRatioMs.toFixed(1)} ` +
    `jsStall=${w.jsStallRatioMs.toFixed(1)} ` +
    `drift=${result.driftMsPerS.toFixed(1)} ` +
    `probes=${w.jsProbeCount} ` +
    `elapsed=${w.elapsedMs.toFixed(0)}ms ` +
    `${result.pass ? 'PASS' : 'FAIL'}`
  );
}

/**
 * Run the whole matrix unattended and log a machine-readable verdict.
 *
 * Triggered with:
 *   adb shell am start -n framemetrics.example/.MainActivity -e autorun 2x2
 */
export async function runMatrix(
  durationsMs: number[],
  settleMs: number,
  onResult: (result: ScenarioResult) => void
): Promise<ScenarioResult[]> {
  const budget = getSnapshot().frameBudgetMs;
  const drift = startDriftMeter(budget);
  const results: ScenarioResult[] = [];

  try {
    for (const durationMs of durationsMs) {
      for (const scenario of SCENARIOS) {
        // 'idle' has no duration to vary — run it once, on the first pass.
        if (scenario.key === 'idle' && durationMs !== durationsMs[0]) continue;

        const result = await runScenario(
          scenario,
          scenario.key === 'idle' ? 0 : durationMs,
          drift,
          settleMs
        );
        results.push(result);
        onResult(result);
      }
    }
  } finally {
    drift.stop();
  }

  return results;
}
