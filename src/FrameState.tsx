import { useEffect, type ReactNode } from 'react';
import NativeFrameMetrics from './NativeFrameMetrics';

export type FrameStateProps = {
  /** The state key, e.g. `screen`. */
  name: string;
  /** The value for that key, e.g. `FeedList`. */
  value: string;
  children?: ReactNode;
};

/**
 * Label frames for as long as this is mounted.
 *
 * ```tsx
 * <FrameState name="screen" value="FeedList">
 *   <Feed />
 * </FrameState>
 * ```
 *
 * Renders its children untouched — no wrapper view, so it cannot affect the
 * layout it is measuring.
 *
 * The set and the clear live in **separate effects on purpose.** Combining them
 * would mean a `value` change runs cleanup then setup, leaving the key briefly
 * unset — and a frame landing in that gap would be misattributed to whatever
 * else was active. Split this way, changing `value` only re-runs the set, and
 * the key is cleared only when `name` changes or the component unmounts.
 */
export function FrameState({ name, value, children }: FrameStateProps) {
  useEffect(() => {
    NativeFrameMetrics.setState(name, value);
  }, [name, value]);

  useEffect(() => {
    return () => NativeFrameMetrics.clearState(name);
  }, [name]);

  return <>{children}</>;
}
