/** React Native supplies a monotonic clock even on releases without global TS declarations. */
export function now(): number {
  return (
    globalThis as unknown as { performance: { now(): number } }
  ).performance.now();
}
