import {
  diff,
  getSnapshot,
  setStageCaptureEnabled,
  type FrameStages,
  type StageWindow,
} from 'react-native-frame-metrics';
import type { TreeMode } from './StageScreen';
import { runMatrix, type ScenarioResult } from './acceptance';

/**
 * Headless verification for M5 stage breakdown.
 *
 * Splits along the usual line. **Mechanism** — are stages captured at all, do
 * the parts sum to the whole, is the worst frame retained, does the switch
 * work, does the listener survive Activity recreation — is deterministic and
 * the emulator answers it honestly.
 *
 * **Magnitude** — whether a deep tree costs 19ms of layout on real hardware —
 * is not answerable here. The comparison below is still run and logged, because
 * the *direction* is informative, but it is reported as a ratio and explicitly
 * not as a timing claim.
 *
 * Driven with:
 *   adb shell am start -n framemetrics.example/.MainActivity -e autorun stages
 */

const SAMPLE_MS = 2500;
const SETTLE_MS = 700;

/**
 * The named stages may not *exceed* the frame they belong to.
 *
 * This is the invariant the platform actually guarantees. It deliberately does
 * not assert that the parts add up to `total`: `TOTAL_DURATION` runs from the
 * intended vsync to frame completion and includes waits — for a free buffer,
 * for the render thread's queue — that no named stage covers. Measured coverage
 * here runs 0.64-0.89, worst when the GPU is loaded. Asserting a clean partition
 * would be asserting something Android does not promise.
 */
const OVER_ACCOUNT_TOLERANCE = 0.05;

/** Below this, most of the frame is outside the named stages. Reported, not failed. */
const LOW_COVERAGE = 0.7;

const PART_KEYS: (keyof FrameStages)[] = [
  'unknownDelay',
  'inputHandling',
  'animation',
  'layoutMeasure',
  'draw',
  'sync',
  'commandIssue',
  'swapBuffers',
];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sample one window of stage data. */
async function sample(ms: number): Promise<StageWindow | null> {
  const start = getSnapshot();
  await wait(ms);
  return diff(start, getSnapshot()).stages;
}

function sumParts(s: FrameStages): number {
  return PART_KEYS.reduce((total, key) => total + s[key], 0);
}

export type StageCheck = { label: string; detail: string; pass: boolean };

