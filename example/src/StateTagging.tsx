import { useCallback, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import {
  FrameState,
  useFrameState,
  type FrameMetricsWindow,
} from 'react-native-frame-metrics';

const ROWS = Array.from({ length: 2000 }, (_, i) => ({
  id: String(i),
  title: `Row ${i}`,
}));

const CRITICAL_MS_PER_S = 10;

type Screen = 'FeedList' | 'Profile';

/**
 * The demo M4 exists to make legible: two screens, one of them scrollable, and
 * a live per-bucket readout underneath.
 *
 * The list is deliberately unoptimised — no `getItemLayout`, no windowing
 * tuning, an inline `renderItem`. The point is to have something that actually
 * janks under scroll on real hardware, so the bucket that lights up is the one
 * you would have guessed.
 */
export function StateTagging({ live }: { live: FrameMetricsWindow | null }) {
  const [screen, setScreen] = useState<Screen>('FeedList');
  const setFrameState = useFrameState();

  const onScrollBeginDrag = useCallback(
    () => setFrameState('interaction', 'scrolling'),
    [setFrameState]
  );
  const onScrollEndDrag = useCallback(
    () => setFrameState('interaction', null),
    [setFrameState]
  );

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {(['FeedList', 'Profile'] as const).map((name) => (
          <Pressable
            key={name}
            onPress={() => setScreen(name)}
            style={[styles.chip, screen === name && styles.chipOn]}
          >
            <Text style={styles.chipText}>{name}</Text>
          </Pressable>
        ))}
      </View>

      {/* Tags every frame while mounted, and clears itself on unmount. */}
      <FrameState name="screen" value={screen}>
        <View style={styles.screen}>
          {screen === 'FeedList' ? (
            <FlatList
              data={ROWS}
              keyExtractor={(item) => item.id}
              onScrollBeginDrag={onScrollBeginDrag}
              onScrollEndDrag={onScrollEndDrag}
              onMomentumScrollEnd={onScrollEndDrag}
              renderItem={({ item }: ListRenderItemInfo<(typeof ROWS)[0]>) => (
                <View style={styles.item}>
                  <Text style={styles.itemText}>{item.title}</Text>
                  <Text style={styles.itemSub}>
                    {item.title.split('').reverse().join('')}
                  </Text>
                </View>
              )}
            />
          ) : (
            <View style={styles.profile}>
              <Text style={styles.profileText}>Profile</Text>
              <Text style={styles.profileSub}>
                Nothing renders here. Its bucket should stay clean.
              </Text>
            </View>
          )}
        </View>
      </FrameState>

      <Text style={styles.bucketsTitle}>Buckets — worst first</Text>
      <View style={styles.buckets}>
        {live?.states.length ? (
          live.states.map((bucket) => (
            <View key={bucket.key} style={styles.bucketRow}>
              <Text style={styles.bucketKey} numberOfLines={1}>
                {bucket.key}
              </Text>
              <Text
                style={[
                  styles.bucketValue,
                  bucket.hitchRatioMs > CRITICAL_MS_PER_S && styles.bucketBad,
                ]}
              >
                {bucket.hitchRatioMs.toFixed(1)} ms/s
              </Text>
            </View>
          ))
        ) : (
          <Text style={styles.bucketEmpty}>no frames bucketed yet</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  row: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#1b2027',
  },
  chipOn: { backgroundColor: '#2f81f7' },
  chipText: { color: '#e6edf3', fontSize: 13 },
  screen: {
    flex: 1,
    marginHorizontal: 16,
    borderRadius: 8,
    overflow: 'hidden',
  },
  item: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1b2027',
  },
  itemText: { color: '#e6edf3', fontSize: 14 },
  itemSub: { color: '#5d6874', fontSize: 11 },
  profile: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  profileText: { color: '#e6edf3', fontSize: 20, fontWeight: '700' },
  profileSub: { color: '#5d6874', fontSize: 12, marginTop: 6 },
  bucketsTitle: {
    color: '#8a97a6',
    fontSize: 12,
    paddingHorizontal: 16,
    marginTop: 12,
  },
  buckets: { paddingHorizontal: 16, paddingBottom: 16, minHeight: 74 },
  bucketRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
    gap: 12,
  },
  bucketKey: {
    color: '#8a97a6',
    fontSize: 11,
    fontFamily: 'monospace',
    flexShrink: 1,
  },
  bucketValue: {
    color: '#e6edf3',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  bucketBad: { color: '#ff7b72', fontWeight: '700' },
  bucketEmpty: { color: '#5d6874', fontSize: 11, fontStyle: 'italic' },
});
