// Measures whether the Godot web build's clock agrees with the sound that really comes out.
// It taps the browser's audio output, finds the onset of every base-pulse click, and compares
// each with the moment the game's own clock says that beat is heard.
//   BASE_URL=http://localhost:4173 node scripts/godot-audio-check.mjs [seconds]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const SECONDS = Number(process.argv[2] ?? 24);
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 160)));
await page.addInitScript(() => {
  window.__onsets = [];
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const ctx = this.context;
    if (dest === ctx.destination && !ctx.__tapped) {
      ctx.__tapped = true;
      window.__ctx = ctx;
      const tap = ctx.createScriptProcessor(256, 2, 1);
      let quiet = 1e9;
      tap.onaudioprocess = e => {
        const d = e.inputBuffer.getChannelData(0);
        for (let i = 0; i < d.length; i++) {
          if (Math.abs(d[i]) > 0.02) { if (quiet > 2000) window.__onsets.push(e.playbackTime + i / ctx.sampleRate); quiet = 0; } else quiet++;
        }
      };
      const mute = ctx.createGain(); mute.gain.value = 0;
      tap.connect(mute); connect.call(mute, ctx.destination);
      window.__tap = tap;
    }
    if (dest === ctx.destination && window.__tap && this !== window.__tap) connect.call(this, window.__tap);
    return connect.call(this, dest, ...rest);
  };
});
await page.goto(BASE + '/godot/index.html');
await page.waitForFunction(() => window.__rmg && window.__rmg.state === 'idle', null, { timeout: 90000 });
await page.mouse.click(640, 360);
await page.waitForFunction(() => window.__rmg.state === 'playing' && window.__rmg.step > 2, null, { timeout: 90000 });
const samples = [];
for (let i = 0; i < SECONDS; i++) {
  await page.waitForTimeout(1000);
  samples.push(await page.evaluate(() => {
    const c = window.__ctx, ts = c.getOutputTimestamp();
    return { step: window.__rmg.step, wall: window.__rmg.wall, bpm: 110, ctxAtPerf: ts.contextTime, perf: ts.performanceTime, out: (c.outputLatency || 0), latencyMs: window.__rmg.latencyMs, mode: window.__rmg.audio };
  }));
}
const onsets = await page.evaluate(() => window.__onsets);
await browser.close();

const spb = 60 / 110;
// For each onset: when does it reach the speaker (wall clock), and which beat does the game say that is?
const rows = [];
for (const t of onsets) {
  const s = samples.reduce((a, b) => (Math.abs(b.ctxAtPerf - t) < Math.abs(a.ctxAtPerf - t) ? b : a));
  const heardWall = s.perf + (t - s.ctxAtPerf) * 1000 + s.out * 1000;
  const beatF = (s.step / 4) + (heardWall - s.wall) / 1000 / spb;      // the game's beat position at that moment
  rows.push({ t, errMs: (beatF - Math.round(beatF)) * spb * 1000 });
}
// The browser reports its output delay only after a few seconds; judge the settled part on its own.
const t0 = onsets[0] ?? 0;
const settled = rows.filter(r => r.t - t0 > 8).map(r => r.errMs);
const avg = xs => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const errs = rows.map(r => r.errMs);
const mean = errs.reduce((a, b) => a + b, 0) / (errs.length || 1);
const first = errs.slice(0, 6).reduce((a, b) => a + b, 0) / Math.min(6, errs.length || 1);
const last = errs.slice(-6).reduce((a, b) => a + b, 0) / Math.min(6, errs.length || 1);
const gaps = onsets.slice(1).map((t, i) => (t - onsets[i]) * 1000);
const gapErr = gaps.map(g => g - spb * 1000);
console.log(JSON.stringify({
  mode: samples[0]?.mode ?? 'unknown', clicks: onsets.length, seconds: SECONDS,
  clockVsSoundMs: { mean: +mean.toFixed(1), first6: +first.toFixed(1), last6: +last.toFixed(1), driftOverRun: +(last - first).toFixed(1) },
  settledMs: { clicks: settled.length, mean: +avg(settled).toFixed(1), first5: +avg(settled.slice(0, 5)).toFixed(1), last5: +avg(settled.slice(-5)).toFixed(1), worst: +Math.max(...settled.map(Math.abs)).toFixed(1) },
  beatSpacingErrorMs: { worst: +Math.max(...gapErr.map(Math.abs)).toFixed(1), mean: +(gapErr.reduce((a, b) => a + b, 0) / (gapErr.length || 1)).toFixed(2) },
  reportedLatencyMs: samples[0]?.latencyMs, browserOutputLatencyMs: +(samples[0]?.out * 1000).toFixed(1), errors,
}));
