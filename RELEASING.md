# Releasing 0.1.0

## Validation record

Version 0.1.0 is unpublished. Checks below were run on 2026-09-16 on Windows (Node
20.19.4, JDK 17) against `feat/frame-metrics`. CI uses the Node version in `.nvmrc`;
rerun the gates against the exact commit being released.

| Check                                                    | Status                                                                                   |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Jest (JS API)                                            | Passed: 7 tests                                                                          |
| JVM unit tests (native frame accounting)                 | Passed: 10 tests                                                                         |
| ESLint and TypeScript                                    | Passed                                                                                   |
| Package build and npm contents                           | Passed: 35 files, no native test sources                                                 |
| Example Android release build, RN 0.85.0                 | Passed: arm64-v8a and x86_64                                                             |
| Physical Android device (Galaxy Z Fold4, Android 16)     | Passed: stall attribution (3 runs), scrolling, lifecycle; see `example/README.md`        |
| Android emulator (API 35, 60 Hz)                         | Passed on the final build; noisy (drops frames while idle), not performance data        |
| Android emulator (API 31, Android 12, 60 Hz)             | Passed: all 16 checks, 0 dropped frames while idle                                       |
| Development overlay in a debug build (Fold4, Metro)      | Renders; Block UI and Block JS move only their own thread's stall                        |
| Packed tarball in a clean RN 0.76.9 Android app          | Passed after a fix: release build, autolinking, TypeScript 5.0, samples and stalls on the Fold4 |
| iOS source                                               | Objective-C++ syntax check against stub headers only                                     |
| iOS build and physical-iPhone run                        | Not done: needs macOS                                                                    |
| CI on the release commit                                 | Not run: nothing has been pushed                                                         |

The first RN 0.76.9 consumer build failed to compile: `ReactModuleInfo` parameter
names differ between React Native versions, so `FrameMetricsPackage.kt` now passes
them positionally. That app was then built in Release, installed from the packed
`.tgz`, and run on the Fold4: a scheduled 400 ms JS block read 382 ms JS stall and
0 ms UI stall, and four taps on its button from an idle screen read 277-292 ms JS
stall with no UI stall.

The npm registry lists `react-native-frame-metrics@0.0.1`, maintained by
`aayush.bharadva`; 0.1.0 is not published.

## Automated gates

Use the Node version in `.nvmrc` and the bundled Yarn release.

```sh
corepack enable
yarn install --immutable
yarn lint
yarn typecheck
yarn test --runInBand --coverage
yarn build
npm pack --dry-run
```

Native accounting tests (JVM, no device):

```sh
cd example/android
./gradlew :react-native-frame-metrics:testReleaseUnitTest
```

On Windows, use `node .yarn/releases/yarn-4.11.0.cjs` in place of `yarn` if Corepack is
unavailable, and quote comma-separated Gradle properties in PowerShell:

```powershell
Push-Location example/android
.\gradlew.bat :app:assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64' --console=plain
Pop-Location
```

The example release APK is signed with the example debug key and is only for local
validation.

## Device gates

- **Android:** install a release build of the example on a physical device and run
  `node example/scripts/android-validation.mjs --serial <id> --apk <apk>`. All checks
  must pass; record the table in `example/README.md`. Prefer a high-refresh or
  adaptive-refresh device, and repeat the stall phases at least three times.
- **iOS:** build and run the example on an iPhone in Release. Tap **Block JS 250 ms**
  and confirm JS stall rises with no UI stall, confirm background/resume reports no
  stall, and check a ProMotion device at 120 Hz with
  `CADisableMinimumFrameDurationOnPhone` set. There is no Block UI button on iOS; use a
  temporary main-thread `usleep` or Instruments to confirm UI stalls are not reported
  as JS stalls. Record the results in `example/README.md`.
- **Consumer app:** install the packed `.tgz` into a clean New Architecture app at the
  lowest supported React Native version (0.76), build Android and iOS in Release, and
  confirm samples arrive. If a platform fails, raise the peer dependency and the README
  together before releasing.
- In Release, confirm the overlay is absent and `subscribe` still delivers samples.

## Publish (maintainer action)

Before committing or tagging, confirm the Git identity with `git var GIT_AUTHOR_IDENT`.
Confirm the npm account separately with `npm whoami`; Git identity does not select npm
or GitHub credentials. Confirm the account can publish `react-native-frame-metrics`.

After every gate passes on the release commit and CI is green:

```sh
npm pack
npm publish ./react-native-frame-metrics-0.1.0.tgz --access public
git tag 0.1.0
git push origin 0.1.0
```

Publish only the reviewed tarball from the release commit. The podspec expects an
unprefixed tag (`0.1.0`). Include the changelog and the verified device matrix in the
GitHub release. Never commit npm tokens.
