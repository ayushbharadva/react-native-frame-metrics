import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { subscribe, type FrameMetricsSample } from './metrics';

function describe(sample: FrameMetricsSample) {
  return (
    `UI ${sample.uiThreadFps.toFixed(0)} fps | ${sample.droppedFrames} dropped | ` +
    `${sample.uiStallMs.toFixed(0)} ms stall\n` +
    `JS ${sample.jsStallMs.toFixed(0)} ms stall | budget ${sample.frameBudgetMs.toFixed(2)} ms`
  );
}

/** Observes an explicitly started session. Renders nothing in release builds. */
export function FrameMetricsOverlay() {
  const [sample, setSample] = useState<FrameMetricsSample | null>(null);
  useEffect(() => {
    if (!__DEV__) return undefined;
    return subscribe(setSample);
  }, []);
  if (!__DEV__) return null;
  return (
    <View pointerEvents="none" style={styles.overlay}>
      <Text style={styles.text}>
        {sample ? describe(sample) : 'Frame metrics: waiting for samples'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    bottom: 40,
    left: 12,
    right: 12,
    backgroundColor: '#111827',
    padding: 12,
    borderRadius: 8,
    zIndex: 10000,
  },
  text: { color: '#ffffff', fontSize: 12, fontVariant: ['tabular-nums'] },
});
