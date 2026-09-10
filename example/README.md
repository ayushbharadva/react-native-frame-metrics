# Frame metrics example

This app uses the local library. Install dependencies at the repository root with
`yarn install --immutable`. Run `yarn example android`, or on macOS install the
example's Ruby dependencies and pods (`cd example`, `bundle install`,
`bundle exec pod install --project-directory=ios`), then `yarn example ios`.

## Before/after profiling procedure

1. Use a physical device. Record model, OS, React Native version, display refresh
   setting, low-power mode, and Debug/Release mode. Prefer Release for comparisons.
2. Start the janky list, wait for initial render, and scroll down/up for 15 seconds.
   Record the displayed run average UI FPS and total inferred UI drops; note JS FPS.
3. Switch to the optimized list. The session and list reset. Repeat the same scroll
   pattern for 15 seconds. Record the same readings. Repeat three times per mode.
4. Press **Block JS for 250 ms**. Watch the next few samples for reduced JS cadence.
   UI cadence may remain healthy; a UI drop is not required for a JS stall.
5. Background for at least 5 seconds, then return. Confirm there is no giant drop
   count from background time. Stop/restart and reload the app to check cleanup.
6. On supported hardware, repeat at 60/90/120 Hz and change refresh settings during
   sampling. Check that switching does not create a false drop spike.
7. Test a UI-thread stall with platform debugging/profiling tools. Both JS and UI
   cadence may fall because rAF scheduling also depends on the UI thread.

The slow mode deliberately spends about 3 ms in each row render and renders larger
batches. The optimized mode removes that work, memoizes rows, supplies fixed layouts,
and uses smaller batches. This is a reproducible demonstration, not a claim about
a specific real app. Statistics include all samples since switching modes, including
idle time. Capture comparable durations and interactions.

## Results (fill from actual runs)

Android physical-device runs are pending. iOS builds and physical-iPhone runs are
deferred until macOS hardware is available. No device results have been recorded.

| Device / OS / RN / build / Hz | Mode      | Duration | UI FPS | UI drops | JS FPS observations |
| ----------------------------- | --------- | -------- | ------ | -------- | ------------------- |
| Pending physical-device run   | Janky     |          |        |          |                     |
| Pending physical-device run   | Optimized |          |        |          |                     |

Do not publish numerical claims until the runs are recorded. An emulator build
validates integration but cannot establish real-device performance accuracy.
