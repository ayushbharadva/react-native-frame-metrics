# Frame metrics example

This app uses the local library. Install dependencies at the repository root with
`yarn install --immutable`, then run `yarn example android`. On macOS, install the
example's Ruby dependencies and pods (`cd example`, `bundle install`,
`bundle exec pod install --project-directory=ios`), then run `yarn example ios`.

## What to try

- **Block JS 250 ms** busy-loops JavaScript. Expect `JS ... ms stall` to rise while
  the UI numbers stay at zero.
- **Block UI 250 ms** (Android only) sleeps the UI thread through an example-only
  native module (`StallPackage.kt`). Expect the UI stall and dropped frames to rise
  while the JS stall stays at zero.
- **Slow rows / fast rows** switches between a list whose rows each spend 3 ms of
  JavaScript while rendering and a memoized, fixed-layout version. Scroll both. On
  Fabric, row rendering runs on the JS thread, so the slow list shows up as JS stall
  (late or blank rows) rather than dropped UI frames.

The overlay only renders in development builds. Release builds show the same
numbers in the stats line, and every sample is logged to logcat (tag
`ReactNativeJS`) as `[frame-metrics] mode=<mode> {json}`.

## Automated Android run

`scripts/android-validation.mjs` installs a build, applies known stimuli over adb,
and checks that each stall lands on the right thread. It needs Node and `adb`.
Build a release APK first; debug builds depend on Metro and are slower.

```sh
cd example/android
./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
cd ../..
node example/scripts/android-validation.mjs --serial <adb id> \
  --apk example/android/app/build/outputs/apk/release/app-release.apk
```

It runs these phases (choose with `--phases idle,stalls,scroll,lifecycle`):

1. **idle** — 6 s untouched.
2. **stalls** — UI and JS blocks of 100, 500 and 2000 ms, sent through
   `adb shell am broadcast -a framemetrics.example.COMMAND --es command blockUi|blockJs`.
3. **scroll** — 15 s of flings on the slow list, then on the fast list, with
   `dumpsys gfxinfo` as an independent system measurement.
4. **lifecycle** — 8 s in the background, resume, then stop/start the sampler.

Pass criteria: a block of N ms reports N ± 60 ms of stall on its own thread and at
most 10% of N on the other; nothing is sampled in the background; resuming reports
no stall for the time away; the app does not crash. Results and the raw log are
written to `validation-results/` (`--out` to change).

Only apps that hold `android.permission.DUMP` (adb shell does) can send these
commands; the receiver exists only in this example app.

## Results

Recorded 2026-09-16 with release builds of this example (React Native 0.85.0).

### Samsung Galaxy Z Fold4 (SM-F936B), Android 16, 120 Hz adaptive (idles at 24 Hz)

Three runs of the stall matrix; all checks passed in each.

| Stimulus           | UI stall (runs 1/2/3) | JS stall (runs 1/2/3) |
| ------------------ | --------------------- | --------------------- |
| UI block 100 ms    | 83 / 42 / 42 ms       | 0 / 0 / 0 ms          |
| UI block 500 ms    | 458 / 458 / 500 ms    | 0 / 0 / 0 ms          |
| UI block 2000 ms   | 1950 / 1958 / 1958 ms | 1 / 0 / 0 ms          |
| JS block 100 ms    | 0 / 0 / 0 ms          | 77 / 46 / 54 ms       |
| JS block 500 ms    | 0 / 0 / 0 ms          | 462 / 454 / 450 ms    |
| JS block 2000 ms   | 0 / 0 / 0 ms          | 1947 / 1944 / 1987 ms |
| Idle, 6 s at 24 Hz | 0 ms, 0 dropped       | 0 ms                  |

Stalls are measured beyond the frame budget, and a blocked thread resumes on a vsync,
so a 100 ms block at 24 Hz (41.7 ms budget) reads 42 or 83 ms depending on alignment.

Scrolling for 15 s (run 1):

| List      | UI fps | Dropped | UI stall | JS stall | gfxinfo frames / janky / p99 |
| --------- | ------ | ------- | -------- | -------- | ---------------------------- |
| Slow rows | 115.9  | 0       | 0 ms     | 1168 ms  | 1791 / 7 / 8 ms              |
| Fast rows | 117.2  | 7       | 58 ms    | 152 ms   | 1799 / 16 / 10 ms            |

The UI thread kept up in both modes, and the optimization shows up as 7.7x less JS
stall. The fast list drops a few more UI frames because JS keeps up and more rows mount
per frame; the system's own jank count moves the same way.

Lifecycle: no samples while backgrounded, 0 ms stall on resume, samples continued after
stop/start.

Taps from an idle 24 Hz screen, where the panel takes 75-108 ms to wake to 120 Hz:

| Tap                              | UI stall        | JS stall              |
| -------------------------------- | --------------- | --------------------- |
| Empty list area (6 taps)         | 0 ms each       | 0-9 ms                |
| **Block JS 250 ms** (4 taps)     | 0 ms each       | 237 / 254 / 240 / 244 ms |
| **Block UI 250 ms** (3 taps)     | 242 / 233 / 242 ms | 8 / 8 / 0 ms       |

For comparison, the earlier `requestAnimationFrame`-based JS measurement on the same
phone read 12 fps UI **and** 12 fps JS during a 500 ms UI-only block, and once
reported a 2000 ms UI block as a single dropped frame.

### Android emulator (sdk_gphone64_x86_64), Android 15, 60 Hz, 4 vCPUs

All 16 checks passed. UI blocks of 100/500/2000 ms reported 133/483/2033 ms UI stall
and 0 ms JS stall; JS blocks reported 74/470/1971 ms JS stall with 0-17 ms UI stall.
The emulator dropped 5 frames (83 ms) while idle, and a run on an earlier build failed
2 checks on 17 and 233 ms of UI stall during JS blocks. Treat emulator numbers as
integration checks, not performance data.

### Not yet measured

iOS has not been built or run; this needs macOS hardware. Record iPhone results here
before claiming iOS support.
