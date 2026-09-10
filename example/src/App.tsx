import { memo, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  FrameMetricsOverlay,
  start,
  stop,
  subscribe,
  type FrameMetricsSample,
} from 'react-native-frame-metrics';

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

export default function App() {
  const [optimized, setOptimized] = useState(false);
  const [sample, setSample] = useState<FrameMetricsSample | null>(null);
  const [summary, setSummary] = useState<{
    fps: number;
    drops: number;
    count: number;
  } | null>(null);
  useEffect(() => {
    setSample(null);
    let duration = 0;
    let frames = 0;
    let drops = 0;
    let count = 0;
    const unsubscribe = subscribe((value) => {
      setSample(value);
      duration += value.durationMs;
      frames += (value.uiThreadFps * value.durationMs) / 1000;
      drops += value.droppedFrames;
      count += 1;
      setSummary({ fps: (frames * 1000) / duration, drops, count });
    });
    setSummary(null);
    start();
    return () => {
      unsubscribe();
      stop();
    };
  }, [optimized]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Frame metrics lab</Text>
      <Text>Scroll each mode for 15 seconds on the same device.</Text>
      <Pressable
        accessibilityRole="button"
        style={styles.button}
        onPress={() => setOptimized(!optimized)}
      >
        <Text style={styles.buttonText}>
          {optimized
            ? 'Optimized list — switch to janky'
            : 'Janky list — switch to optimized'}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={styles.button}
        onPress={() => {
          const end = performance.now() + 250;
          while (performance.now() < end) {
            /* known JS stall */
          }
        }}
      >
        <Text style={styles.buttonText}>Block JS for 250 ms</Text>
      </Pressable>
      <Text style={styles.stats}>
        {sample
          ? `UI ${sample.uiThreadFps.toFixed(1)} / JS ${sample.jsThreadFps.toFixed(1)} FPS`
          : 'Collecting samples...'}
      </Text>
      <Text>
        {summary
          ? `Run: ${summary.fps.toFixed(1)} UI FPS, ${summary.drops} UI drops (${summary.count} samples)`
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
  button: {
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
