# Changelog

## 0.1.0 — unreleased

- `start`/`stop`/`subscribe` sampler with frozen, per-window samples:
  `uiStallMs`, `jsStallMs`, `droppedFrames`, `uiThreadFps`, `frameBudgetMs`,
  `durationMs`.
- Android `Choreographer` and iOS `CADisplayLink` UI sampling that follows adaptive
  refresh rates without counting rate switches as dropped frames.
- Native JS-thread probe on both platforms, so a UI-only freeze is not reported as a
  JS stall.
- Pauses in the background and resumes from a fresh baseline.
- Development-only `FrameMetricsOverlay`.
- Example app with Block UI/Block JS buttons, slow and fast lists, and an adb-driven
  device validation script; Android results recorded on a Galaxy Z Fold4.
- Jest tests for the JS API and JVM tests for native frame accounting.
- Android checked on React Native 0.76.9 (packed tarball in a clean app) and 0.85.0.
