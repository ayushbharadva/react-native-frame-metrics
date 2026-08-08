# react-native-frame-metrics

Native frame timing for React Native — dropped frames and UI-thread FPS via a TurboModule, with independent JS-thread instrumentation.

> **Status: pre-release.** The API below is the design target, not yet a shipped implementation. See [Status](#status) for what currently works.

---

## Why this exists

When a React Native screen feels janky, "the app dropped frames" is not a diagnosis. Frames get dropped for two unrelated reasons, and the fix is different in each case:

- **UI thread drops** — expensive native layout, measurement, or draw work. The platform can't produce a frame in its 16.6ms budget.
- **JS thread drops** — expensive JavaScript blocking the runtime, so state updates and animations starve even when the UI thread is idle.

Most profiling tooling reports a single blended frame rate, which tells you *that* something is slow but not *where* to look. This library measures both independently, so the number you get points at the layer that actually needs fixing.

## How this differs from `react-native-performance`

[`react-native-performance`](https://github.com/oblador/react-native-performance) is a mature, actively maintained library and the right tool for a different job. It implements a Performance API surface for React Native — `mark()`, `measure()`, resource timing, and native timeline events like app startup and script execution time. It answers *"how long did this discrete thing take?"*

This library samples **continuous per-frame timing** and separates the two threads. It answers *"is this screen dropping frames right now, and which thread is responsible?"*

They're complementary. If you want startup and navigation timings, use `react-native-performance`. If you want to profile scroll jank on a specific list, use this.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  JavaScript                                             │
│                                                         │
│  ┌──────────────────────┐   ┌────────────────────────┐  │
│  │ JS-thread sampler    │   │ Typed JS API + overlay │  │
│  │ (rAF loop, measures  │   │                        │  │
│  │  JS runtime stalls)  │   │                        │  │
│  └──────────────────────┘   └───────────┬────────────┘  │
└───────────────────────────────────────── │ ─────────────┘
                                           │
                              Codegen-generated bindings
                                           │
┌───────────────────────────────────────── │ ─────────────┐
│  TurboModule (native)                    ▼              │
│                                                         │
│  ┌────────────────────────┐  ┌────────────────────────┐ │
│  │ Android — Kotlin       │  │ iOS — Objective-C++    │ │
│  │ Choreographer          │  │ CADisplayLink on the   │ │
│  │ .FrameCallback         │  │ main run loop          │ │
│  └────────────────────────┘  └────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Design notes

**Drops are inferred from timestamp gaps, not counted from missed callbacks.** Both `Choreographer.FrameCallback` and `CADisplayLink` are driven by the main thread. When that thread is blocked — exactly the condition worth measuring — the callback doesn't fire at all. So a dropped frame can't be observed directly; it's derived from the delta between consecutive callback timestamps against the display's refresh interval.

**JS-thread rate needs a separate mechanism.** It can't be read from the native frame callbacks, because those run on the UI thread. A JS-side loop measures runtime stalls independently, which is what makes the two-number output possible.

**Refresh rate is not assumed to be 60Hz.** The frame budget is derived from the display's actual refresh interval, so 90Hz and 120Hz devices report correctly rather than showing phantom drops.

## Planned API

```ts
import { start, stop, subscribe } from 'react-native-frame-metrics';

start();

const unsubscribe = subscribe((sample) => {
  // {
  //   uiThreadFps: number
  //   jsThreadFps: number
  //   droppedFrames: number
  //   frameBudgetMs: number
  // }
});
```

A dev-mode overlay component is planned for on-device inspection without wiring up a listener.

## Status

- [ ] Android — `Choreographer.FrameCallback` sampling
- [ ] Codegen spec and TurboModule bindings
- [ ] iOS — `CADisplayLink` sampling
- [ ] JS-thread instrumentation
- [ ] Dev-mode overlay component
- [ ] Example app with a jank-heavy list, profiled before and after optimization
- [ ] Published to npm

## Requirements

- React Native 0.76+ (New Architecture required — this is a TurboModule and has no legacy bridge fallback)
- Android and iOS

## License

MIT © Ayush Bharadva