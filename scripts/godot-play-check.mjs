// Drives the Godot web build like a player and reports what the game says happened.
//   BASE_URL=http://localhost:4173 node scripts/godot-play-check.mjs "<query>" <out-dir> <script>
// script: comma list of  w:<ms>  (wait)  d:<keys>:<ms> (hold keys)  dash  shot:<name>
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const [query = '', out = '.', script = 'w:2000,shot:a'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
await page.goto(`${BASE}/godot/index.html?${query}`);
await page.waitForFunction(() => window.__rmg, null, { timeout: 60000 });
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__rmg?.state === 'playing', null, { timeout: 90000 });
const state = () => page.evaluate(() => window.__rmg);
for (const cmd of script.split(',')) {
  const [op, a, b] = cmd.split(':');
  if (op === 'w') await page.waitForTimeout(+a);
  else if (op === 'd') { for (const k of a) await page.keyboard.down(k); await page.waitForTimeout(+b); for (const k of a) await page.keyboard.up(k); }
  else if (op === 'dash') await page.keyboard.press('Space');
  else if (op === 'key') await page.keyboard.press(a);
  else if (op === 'shot') { await page.screenshot({ path: `${out}/${a}.png` }); const s = await state(); console.log(a, JSON.stringify({ pos: s.pos.map(v => +v.toFixed(2)), lives: s.lives, owned: s.owned, eq: s.equipped, enc: s.encounter, active: s.active, fps: s.fps, flags: s.flags, last: s.last?.grade })); }
}
if (errors.length) console.log('ERRORS', errors.slice(0, 5));
await browser.close();
