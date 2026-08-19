import { useCallback, useEffect, useRef } from 'react';
import NativeFrameMetrics from './NativeFrameMetrics';

/** Sets a frame state. Passing `null` clears the key. */
export type SetFrameState = (key: string, value: string | null) => void;

/**
 * Label what the app is doing, from inside a component.
 *
 * Built for interaction states, where the label starts and stops in a callback
 * rather than tracking a mount:
 *
 * ```tsx
 * const setFrameState = useFrameState();
 *
 * <FlatList
 *   onScrollBeginDrag={() => setFrameState('interaction', 'scrolling')}
 *   onScrollEndDrag={() => setFrameState('interaction', null)}
 * />
 * ```
 *
 * Every key this hook set is cleared when the component unmounts. Without that,
 * a screen unmounted mid-scroll would leave `interaction=scrolling` active
 * forever and quietly poison every later bucket.
 */
export function useFrameState(): SetFrameState {
  const owned = useRef<Set<string>>(new Set());

  useEffect(() => {
    const keys = owned.current;
    return () => {
      keys.forEach((key) => NativeFrameMetrics.clearState(key));
      keys.clear();
    };
  }, []);

  return useCallback((key: string, value: string | null) => {
    if (value === null) {
      owned.current.delete(key);
      NativeFrameMetrics.clearState(key);
      return;
    }
    owned.current.add(key);
    NativeFrameMetrics.setState(key, value);
  }, []);
}
