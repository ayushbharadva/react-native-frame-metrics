import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { FrameMetricsWindow } from 'react-native-frame-metrics';

export type TreeMode = 'flat' | 'deep' | 'shadow';

const LEAVES = 120;
const DEPTH = 60;

/**
 * Three view hierarchies designed to load different frame stages.
 *
 * A static tree is useless here — Android measures and lays out once, then the
 * stage costs fall to zero and the breakdown shows nothing. Every mode is driven
 * by a ticking counter that changes each leaf's content, so layout and draw are
 * re-done every frame and the stages have something to report.
 *
 * - `flat`   — the control. Same leaf count, one level deep.
 * - `deep`   — the same leaves under {@link DEPTH} nested wrappers. Should push
 *              `layoutMeasure`, the React Native hot spot.
 * - `shadow` — flat, but every leaf has elevation. Should push the GPU-side
 *              stages, `commandIssue` and `swapBuffers`.
 */
export function StageScreen({
  mode,
  live,
}: {
  mode: TreeMode;
  live: FrameMetricsWindow | null;
}) {
  const [tick, setTick] = useState(0);

  // Force a re-layout every frame. Without this the tree settles and every
  // stage reads ~0, which would look like the listener was broken.
  useEffect(() => {
    let running = true;
    const loop = () => {
      if (!running) return;
      setTick((t) => t + 1);
      requestAnimationFrame(loop);
    };
    const handle = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(handle);
    };
  }, []);

  const leaves = (
    <>
      {Array.from({ length: LEAVES }, (_, i) => (
        <View
          key={i}
          style={[
            styles.leaf,
            // Width varies with the tick so measure cannot be cached.
            { width: 40 + ((tick + i) % 30) },
            mode === 'shadow' && styles.shadowLeaf,
          ]}
        >
          <Text style={styles.leafText}>{(tick + i) % 100}</Text>
        </View>
      ))}
    </>
  );

  return (
    <View style={styles.container}>
      <View style={styles.tree}>
        {mode === 'deep' ? nest(leaves, DEPTH) : leaves}
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>
          {mode} · stage breakdown (ms/frame)
        </Text>
        {live?.stages ? (
          <>
            <StageRow
              label="layoutMeasure"
              value={live.stages.averageMs.layoutMeasure}
              worst={live.stages.worstFrameMsSinceStart.layoutMeasure}
            />
            <StageRow
              label="draw"
              value={live.stages.averageMs.draw}
              worst={live.stages.worstFrameMsSinceStart.draw}
            />
            <StageRow
              label="commandIssue"
              value={live.stages.averageMs.commandIssue}
              worst={live.stages.worstFrameMsSinceStart.commandIssue}
            />
            <StageRow
              label="swapBuffers"
              value={live.stages.averageMs.swapBuffers}
              worst={live.stages.worstFrameMsSinceStart.swapBuffers}
            />
            <StageRow
              label="total"
              value={live.stages.averageMs.total}
              worst={live.stages.worstFrameMsSinceStart.total}
            />
          </>
        ) : (
          <Text style={styles.empty}>
            stages: null — Android only, or nothing measured yet
          </Text>
        )}
      </View>
    </View>
  );
}

/**
 * Wrap [child] in [levels] nested Views that actually survive to the native tree.
 *
 * `collapsable={false}` is load-bearing. Fabric flattens away views that carry
 * no background, no touch handling and nothing else needing a real host view —
 * so a "deep" tree of plain wrappers arrives at Android as a *flat* one, and the
 * layout cost it was built to demonstrate never happens. Opting out of
 * flattening is what makes the hierarchy genuinely deep.
 */
function nest(child: ReactNode, levels: number): ReactNode {
  let out = child;
  for (let i = 0; i < levels; i++) {
    out = (
      <View collapsable={false} style={styles.wrapper}>
        {out}
      </View>
    );
  }
  return out;
}

function StageRow({
  label,
  value,
  worst,
}: {
  label: string;
  value: number;
  worst: number;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>
        {value.toFixed(2)}{' '}
        <Text style={styles.rowWorst}>/ {worst.toFixed(1)}</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tree: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  wrapper: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // A hairline of padding per level, so each wrapper genuinely affects the
    // layout of the one inside it rather than being a pass-through.
    paddingLeft: 0.5,
  },
  leaf: {
    height: 18,
    marginRight: 2,
    marginBottom: 2,
    backgroundColor: '#1b2027',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shadowLeaf: {
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  leafText: { color: '#5d6874', fontSize: 9 },
  panel: { paddingHorizontal: 16, paddingBottom: 16 },
  panelTitle: { color: '#8a97a6', fontSize: 12, marginBottom: 6 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  rowLabel: { color: '#8a97a6', fontSize: 11, fontFamily: 'monospace' },
  rowValue: { color: '#e6edf3', fontSize: 11, fontVariant: ['tabular-nums'] },
  rowWorst: { color: '#d29922' },
  empty: { color: '#5d6874', fontSize: 11, fontStyle: 'italic' },
});
