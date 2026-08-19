import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  getSnapshot,
  start,
  startDriftMeter,
  stop,
  subscribe,
  type FrameMetricsWindow,
  type FrameSnapshot,
} from 'react-native-frame-metrics';
import {
  CRITICAL_MS_PER_S,
  SCENARIOS,
  formatResult,
  runMatrix,
  runScenario,
  type Scenario,
  type ScenarioResult,
} from './acceptance';
import { StateTagging } from './StateTagging';
import {
  formatStateResult,
  runStateMatrix,
  type StateResult,
} from './stateFixture';
import { StageScreen, type TreeMode } from './StageScreen';
import { runOverheadCheck, runStageMatrix } from './stageFixture';

const DURATIONS_MS = [100, 500, 2000];
const SETTLE_MS = 900;

type Props = { autorun?: string };

export default function App({ autorun }: Props) {
  const [live, setLive] = useState<FrameMetricsWindow | null>(null);
  const [drift, setDrift] = useState(0);
  const [results, setResults] = useState<ScenarioResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [duration, setDuration] = useState(500);
  const [raw, setRaw] = useState<FrameSnapshot | null>(null);
  const [tab, setTab] = useState<'matrix' | 'states' | 'stages'>('matrix');
  const [treeMode, setTreeMode] = useState<TreeMode>('flat');

  const driftMeter = useRef<ReturnType<typeof startDriftMeter> | null>(null);

  // Read inside the subscribe callback without re-subscribing on every change.
  const busyRef = useRef(false);
  busyRef.current = busy;

  useEffect(() => {
    start();
    driftMeter.current = startDriftMeter(getSnapshot().frameBudgetMs);

    const unsubscribe = subscribe((next) => {
      setLive(next);
      // Only read the drift meter here when no scenario is running — a scenario
      // consumes the accumulator itself, and a double read would steal its data.
      if (!busyRef.current) setDrift(driftMeter.current?.read() ?? 0);
    });

    return () => {
      unsubscribe();
      driftMeter.current?.stop();
      stop();
    };
  }, []);

  // Raw counter poller. Reads the native accumulators directly on its own
  // timer and logs regardless of run state.
  //
  // This is the only honest way to check that sampling paused: a quiet
  // `subscribe` proves the *JS timer* stopped, which says nothing about the
  // frame callback. Compare `frames` either side of a background gap — flat
  // means the callback really stopped, growing means it did not.
  useEffect(() => {
    const timer = setInterval(() => {
      const snapshot = getSnapshot();
      setRaw(snapshot);
      console.log(
        `[raw] ${new Date().toTimeString().slice(0, 8)}` +
          ` elapsed=${snapshot.elapsedMs.toFixed(0)}ms` +
          ` frames=${snapshot.frameCount}` +
          ` sampling=${snapshot.sampling}` +
          ` started=${snapshot.started}` +
          ` pauses=${snapshot.pauseCount}` +
          ` state=${snapshot.currentStateKey}` +
          ` stageFrames=${snapshot.stages?.frameCount ?? 'null'}` +
          ` outliers=${snapshot.outlierCount}` +
          `/${snapshot.outlierMs.toFixed(0)}ms`
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const push = useCallback((result: ScenarioResult) => {
    console.log(formatResult(result));
    setResults((prev) => [result, ...prev].slice(0, 24));
  }, []);

  const runOne = useCallback(
    async (scenario: Scenario) => {
      if (busy || !driftMeter.current) return;
      setBusy(true);
      try {
        push(
          await runScenario(
            scenario,
            scenario.key === 'idle' ? 0 : duration,
            driftMeter.current,
            SETTLE_MS
          )
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, duration, push]
  );

  const runAll = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setResults([]);
    try {
      const all = await runMatrix(DURATIONS_MS, SETTLE_MS, push);
      const passed = all.filter((r) => r.pass).length;
      const gate = all.filter((r) => r.key === 'blockUI').every((r) => r.pass);
      console.log(
        `[2x2] RESULT rows=${passed}/${all.length} gate=${gate ? 'PASS' : 'FAIL'}`
      );
    } finally {
      setBusy(false);
    }
  }, [busy, push]);

  const runStates = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    // Deliberately does NOT switch to the states tab. The fixture owns the
    // `screen` and `interaction` keys for the duration of the run and clears
    // them at the end; if <FrameState> were mounted at the same time the two
    // would fight over the same key and the demo would come back untagged.
    try {
      await runStateMatrix(
        (result: StateResult) => console.log(formatStateResult(result)),
        (line: string) => console.log(line)
      );
    } finally {
      setBusy(false);
    }
  }, [busy]);

  // Unlike the other two, this one *does* need its screen mounted — stages only
  // report what actually rendered, so there has to be a tree to render.
  const runStages = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setTab('stages');
    try {
      await runStageMatrix(setTreeMode, (line: string) => console.log(line));
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const runOverhead = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await runOverheadCheck(DURATIONS_MS, SETTLE_MS, (line: string) =>
        console.log(line)
      );
    } finally {
      setBusy(false);
    }
  }, [busy]);

  // Headless entry points. All wait for the probe and frame callback to reach
  // a steady baseline first, so the opening scenario is not measured against
  // app-startup noise.
  useEffect(() => {
    const modes = ['2x2', 'states', 'stages', 'overhead'];
    if (!autorun || !modes.includes(autorun)) return;
    const timer = setTimeout(() => {
      if (autorun === '2x2') runAll();
      else if (autorun === 'states') runStates();
      else if (autorun === 'overhead') runOverhead();
      else runStages();
    }, 3000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autorun]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        2×2 acceptance test
        <Text style={raw?.sampling ? styles.stateOn : styles.stateOff}>
          {raw === null ? '' : raw.sampling ? '  ● sampling' : '  ○ paused'}
        </Text>
      </Text>

      <View style={styles.row}>
        {(['matrix', 'states', 'stages'] as const).map((name) => (
          <Pressable
            key={name}
            onPress={() => setTab(name)}
            style={[styles.chip, tab === name && styles.chipOn]}
          >
            <Text style={styles.chipText}>
              {name === 'matrix'
                ? '2×2'
                : name === 'states'
                  ? 'States'
                  : 'Stages'}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'states' ? (
        <StateTagging live={live} />
      ) : tab === 'stages' ? (
        <StageScreen mode={treeMode} live={live} />
      ) : (
        <>
          <View style={styles.panel}>
            <Metric
              label="hitch ratio"
              value={live?.hitchRatioMs}
              unit="ms/s"
              bad={(live?.hitchRatioMs ?? 0) > CRITICAL_MS_PER_S}
            />
            <Metric
              label="JS stall ratio"
              value={live?.jsStallRatioMs}
              unit="ms/s"
              bad={(live?.jsStallRatioMs ?? 0) > CRITICAL_MS_PER_S}
            />
            <Metric
              label="setTimeout drift"
              value={drift}
              unit="ms/s"
              bad={drift > CRITICAL_MS_PER_S}
              note="contaminated"
            />
            <View style={styles.divider} />
            <Metric
              label="probes"
              value={live?.jsProbeCount}
              unit=""
              digits={0}
            />
            <Metric
              label="JS latency p50"
              value={live?.jsQueueLatencyP50MsSinceStart}
              unit="ms"
              digits={2}
            />
            <Metric
              label="JS latency p95"
              value={live?.jsQueueLatencyP95MsSinceStart}
              unit="ms"
              digits={2}
            />
            <Metric
              label="frame budget"
              value={live?.frameBudgetMs}
              unit="ms"
              digits={2}
            />
            <View style={styles.divider} />
            <Metric label="fps" value={live?.fps} unit="" note="secondary" />
            <Metric
              label="background pauses"
              value={raw?.pauseCount}
              unit=""
              digits={0}
            />
            <Metric
              label="outliers"
              value={raw?.outlierCount}
              unit=""
              digits={0}
              bad={(raw?.outlierCount ?? 0) > 0}
            />
          </View>

          <View style={styles.row}>
            {DURATIONS_MS.map((ms) => (
              <Pressable
                key={ms}
                onPress={() => setDuration(ms)}
                style={[styles.chip, duration === ms && styles.chipOn]}
              >
                <Text style={styles.chipText}>{ms}ms</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.row}>
            {SCENARIOS.map((scenario) => (
              <Pressable
                key={scenario.key}
                onPress={() => runOne(scenario)}
                disabled={busy}
                style={[styles.button, busy && styles.buttonOff]}
              >
                <Text style={styles.buttonText}>{scenario.label}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.row}>
            <Pressable
              onPress={runAll}
              disabled={busy}
              style={[styles.runAll, styles.grow, busy && styles.buttonOff]}
            >
              <Text style={styles.buttonText}>
                {busy ? 'running…' : 'Run full matrix'}
              </Text>
            </Pressable>
            <Pressable
              onPress={runStates}
              disabled={busy}
              style={[styles.runAll, styles.grow, busy && styles.buttonOff]}
            >
              <Text style={styles.buttonText}>Run state matrix</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.log}>
            {results.map((result, i) => (
              <Text
                key={`${result.key}-${result.durationMs}-${i}`}
                style={[styles.logLine, !result.pass && styles.logFail]}
              >
                {formatResult(result)}
              </Text>
            ))}
          </ScrollView>
        </>
      )}
    </View>
  );
}

function Metric({
  label,
  value,
  unit,
  bad,
  note,
  digits = 1,
}: {
  label: string;
  value: number | undefined;
  unit: string;
  bad?: boolean;
  note?: string;
  digits?: number;
}) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>
        {label}
        {note ? <Text style={styles.metricNote}> ({note})</Text> : null}
      </Text>
      <Text style={[styles.metricValue, bad && styles.metricBad]}>
        {value === undefined ? '—' : `${value.toFixed(digits)} ${unit}`.trim()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#101418', paddingTop: 48 },
  title: {
    color: '#e6edf3',
    fontSize: 18,
    fontWeight: '700',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  panel: { paddingHorizontal: 16 },
  metric: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  stateOn: { color: '#7ee787', fontSize: 12, fontWeight: '600' },
  stateOff: { color: '#d29922', fontSize: 12, fontWeight: '600' },
  metricLabel: { color: '#8a97a6', fontSize: 13 },
  metricNote: { color: '#5d6874', fontSize: 11, fontStyle: 'italic' },
  metricValue: {
    color: '#e6edf3',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  metricBad: { color: '#ff7b72', fontWeight: '700' },
  divider: { height: 1, backgroundColor: '#232a33', marginVertical: 8 },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    marginTop: 12,
  },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#1b2027',
  },
  chipOn: { backgroundColor: '#2f81f7' },
  chipText: { color: '#e6edf3', fontSize: 13 },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#1b2027',
  },
  buttonOff: { opacity: 0.4 },
  buttonText: { color: '#e6edf3', fontSize: 13, fontWeight: '600' },
  grow: { flex: 1, marginHorizontal: 0, marginTop: 0 },
  runAll: {
    marginTop: 12,
    marginHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#2f81f7',
    alignItems: 'center',
  },
  log: { flex: 1, marginTop: 14, paddingHorizontal: 16 },
  logLine: {
    color: '#7ee787',
    fontSize: 10,
    fontFamily: 'monospace',
    marginBottom: 3,
  },
  logFail: { color: '#ff7b72' },
});
