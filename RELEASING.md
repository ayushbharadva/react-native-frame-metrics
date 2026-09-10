# Releasing 0.1.0

## Current validation record

Version 0.1.0 is an unpublished release candidate. Development is currently on
Windows; all iOS builds and physical-iPhone validation are deferred until macOS
hardware is available. Keep those gates open and do not claim verified iOS support.

Checks recorded on 2026-09-09 against the uncommitted `feat/frame-metrics` checkout,
using Node 24.19.0, JDK 17, and the RN 0.85.0 example. CI uses the Node version in
`.nvmrc`; rerun release gates against the approved commit.

| Check                                            | Status                                                  |
| ------------------------------------------------ | ------------------------------------------------------- |
| JS tests                                         | Passed: 10 tests on Windows                             |
| ESLint and TypeScript                            | Passed on Windows                                       |
| Package build and Android codegen                | Passed on Windows                                       |
| npm tarball, exports, consumer TypeScript        | Passed; 44 files, Android autolinking metadata resolves |
| Android Debug and Release, RN 0.85.0             | Passed: arm64-v8a APKs, including Release lint          |
| Packed-package consumer build                    | Pending                                                 |
| Physical Android measurements                    | Pending                                                 |
| iOS compilation and physical-iPhone measurements | Deferred: macOS hardware unavailable                    |
| React Native 0.76 minimum compatibility          | Pending on both platforms                               |
| Final commit and CI                              | Pending maintainer approval and personal Git identity   |

The public npm registry currently lists 0.0.1; 0.1.0 is not published as of this
check. Package ownership and personal-account publish permission still need to be
confirmed before publishing.

The packed-package check installs the tarball into an isolated folder, resolves
published entry points and declarations without a source alias, and checks Android
autolinking metadata. It is not a clean consumer native build; that gate remains
pending. Local APKs are in `example/android/app/build/outputs/apk/debug/` and
`example/android/app/build/outputs/apk/release/`.

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
npm pack
```

CI is configured to build the Android and iOS examples. Require green CI on the
exact commit being released. Unit tests cover JS cadence at 60/90/120 Hz, stalls, lifecycle,
subscription cleanup, invalid intervals, failures, and stale asynchronous results.
They do not substitute for native compilation or device measurements.

On Windows, use `node .yarn/releases/yarn-4.11.0.cjs` in place of `yarn` if Corepack
is unavailable; do not change global tooling just for this project. With JDK 17 and
the Android SDK configured, run these from the repository root:

```powershell
$env:GRADLE_USER_HOME = Join-Path (Get-Location) '.gradle'
Push-Location example/android
.\gradlew.bat :app:assembleDebug :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon --console=plain
Pop-Location
```

This checks the arm64 variant; it does not verify every ABI or run the app. The
example Release APK uses the example debug key and is only for local validation.

## Native and consumer gates

- Build and run the example on physical Android and iOS devices; record the matrix
  and before/after results in `example/README.md`.
- Verify background/resume, stop/restart, reload, a JS stall, and a native UI stall.
- Check a high-refresh device and refresh changes. On iPhone verify the host
  `CADisableMinimumFrameDurationOnPhone` setting.
- Install the packed `.tgz` into a clean New Architecture app, run pods, and compile
  Android and iOS. Verify package exports, native autolinking, and TypeScript imports.
- Verify the intended lower bound, RN 0.76, on both platforms. If that cannot be
  supported, raise the peer dependency and README together before release.
- In Release, verify the overlay is absent and imperative sampling still works.

## Publish (maintainer action)

Before any commit, obtain the maintainer's approval and confirm the personal Git
name and email with `git var GIT_AUTHOR_IDENT` and `git var GIT_COMMITTER_IDENT`.
If a work identity is active, configure a repository-local personal identity only
after confirmation; do not change global Git settings. Confirm the personal npm
account separately with `npm whoami`; Git author identity does not select npm or
GitHub credentials.

Confirm the maintainer owns the existing npm package and the personal npm account
has publish permission. Review the tarball contents and version. After all gates pass:

```sh
npm login
npm whoami
npm publish ./react-native-frame-metrics-0.1.0.tgz --access public
```

Publish only the reviewed tarball from the approved release commit. Preparing this
checkout does not publish it. Create a matching `0.1.0` Git tag/release (the podspec
expects an unprefixed tag), and include the changelog and verified compatibility
matrix. Do not check npm tokens into this repository.
