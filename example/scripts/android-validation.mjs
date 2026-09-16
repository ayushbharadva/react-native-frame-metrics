#!/usr/bin/env node
// Drives the example app on an Android device over adb and checks that UI and JS stalls are
// attributed to the right thread. See example/README.md ("Automated Android run").
//
//   node example/scripts/android-validation.mjs --serial <id> [--apk <path>] [--out <dir>]
//        [--phases idle,stalls,scroll,lifecycle]
import { execFileSync, spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
}
const serial = args.serial;
const out = args.out ?? 'validation-results';
const phases = new Set((args.phases ?? 'idle,stalls,scroll,lifecycle').split(','));
if (!serial) {
  console.error('Pass --serial <adb device id> (see `adb devices`).');
  process.exit(2);
}
const PKG = 'framemetrics.example';
const STALLS_MS = [100, 500, 2000];

const adb = (...rest) =>
  execFileSync('adb', ['-s', serial, ...rest], { encoding: 'utf8', maxBuffer: 64 << 20 });
const shell = (command) => adb('shell', command);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mark = (phase) => shell(`log -t FrameMetricsRun "phase=${phase}"`);
const command = (name, ms = 250) =>
  shell(`am broadcast -a ${PKG}.COMMAND -p ${PKG} --es command ${name} --ei ms ${ms}`);

function gfxinfo() {
  const text = shell(`dumpsys gfxinfo ${PKG}`);
  const read = (pattern) => Number(text.match(pattern)?.[1] ?? NaN);
  return {
    frames: read(/Total frames rendered: (\d+)/),
    janky: read(/Janky frames: (\d+)/),
    p90Ms: read(/90th percentile: (\d+)ms/),
    p99Ms: read(/99th percentile: (\d+)ms/),
  };
}

async function scroll(ms) {
  const [width, height] = shell('wm size').match(/(\d+)x(\d+)\s*$/m).slice(1).map(Number);
  const x = Math.round(width / 2);
  const [low, high] = [Math.round(height * 0.8), Math.round(height * 0.4)];
  for (let i = 0, end = Date.now() + ms; Date.now() < end; i++) {
    // Four flings down, four back up, so rows keep mounting without reaching an end.
    const down = Math.floor(i / 4) % 2 === 0;
    shell(`input swipe ${x} ${down ? low : high} ${x} ${down ? high : low} 120`);
    await sleep(250);
  }
}

const device = Object.fromEntries(
  ['ro.product.manufacturer', 'ro.product.model', 'ro.build.version.release', 'ro.product.cpu.abi'].map(
    (key) => [key.split('.').pop(), shell(`getprop ${key}`).trim()]
  )
);
console.log('Device', device);
mkdirSync(out, { recursive: true });
if (args.apk) adb('install', '-r', args.apk);

adb('logcat', '-c');
const logPath = join(out, 'logcat.txt');
const logFile = createWriteStream(logPath);
const logcat = spawn('adb', [
  '-s', serial, 'logcat', '-v', 'epoch',
  'ReactNativeJS:V', 'FrameMetricsRun:V', 'FrameMetrics:V', 'AndroidRuntime:E', '*:S',
]);
logcat.stdout.pipe(logFile);

const gfx = {};
shell(`am force-stop ${PKG}`);
mark('launch');
shell(`am start -W -n ${PKG}/.MainActivity`);
await sleep(5000);

if (phases.has('idle')) {
  mark('idle');
  await sleep(6000);
}
if (phases.has('stalls')) {
  for (const ms of STALLS_MS) {
    mark(`uiBlock${ms}`);
    command('blockUi', ms);
    await sleep(ms + 2500);
    mark(`jsBlock${ms}`);
    command('blockJs', ms);
    await sleep(ms + 2500);
  }
}
if (phases.has('scroll')) {
  for (const mode of ['janky', 'optimized']) {
    command(mode);
    await sleep(2500);
    shell(`dumpsys gfxinfo ${PKG} reset`);
    mark(`scroll-${mode}`);
    await scroll(15000);
    gfx[mode] = gfxinfo();
    mark(`settle-${mode}`);
    await sleep(2500);
  }
  command('janky');
  await sleep(1500);
}
if (phases.has('lifecycle')) {
  mark('background');
  shell('input keyevent KEYCODE_HOME');
  await sleep(8000);
  mark('resume');
  shell(`am start -n ${PKG}/.MainActivity`);
  await sleep(4000);
  mark('restart');
  command('restart');
  await sleep(3000);
}
mark('end');
await sleep(1500);
const alive = shell(`pidof ${PKG} || true`).trim() !== '';
logcat.kill();
await sleep(500);
logFile.end();
await sleep(300);

