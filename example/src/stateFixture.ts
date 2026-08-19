import {
  clearState,
  diff,
  getSnapshot,
  setState,
  unstable_blockUiThreadForTesting,
} from 'react-native-frame-metrics';

/**
 * Headless verification for M4 state tagging.
 *
 * Real scrolling is a *magnitude* question — how bad is a heavy list on this
 * hardware — and an emulator cannot answer it. "Does jank land in the bucket
 * that was active?" is a *mechanism* question, and a controlled UI-thread block
 * answers it deterministically: we know exactly when the jank happened and
 * exactly what was labelled at the time, so the expected bucket is not a
 * judgement call.
 *
 * Driven with:
 *   adb shell am start -n framemetrics.example/.MainActivity -e autorun states
 */

/** Same pass/fail line as the 2x2: a warning-band result is not a pass. */
export const CRITICAL_MS_PER_S = 10;

/** Bucket cap in StateTracker.kt, plus the reserved `(other)` row. */
const MAX_BUCKETS = 32;

export type StateResult = {
  label: string;
  expectedKey: string;
  /** Hitch ratio in the bucket that should have caught it. */
  hitchRatioMs: number;
  /** Worst hitch ratio among every *other* bucket that saw frames. */
  worstOtherMs: number;
  bucketCount: number;
  pass: boolean;
};

type Step = {
  label: string;
  /** Labels to apply before the block. `null` clears the key. */
  states: Record<string, string | null>;
  /** The bucket those labels compose to — state keys sorted alphabetically. */
  expectedKey: string;
};

/**
 * Each step blocks the UI thread while a known set of labels is active.
 *
 * The sequence matters: it walks an interaction change within one screen, then
 * a screen change, which is exactly the pair of transitions that per-key
 * bucketing would blur together.
 */
export const STEPS: Step[] = [
  {
    label: 'feed at rest',
    states: { screen: 'FeedList', interaction: 'idle' },
    expectedKey: 'interaction=idle,screen=FeedList',
  },
  {
    label: 'feed scrolling',
    states: { interaction: 'scrolling' },
    expectedKey: 'interaction=scrolling,screen=FeedList',
  },
  {
    label: 'profile, no interaction',
    states: { screen: 'Profile', interaction: null },
    expectedKey: 'screen=Profile',
  },
];

const BLOCK_MS = 400;
const SETTLE_MS = 900;

async function runStep(step: Step): Promise<StateResult> {
  for (const [key, value] of Object.entries(step.states)) {
    if (value === null) clearState(key);
    else setState(key, value);
  }

  const start = getSnapshot();
  unstable_blockUiThreadForTesting(BLOCK_MS);
  await new Promise((resolve) => setTimeout(resolve, BLOCK_MS + SETTLE_MS));
  const window = diff(start, getSnapshot());

  const target = window.states.find((s) => s.key === step.expectedKey);
  const others = window.states.filter((s) => s.key !== step.expectedKey);
  const worstOtherMs = others.reduce((w, s) => Math.max(w, s.hitchRatioMs), 0);
  const hitchRatioMs = target?.hitchRatioMs ?? 0;

  return {
    label: step.label,
    expectedKey: step.expectedKey,
    hitchRatioMs,
    worstOtherMs,
    bucketCount: window.states.length,
    // The jank must land in the labelled bucket *and* stay out of the others.
    // Checking only the first would pass a tracker that tagged every bucket.
    pass: hitchRatioMs > CRITICAL_MS_PER_S && worstOtherMs <= CRITICAL_MS_PER_S,
  };
}

export function formatStateResult(result: StateResult): string {
  return (
    `[states] ${result.label} key=${result.expectedKey} ` +
    `hitch=${result.hitchRatioMs.toFixed(1)} ` +
    `worstOther=${result.worstOtherMs.toFixed(1)} ` +
    `buckets=${result.bucketCount} ` +
    `${result.pass ? 'PASS' : 'FAIL'}`
  );
}

/**
 * Churn far more distinct values than the cap allows.
 *
 * Someone will eventually tag with a user id. This checks the map stays bounded
 * rather than growing with cardinality — and that the overflow is visible as an
 * `(other)` row instead of silently evicting real buckets.
 */
export async function runCardinalityCheck(
  onLog: (line: string) => void
): Promise<boolean> {
  const start = getSnapshot();

  for (let i = 0; i < 200; i++) {
    setState('churn', `value-${i}`);
    // Give the frame callback something to attribute to each label.
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
  clearState('churn');

  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  const total = getSnapshot().states.length;
  const overflow = diff(start, getSnapshot()).states.find(
    (s) => s.key === '(other)'
  );

  // 200 distinct labels went in. The cap plus the reserved overflow row is the
  // most that may come out.
  const pass = total <= MAX_BUCKETS + 1;
  onLog(
    `[states] cardinality labels=200 buckets=${total} cap=${MAX_BUCKETS} ` +
      `overflowSeen=${overflow !== undefined} ${pass ? 'PASS' : 'FAIL'}`
  );
  return pass;
}

export async function runStateMatrix(
  onResult: (result: StateResult) => void,
  onLog: (line: string) => void
): Promise<StateResult[]> {
  const results: StateResult[] = [];

  try {
    for (const step of STEPS) {
      const result = await runStep(step);
      results.push(result);
      onResult(result);
    }
  } finally {
    clearState('screen');
    clearState('interaction');
  }

  const cardinalityOk = await runCardinalityCheck(onLog);
  const passed = results.filter((r) => r.pass).length;
  onLog(
    `[states] RESULT rows=${passed}/${results.length} ` +
      `cardinality=${cardinalityOk ? 'PASS' : 'FAIL'} ` +
      `gate=${passed === results.length && cardinalityOk ? 'PASS' : 'FAIL'}`
  );

  return results;
}