export async function runStageMatrix(
  setTreeMode: (mode: TreeMode) => void,
  onLog: (line: string) => void
): Promise<boolean> {
  const checks: StageCheck[] = [];
  const perMode: Partial<Record<TreeMode, StageWindow>> = {};

  setStageCaptureEnabled(true);

  for (const mode of ['flat', 'deep', 'shadow'] as const) {
    setTreeMode(mode);
    await wait(SETTLE_MS);
    const window = await sample(SAMPLE_MS);

    if (!window || window.frameCount === 0) {
      checks.push({
        label: `${mode} captured`,
        detail: 'no stage data',
        pass: false,
      });
      continue;
    }
    perMode[mode] = window;

    const avg = window.averageMs;
    const parts = sumParts(avg);
    const ratio = avg.total > 0 ? parts / avg.total : 0;
    // Under-accounting is expected and informative. Over-accounting would mean
    // the stages are being double counted or read from the wrong frame, which
    // is a real defect.
    const sumOk = ratio <= 1 + OVER_ACCOUNT_TOLERANCE;

    // The worst frame is a maximum over the same population as the average, so
    // it cannot be smaller. If it were, the max is not being retained.
    const worstOk = window.worstFrameMsSinceStart.total >= avg.total;

    checks.push({
      label: `${mode} captured`,
      detail: `frames=${window.frameCount} total=${avg.total.toFixed(2)}ms`,
      pass: true,
    });
    checks.push({
      label: `${mode} parts within total`,
      detail:
        `parts=${parts.toFixed(2)}ms total=${avg.total.toFixed(2)}ms ` +
        `coverage=${ratio.toFixed(2)}` +
        (ratio < LOW_COVERAGE
          ? ' (low — most of the frame is unattributed)'
          : ''),
      pass: sumOk,
    });
    checks.push({
      label: `${mode} worst frame retained`,
      detail: `worst=${window.worstFrameMsSinceStart.total.toFixed(1)}ms avg=${avg.total.toFixed(2)}ms`,
      pass: worstOk,
    });

    onLog(
      `[stages] ${mode} layoutMeasure=${avg.layoutMeasure.toFixed(2)} ` +
        `draw=${avg.draw.toFixed(2)} ` +
        `commandIssue=${avg.commandIssue.toFixed(2)} ` +
        `swapBuffers=${avg.swapBuffers.toFixed(2)} ` +
        `total=${avg.total.toFixed(2)} ` +
        `worstTotal=${window.worstFrameMsSinceStart.total.toFixed(1)} ` +
        `frames=${window.frameCount}`
    );
  }

  // The switch has to actually stop the listener, or "measure the overhead by
  // turning it off" is not a valid experiment.
  setStageCaptureEnabled(false);
  await wait(SETTLE_MS);
  const off = await sample(1200);
  const offOk = off === null || off.frameCount === 0;
  checks.push({
    label: 'capture switches off',
    detail: `framesWhileOff=${off?.frameCount ?? 0}`,
    pass: offOk,
  });

  setStageCaptureEnabled(true);
  await wait(SETTLE_MS);
  const back = await sample(1200);
  const backOk = (back?.frameCount ?? 0) > 0;
  checks.push({
    label: 'capture switches back on',
    detail: `framesAfterReenable=${back?.frameCount ?? 0}`,
    pass: backOk,
  });

  checks.forEach((check) =>
    onLog(
      `[stages] ${check.label} — ${check.detail} ${check.pass ? 'PASS' : 'FAIL'}`
    )
  );

  // Directional only. Emulator stage magnitudes are not representative of a
  // phone, so this is logged for information and never gates the milestone.
  const flat = perMode.flat;
  const deep = perMode.deep;
  const shadow = perMode.shadow;
  if (flat && deep) {
    const ratio =
      flat.averageMs.layoutMeasure > 0
        ? deep.averageMs.layoutMeasure / flat.averageMs.layoutMeasure
        : 0;
    onLog(
      `[stages] DIRECTION deep/flat layoutMeasure=${ratio.toFixed(2)}x ` +
        `(${flat.averageMs.layoutMeasure.toFixed(2)} -> ${deep.averageMs.layoutMeasure.toFixed(2)}ms) ` +
        `INFO-ONLY emulator magnitudes are not representative`
    );
  }
  if (flat && shadow) {
    const flatGpu = flat.averageMs.commandIssue + flat.averageMs.swapBuffers;
    const shadowGpu =
      shadow.averageMs.commandIssue + shadow.averageMs.swapBuffers;
    const ratio = flatGpu > 0 ? shadowGpu / flatGpu : 0;
    onLog(
      `[stages] DIRECTION shadow/flat gpu=${ratio.toFixed(2)}x ` +
        `(${flatGpu.toFixed(2)} -> ${shadowGpu.toFixed(2)}ms) ` +
        `INFO-ONLY emulator magnitudes are not representative`
    );
  }

  const passed = checks.filter((c) => c.pass).length;
  const gate = passed === checks.length;
  onLog(
    `[stages] RESULT checks=${passed}/${checks.length} gate=${gate ? 'PASS' : 'FAIL'}`
  );
  return gate;
}

/**
 * What stage capture costs, measured against itself.
 *
 * Runs the full 2x2 twice — once with the listener attached, once detached —
 * and reports both. Same stimuli, same device, minutes apart, so the difference
 * is the listener rather than a guess about it.
 *
 * Indicative only. The emulator shares cores with the host, so the absolute
 * numbers mean nothing; what is informative is whether the two runs disagree by
 * more than the run-to-run spread. Row 16 of the deferred-verification ledger
 * is the real answer and needs a device.
 *
 *   adb shell am start -n framemetrics.example/.MainActivity -e autorun overhead
 */
export async function runOverheadCheck(
  durationsMs: number[],
  settleMs: number,
  onLog: (line: string) => void
): Promise<void> {
  for (const enabled of [true, false, true, false]) {
    setStageCaptureEnabled(enabled);
    await wait(1500);

    const results: ScenarioResult[] = [];
    const all = await runMatrix(durationsMs, settleMs, (r) => results.push(r));

    const idle = all.find((r) => r.key === 'idle');
    const blocks = all.filter((r) => r.key === 'blockUI');
    const worstJsStall = blocks.reduce(
      (worst, r) => Math.max(worst, r.window.jsStallRatioMs),
      0
    );
    const passed = all.filter((r) => r.pass).length;

    onLog(
      `[overhead] stages=${enabled ? 'on ' : 'off'} ` +
        `rows=${passed}/${all.length} ` +
        `idleHitch=${idle?.window.hitchRatioMs.toFixed(2) ?? '?'} ` +
        `idleJsStall=${idle?.window.jsStallRatioMs.toFixed(2) ?? '?'} ` +
        `worstBlockUiJsStall=${worstJsStall.toFixed(2)} ` +
        `p50=${idle?.window.jsQueueLatencyP50MsSinceStart.toFixed(2) ?? '?'}`
    );
  }

  setStageCaptureEnabled(true);
  onLog('[overhead] RESULT done — compare the on/off pairs above');
}