// ---- Analysis ---------------------------------------------------------------
const report = { device, alive, crashes: [], phases: [], gfx, checks: [] };
let phase;
for (const line of readFileSync(logPath, 'utf8').split(/\r?\n/)) {
  const time = Number(line.trim().split(/\s+/)[0]);
  const marker = line.match(/FrameMetricsRun: phase=(\S+)/);
  const sample = line.match(/\[frame-metrics\] mode=\w+ (\{.*\})/);
  if (/ E AndroidRuntime/.test(line)) report.crashes.push(line);
  if (marker) report.phases.push((phase = { name: marker[1], time, samples: [] }));
  else if (sample && phase) phase.samples.push({ time, ...JSON.parse(sample[1]) });
}
const sum = (samples, key) => samples.reduce((total, s) => total + s[key], 0);
const rows = report.phases.map(({ name, samples }) => {
  const durationMs = sum(samples, 'durationMs');
  const frames = samples.reduce((t, s) => t + (s.uiThreadFps * s.durationMs) / 1000, 0);
  return {
    phase: name,
    samples: samples.length,
    uiFps: durationMs ? Number(((frames * 1000) / durationMs).toFixed(1)) : null,
    dropped: sum(samples, 'droppedFrames'),
    uiStallMs: Math.round(sum(samples, 'uiStallMs')),
    jsStallMs: Math.round(sum(samples, 'jsStallMs')),
    budgetMs: samples.length ? Number(samples.at(-1).frameBudgetMs.toFixed(2)) : null,
  };
});
const row = (name) => rows.find((r) => r.phase === name);
const check = (name, pass, detail) => report.checks.push({ name, pass, detail });

if (phases.has('stalls')) {
  for (const ms of STALLS_MS) {
    // A blocked thread resumes on the next vsync, so allow one idle-rate frame of slack.
    const ui = row(`uiBlock${ms}`);
    check(`UI ${ms} ms block -> UI stall`, Math.abs(ui.uiStallMs - ms) <= 60, `${ui.uiStallMs} ms`);
    check(`UI ${ms} ms block -> no JS stall`, ui.jsStallMs <= 0.1 * ms, `${ui.jsStallMs} ms`);
    const js = row(`jsBlock${ms}`);
    check(`JS ${ms} ms block -> JS stall`, Math.abs(js.jsStallMs - ms) <= 60, `${js.jsStallMs} ms`);
    check(`JS ${ms} ms block -> no UI stall`, js.uiStallMs <= 0.1 * ms, `${js.uiStallMs} ms`);
  }
}
if (phases.has('lifecycle')) {
  check('No samples while backgrounded', row('background').samples === 0, `${row('background').samples}`);
  check('Resume does not report the background gap', row('resume').uiStallMs < 100, `${row('resume').uiStallMs} ms`);
  check('Samples continue after restart', row('restart').samples > 0, `${row('restart').samples}`);
}
check('App alive, no crashes', alive && report.crashes.length === 0, `alive=${alive}`);

writeFileSync(join(out, 'report.json'), JSON.stringify({ ...report, rows }, null, 2));
console.table(rows);
if (Object.keys(gfx).length) console.log('gfxinfo (system frame stats during scroll)', gfx);
for (const c of report.checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}  (${c.detail})`);
const failed = report.checks.filter((c) => !c.pass).length;
console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
process.exitCode = failed ? 1 : 0;
