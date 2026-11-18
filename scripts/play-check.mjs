// Drives the stage build like a player and reports what the game says happened.
//   BASE_URL=http://localhost:4173 node scripts/play-check.mjs "<query>" <out-dir> <script>
// script: comma list of  w:<ms> (wait)  d:<keys>:<ms> (hold keys, e.g. d:KeyD+KeyW:500)  key:<code>  shot:<name>
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const [query = '', out = '.', script = 'w:2000,shot:a'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
await page.goto(`${BASE}/?${query}`);
await page.click('#start');
for (const cmd of script.split(',')) {
  const [op, a, b] = cmd.split(':');
  if (op === 'w') await page.waitForTimeout(+a);
  else if (op === 'd') { for (const k of a.split('+')) await page.keyboard.down(k); await page.waitForTimeout(+b); for (const k of a.split('+')) await page.keyboard.up(k); }
  else if (op === 'key') await page.keyboard.press(a);
  else if (op === 'shot') {
    await page.screenshot({ path: `${out}/${a}.png` });
    console.log(a, JSON.stringify(await page.evaluate(() => { const s = window.__rm.sim; return {
      pos: [+(s.x / s.u).toFixed(2), +(s.y / s.u).toFixed(2)], lives: s.lives, owned: s.owned, eq: s.equipped, step: s.step,
      fight: s.fight ? s.fight.id + '/' + s.fight.phrases[s.fight.index].id : '', active: s.active.length, fps: Math.round(window.__rm.fps),
      log: window.__rm.eventLog.slice(-6).map(e => e.type + (e.type === 'dash' ? (e.just ? ':just' : '') : '')) }; })));
  }
}
if (errors.length) console.log('ERRORS', errors.slice(0, 5));
await browser.close();
