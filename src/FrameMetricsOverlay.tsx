import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { subscribe, type FrameMetricsSample } from './metrics';

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
        {sample
          ? `UI ${sample.uiThreadFps.toFixed(1)} FPS | JS ${sample.jsThreadFps.toFixed(1)} FPS\nUI drops ${sample.droppedFrames} | budget ${sample.frameBudgetMs.toFixed(2)} ms`
          : 'Frame metrics: waiting for samples'}
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
