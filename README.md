# react-native-frame-metrics

See which thread is making a React Native screen janky. Measures UI-thread frame
drops and JS-thread stalls separately, natively on both threads, with a development
overlay. Android and iOS, New Architecture.

> **0.1.0, unpublished.** Android is validated on a physical device (Galaxy Z Fold4,
> Android 16, 120 Hz adaptive display) with React Native 0.85.0, and a packed build
> was checked in a clean React Native 0.76.9 app. iOS is implemented but has not been
> compiled or run yet because no macOS hardware was available. See [Status](#status).

## Why

When a screen feels janky, the fix depends on which thread fell behind:

- **UI thread**: native layout, mounting or drawing took longer than a frame.
- **JS thread**: JavaScript was busy, so updates and responses to touches waited,
  even if the UI thread kept drawing smoothly.

A single blended frame rate says _that_ something is slow, not _where_. This library
reports the two threads separately.

That takes native code on both sides. In React Native, `requestAnimationFrame` and
timers are fired from a UI-thread frame callback (`JavaTimerManager` on Android), so a
JavaScript loop that counts frames also slows down when only the UI thread is
blocked. On a Galaxy Z Fold4, a 500 ms UI-only freeze made such a loop report 12 fps
for JS while the JS thread was idle. This library instead times how long the JS
thread takes to run a task posted directly to its queue.

It complements tools such as `react-native-performance`, which time discrete marks
and measures, and it does not replace a platform profiler.

## Install

After 0.1.0 is published:

```sh
npm install react-native-frame-metrics
cd ios && pod install
```

Before then, run `yarn build` and `npm pack` in this repository and install the
`.tgz` in your app. Rebuild the native app after installing. Expo Go cannot load this
module; an Expo development build can.

Requires React Native **0.76 or newer with the New Architecture enabled** (Android
checked on 0.76.9 and 0.85.0).

On iPhone, add `CADisableMinimumFrameDurationOnPhone` (`true`) to the host app's
`Info.plist` so ProMotion displays can call back at 120 Hz. The example already does.

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
      if (sample.uiStallMs > 0 || sample.jsStallMs > 0) {
        console.log('UI stall', sample.uiStallMs, 'JS stall', sample.jsStallMs);
      }
    });
    start({ sampleIntervalMs: 500 });
    return () => {
      unsubscribe();
      stop();
    };
  }, []);

  return (
    <View style={{ flex: 1 }}>
      {/* your screen */}
      <FrameMetricsOverlay />
    </View>
  );
}
```

`start(options?)` starts one process-wide session. Repeated calls are no-ops; call
`stop()` first to change the interval. The default interval is 500 ms, and finite
values from 100 to 60000 ms are accepted. A blocked thread can delay delivery, but the
native side keeps counting, so the next sample covers the delay.

`stop()` is idempotent and stops JS polling, lifecycle observers, the native frame
callback and the JS-thread probe. Pending responses cannot reach a later session.
Subscriptions stay registered until their unsubscribe functions are called. Give one
owner responsibility for start/stop when several screens share a session.

`subscribe(listener)` returns an idempotent unsubscribe function. It does not start
sampling or replay old samples. Samples are frozen objects; a listener that throws is
reported to the console without stopping delivery to the others. A failed native read
stops sampling and is reported to the console.

`FrameMetricsOverlay` only observes samples, so start the session yourself. It renders
nothing and subscribes to nothing when `__DEV__` is false. The functions above also
work in release builds, which is where performance should be judged.

## Sample

| Field           | Meaning                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------- |
| `uiStallMs`     | UI-thread time beyond the frame budget, summed over the intervals that dropped frames              |
| `jsStallMs`     | JS-thread waiting time beyond the frame budget, measured by the native probe                       |
| `droppedFrames` | Inferred missed UI frames                                                                          |
| `uiThreadFps`   | UI frame callbacks per second; follows the display's current refresh rate                          |
| `frameBudgetMs` | Current frame budget, e.g. 8.33 ms at 120 Hz                                                       |
| `durationMs`    | Native time covered by the sample                                                                  |

All values cover one sample window; none are cumulative. Empty windows are not
delivered.

**Read the two stall numbers first.** They are in milliseconds, so they compare across
devices and refresh rates. A UI-only freeze raises `uiStallMs` and leaves `jsStallMs`
near zero; a JS-only freeze does the opposite. `droppedFrames` depends on the refresh
rate (the same one-second freeze is 119 frames at 120 Hz and 23 at 24 Hz), and
`uiThreadFps` drops whenever an adaptive display slows down: an untouched screen on
the Fold4 reads 24 fps with no stall at all.

## How it works

- **Android UI thread:** a `Choreographer.FrameCallback` records vsync timestamps.
  The frame budget comes from the display's refresh rate, re-read every frame.
- **iOS UI thread:** a `CADisplayLink` in common run-loop modes; the budget is
  `targetTimestamp - timestamp`.
- **Dropped frames:** each gap between callbacks is compared with the slower of the
  budgets on either side of it, and frames count as dropped from 1.85x the budget.
  Real drops land on whole multiples of the budget, while adaptive displays leave
  single 1.5x-1.8x gaps when they switch rate. Waking from idle takes longer: on the
  Fold4 a tap moved the panel from 24 Hz to 120 Hz with a 75-108 ms gap, so for three
  frames after a reported rate change one extra slow frame is allowed.
- **JS thread:** a background thread (Android) or dispatch queue (iOS) posts a no-op
  to the JS thread with `runOnJSQueueThread` (Android) or the TurboModule's
  `jsInvoker` (iOS), waits for it to run, and adds any wait beyond the frame budget
  to `jsStallMs`. One probe is in flight at a time, about every 16 ms while the
  thread is healthy.
- **Lifecycle:** sampling pauses in the background and starts from a fresh baseline
  on resume, so time away is not reported as a stall.

### Limits

- These are callback timings, not GPU presentation data. A frame lost after the UI
  thread finished on time is not counted; use `adb shell dumpsys gfxinfo`, Perfetto or
  Instruments for that.
- The JS probe samples. Stalls shorter than about 16 ms that begin and end between
  probes are missed, and long stalls can read up to one probe interval short.
- Both stall numbers use the current UI frame budget as the threshold, so on an idle
  24 Hz display JS work under about 42 ms is not counted.
- A UI stall that starts within three frames of a refresh-rate change reads one frame
  short, because of the allowance above.
- UI and JS numbers come from separate native accumulators read together; they are
  not a synchronized trace.
- While running, the frame callback and probe add a little work every frame. Use it to
  measure, then stop it.

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

Native accounting tests run on the JVM from the example's Gradle project:
`cd example/android && ./gradlew :react-native-frame-metrics:testReleaseUnitTest`.

The [example](example/README.md) has **Block UI** and **Block JS** buttons, a slow
and a fast list, and `example/scripts/android-validation.mjs`, which drives a device
over adb and checks that each stall lands on the right thread. Its README records the
device results.

## Status

### Done for 0.1.0

- [x] Android frame sampler and JS-thread probe, validated on a physical device
      (release build; three runs of the stall matrix passed)
- [x] Codegen spec and TurboModule API
- [x] Development overlay
- [x] Example app with stall buttons, slow/fast lists and a scripted device check
- [x] Jest tests for the JS API and JVM tests for native frame accounting
- [x] Packed tarball installed and run in a clean React Native 0.76.9 Android app
- [x] iOS sampler and JS-thread probe written (checked for Objective-C++ errors only)

### Before publishing 0.1.0

- [ ] iOS: build the example and a packed consumer app in Debug and Release, and run
      them on an iPhone (needs macOS; CI's `build-ios` job covers compilation)
- [ ] Review the final tarball and publish 0.1.0 with a matching `0.1.0` tag, as
      described in [RELEASING.md](RELEASING.md)

## License

MIT © Ayush Bharadva
