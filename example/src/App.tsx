import { memo, useEffect, useState } from 'react';
import {
  DeviceEventEmitter,
  FlatList,
  NativeModules,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  FrameMetricsOverlay,
  start,
  stop,
  subscribe,
  type FrameMetricsSample,
} from 'react-native-frame-metrics';

/** Example-only Android module that sleeps the UI thread (StallPackage.kt). */
const exampleStall = NativeModules.ExampleStall as
  { blockUiThread(ms: number): void } | undefined;

const items = Array.from({ length: 400 }, (_, index) => ({
  id: String(index),
  title: `Frame lab row ${index + 1}`,
}));

function Row({ title, expensive }: { title: string; expensive: boolean }) {
  if (expensive) {
    // Deliberately bad render work: compare the same list with this removed.
    const end = performance.now() + 3;
    while (performance.now() < end) {
      /* intentional demo stall */
    }
  }
  return (
    <View style={styles.row}>
      <Text style={styles.rowText}>{title}</Text>
    </View>
  );
}
const FastRow = memo(Row);
const keyExtractor = (item: (typeof items)[number]) => item.id;
const renderFast = ({ item }: { item: (typeof items)[number] }) => (
  <FastRow title={item.title} expensive={false} />
);
const renderSlow = ({ item }: { item: (typeof items)[number] }) => (
  <Row title={item.title} expensive />
);
const getItemLayout = (_: unknown, index: number) => ({
  length: 56,
  offset: 56 * index,
  index,
});

function blockJs(ms: number) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    /* known JS stall */
  }
}

/** Sent through adb; see "Automated Android run" in example/README.md. */
type Command = { command?: string; ms?: number };

type Run = {
  samples: number;
  durationMs: number;
  frames: number;
  droppedFrames: number;
  uiStallMs: number;
  jsStallMs: number;
};

function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      style={styles.button}
      onPress={onPress}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

export default function App() {
  const [optimized, setOptimized] = useState(false);
  const [sample, setSample] = useState<FrameMetricsSample | null>(null);
  const [run, setRun] = useState<Run | null>(null);

  useEffect(() => {
    const mode = optimized ? 'optimized' : 'janky';
    const total: Run = {
      samples: 0,
      durationMs: 0,
      frames: 0,
      droppedFrames: 0,
      uiStallMs: 0,
      jsStallMs: 0,
    };
    setSample(null);
    setRun(null);
    const unsubscribe = subscribe((value) => {
      // One parseable line per sample for device runs (logcat tag ReactNativeJS).
      console.log(`[frame-metrics] mode=${mode} ${JSON.stringify(value)}`);
      total.samples += 1;
      total.durationMs += value.durationMs;
      total.frames += (value.uiThreadFps * value.durationMs) / 1000;
      total.droppedFrames += value.droppedFrames;
      total.uiStallMs += value.uiStallMs;
      total.jsStallMs += value.jsStallMs;
      setSample(value);
      setRun({ ...total });
    });
    start();
    return () => {
      unsubscribe();
      stop();
    };
  }, [optimized]);

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(
      'FrameMetricsCommand',
      ({ command, ms = 250 }: Command) => {
        console.log(`[frame-metrics] command=${command} ms=${ms}`);
        if (command === 'blockJs') blockJs(ms);
        else if (command === 'blockUi') exampleStall?.blockUiThread(ms);
        else if (command === 'janky') setOptimized(false);
        else if (command === 'optimized') setOptimized(true);
        else if (command === 'restart') {
          stop();
          start();
        }
      }
    );
    return () => subscription.remove();
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <Text style={styles.title}>Frame metrics lab</Text>
      <Text>Freeze one thread and watch which stall number moves.</Text>
      <View style={styles.buttons}>
        <Button label="Block JS 250 ms" onPress={() => blockJs(250)} />
        {exampleStall ? (
          <Button
            label="Block UI 250 ms"
            onPress={() => exampleStall.blockUiThread(250)}
          />
        ) : null}
      </View>
      <Button
        label={
          optimized
            ? 'Fast rows — switch to slow rows'
            : 'Slow rows (3 ms JS each) — switch to fast rows'
        }
        onPress={() => setOptimized(!optimized)}
      />
      <Text style={styles.stats}>
        {sample
          ? `UI ${sample.uiThreadFps.toFixed(0)} fps, ${sample.droppedFrames} dropped, ` +
            `${sample.uiStallMs.toFixed(0)} ms stall | JS ${sample.jsStallMs.toFixed(0)} ms stall`
          : 'Collecting samples...'}
      </Text>
      <Text>
        {run
          ? `Run: ${((run.frames * 1000) / run.durationMs).toFixed(1)} UI fps, ` +
            `${run.droppedFrames} dropped, UI stall ${run.uiStallMs.toFixed(0)} ms, ` +
            `JS stall ${run.jsStallMs.toFixed(0)} ms (${run.samples} samples)`
          : 'Run reset'}
      </Text>
      <FlatList
        key={String(optimized)}
        data={items}
        keyExtractor={keyExtractor}
        renderItem={optimized ? renderFast : renderSlow}
        getItemLayout={optimized ? getItemLayout : undefined}
        initialNumToRender={12}
        maxToRenderPerBatch={optimized ? 8 : 30}
        windowSize={optimized ? 5 : 21}
      />
      <FrameMetricsOverlay />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 100,
    backgroundColor: '#f8fafc',
  },
  title: { fontSize: 26, fontWeight: '700', color: '#0f172a', marginBottom: 8 },
  buttons: { flexDirection: 'row', gap: 10 },
  button: {
    flexGrow: 1,
    padding: 12,
    backgroundColor: '#1d4ed8',
    borderRadius: 8,
    marginTop: 10,
  },
  buttonText: { color: '#ffffff', fontWeight: '600' },
  stats: { marginTop: 12, fontWeight: '700' },
  row: {
    height: 56,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#cbd5e1',
  },
  rowText: { color: '#0f172a' },
});
