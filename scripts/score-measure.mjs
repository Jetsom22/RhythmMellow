// Renders scenes of the studio's score without playing them and prints, for the whole mix and for
// each layer alone: the peak, the average loudness, and how the energy is spread over the spectrum.
// It measures the built-in score (the browser's saved work is cleared first).
//   npm run build && npx vite preview --port 4173 &
//   BASE_URL=http://localhost:4173 node scripts/score-measure.mjs [scene,scene,...]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGE ERROR', String(e).slice(0, 200)));
await page.goto(BASE + '/studio.html');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.__studio);
const scenes = process.argv[2] ? process.argv[2].split(',') : await page.evaluate(() => Object.keys(window.__studio.score.scenes));
for (const scene of scenes) {
  for (const layer of [undefined, 'drum', 'hat', 'bass', 'lead', 'pad']) {
    const m = await page.evaluate(([s, l]) => window.__studio.measure(s, l), [scene, layer]);
    console.log(scene.padEnd(9), (layer ?? 'ALL').padEnd(5), `peak ${m.peak.toFixed(2)}  avg ${m.rmsDb.toFixed(1)} dB  `, Object.entries(m.bands).map(([k, v]) => `${k} ${v}%`).join('  '));
  }
}
await browser.close();
