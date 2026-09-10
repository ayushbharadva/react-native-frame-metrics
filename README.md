# react-native-frame-metrics

Native UI frame-callback timing and JavaScript callback cadence for React Native,
with inferred UI drops and a development overlay. Android and iOS, New Architecture.

> **0.1.0 release candidate, unpublished.** The implementation is available in this
> checkout. Android Debug and Release builds pass; physical-device validation is
> pending. iOS build and device validation are
> deferred until macOS hardware is available. Release gates remain open; see
> [RELEASING.md](RELEASING.md).

## Install

After 0.1.0 is published:

```sh
npm install react-native-frame-metrics@0.1.0
cd ios && pod install
```

Before publication, run `yarn build` and `npm pack` in this repository, then install
that `.tgz` in your app. Rebuild the native app after installation. Expo Go cannot
load this module; an Expo development build with native autolinking can.

React Native **0.76+ with the New Architecture enabled** is the intended target.
The included example and current development checks use **0.85.0**. The minimum
version still needs a native compatibility run before it is claimed as verified.

On iPhone, enable `CADisableMinimumFrameDurationOnPhone` in the host app's
`Info.plist` to permit high-refresh display callbacks. The example already does.
The OS can lower callback cadence for power, thermal, or adaptive-refresh reasons.

## Use

```tsx
import { useEffect } from 'react';
import { View } from 'react-native';
import {
  start,
  stop,
  subscribe,
  FrameMetricsOverlay,
} from 'react-native-frame-metrics';

export function Screen() {
  useEffect(() => {
    const unsubscribe = subscribe((sample) => {
      // Keep listeners lightweight; avoid logging every sample in benchmarks.
      console.log(sample.uiThreadFps, sample.jsThreadFps, sample.droppedFrames);
    });
    start({ sampleIntervalMs: 500 });
    return () => {
      unsubscribe();
      stop();
    };
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <FrameMetricsOverlay />
    </View>
  );
}
```

`start(options?)` starts one process-wide session. Repeated calls are no-ops;
call `stop()` first to change its interval. The default interval is 500 ms, and
finite values from 100 to 60000 ms are accepted. The interval is a minimum delay
between reads; a blocked thread can delay delivery. Calls never overlap.

`stop()` is idempotent and cancels JS timers, rAF callbacks, lifecycle observers,
and native sampling. Pending responses cannot reach a later session. Subscriptions
remain registered until their unsubscribe functions are called. Give one owner
responsibility for start/stop when multiple screens share a session.

`subscribe(listener)` returns an idempotent unsubscribe function. It does not start
sampling or replay old samples. Listeners receive immutable samples; one throwing
listener is reported to the console without preventing delivery to others. A failed
native read stops sampling and reports the error to the console.

`FrameMetricsOverlay` only observes samples; start the session yourself. It renders
nothing and subscribes to nothing when `__DEV__` is false. The imperative API also
works in release builds, allowing profiling without development-mode overhead.

## Sample

| Field           | Meaning                                                         |
| --------------- | --------------------------------------------------------------- |
| `uiThreadFps`   | Observed native callback intervals / their elapsed seconds      |
| `jsThreadFps`   | Observed JS rAF callback intervals / their elapsed seconds      |
| `droppedFrames` | Inferred missed **UI** callback intervals in this native window |
| `frameBudgetMs` | Current native callback budget, e.g. about 16.67 ms at 60 Hz    |
| `durationMs`    | Elapsed native time covered by this sample                      |

Counts are per window, not cumulative. The first callback establishes a baseline;
empty native windows are not delivered. Native counts are accumulated even while
JavaScript is blocked. Sampling pauses in the background and discards its baseline,
so time spent away from the app is not reported as jank. Native refresh-budget
changes also discard the mixed-refresh window.

## How it works and what it cannot tell you

- **Android:** `Choreographer.FrameCallback` on the main thread, using frame
  timestamps and the host display's reported refresh rate.
- **iOS:** `CADisplayLink` in common run-loop modes, using its timestamp and
  target timestamp to obtain the callback budget.
- **JavaScript:** a separate `requestAnimationFrame` loop records the monotonic
  clock at execution, rather than trusting the supplied vsync timestamp.
- Each positive native gap contributes `max(0, round(gap / budget) - 1)` inferred
  drops. Half-interval rounding tolerates small timestamp jitter. Counters use
  constant memory and are read through a codegen-backed TurboModule promise.

These are **callback-cadence measurements**, not GPU presentation metrics, exact
rendered-frame counts, frame-stage timings, or automatic root-cause attribution.
A native animation can continue while JS cadence falls. However, React Native's
rAF scheduling also depends on native/UI scheduling, so **a UI stall can lower both
numbers**. A low JS value alone does not prove JavaScript caused the stall.

The JS and native windows are sampled separately and are not synchronized traces.
JS stalls delay delivery; refresh switches, timer ordering, adaptive display rates,
and system callback throttling can affect readings. A reported Android display rate
may differ from the cadence chosen for an individual app. Confirm findings with
Android Studio/Perfetto or Instruments. Run before/after comparisons on the same
physical device, build mode, and display settings; development overhead matters.

This complements tools such as `react-native-performance`, which measure discrete
marks and durations. It does not replace a platform profiler.

## Example and development

```sh
corepack enable
yarn install --immutable
yarn example android
# macOS: install example/Gemfile dependencies and example/ios pods first
yarn example ios

yarn lint
yarn typecheck
yarn test --runInBand
yarn build
npm pack --dry-run
```

The [example](example/README.md) switches between a list with deliberately expensive
row rendering and a memoized fixed-layout version. It also injects a known 250 ms JS
stall and displays per-run statistics. Actual before/after device measurements must
be recorded using the procedure in that guide; no benchmark results are fabricated.

## Roadmap

### Implemented for 0.1.0

Checked items describe implemented code, not verified device compatibility.

- [x] Android Choreographer sampler
- [x] Codegen spec and TurboModule API
- [x] iOS CADisplayLink sampler
- [x] JS callback instrumentation
- [x] Development overlay
- [x] Janky/optimized example with live statistics

### Before publishing 0.1.0

- [x] JS regression tests, lint, TypeScript, package build, and codegen checks
- [x] Android Debug and Release example builds (RN 0.85.0, arm64)
- [x] Inspect npm contents, package exports, consumer types, and Android autolinking
- [ ] Validate a packed npm tarball in a clean Android consumer app
- [ ] Record Android physical-device results, including lifecycle and refresh changes
- [ ] Verify the intended React Native 0.76 minimum, or narrow the supported range
- [ ] Complete the deferred iOS validation below
- [ ] Review the final tarball and release checks in [RELEASING.md](RELEASING.md)
- [ ] Publish 0.1.0 to npm and create the matching `0.1.0` Git tag

### Deferred until macOS hardware is available

- [ ] Compile the iOS example and a packed-package consumer in Debug and Release
- [ ] Record physical-iPhone before/after results and lifecycle/high-refresh checks
- [ ] Verify iOS compatibility at the declared minimum React Native version

Current development is on Windows. The iOS implementation is retained for later
validation; it is not yet verified. Deferring these checks does not mark the
cross-platform release ready. Device results belong in the
[example validation record](example/README.md#results-fill-from-actual-runs).

## License

MIT © Ayush Bharadva
