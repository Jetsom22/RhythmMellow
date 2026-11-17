// Smoke test against a running server. BASE_URL defaults to the vite preview port.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const SHOTS = process.env.SHOT_DIR ?? null;
const errors = [];
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${detail}`); if (!ok) failed++; };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const open = async (query) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE + '/' + query);
  await page.click('#start');
  return page;
};

// 1. Audio engine starts and the clock runs.
{
  const page = await open('?jam=1');
  await page.waitForTimeout(500);
  const t1 = await page.evaluate(() => window.__rm.engine.now());
  await page.check('#jam input[type=checkbox] >> nth=0');
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({ state: window.__rm.engine.ctx.state, now: window.__rm.engine.now(), last: window.__rm.engine.scheduler.lastScheduled }));
  check('audio context running', r.state === 'running', r.state);
  check('audio clock advances', r.now > t1 + 1, `${t1.toFixed(2)} -> ${r.now.toFixed(2)}`);
  check('scheduler is scheduling', r.last > 8, `last step ${r.last}`);
  await page.close();
}

// 2. Walking and dodging reach the game state.
{
  const page = await open('');
  await page.waitForTimeout(400);
  const x0 = await page.evaluate(() => window.__rm.state.player.x);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(150);
  await page.keyboard.up('KeyD');
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({ x: window.__rm.state.player.x, dodges: window.__rm.state.dodgeLog.length, step: window.__rm.state.step }));
  check('player walks', r.x > x0 + 5, `${x0.toFixed(0)} -> ${r.x.toFixed(0)}`);
  check('dodge is judged', r.dodges === 1, `dodges ${r.dodges}`);
  check('game follows the beat', r.step > 2, `step ${r.step}`);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Backquote');
  await page.waitForTimeout(150);
  check('tunables panel opens', await page.isVisible('#panel'));
  check('panel lists every tunable', (await page.locator('#panel input').count()) === Object.keys(await page.evaluate(() => window.__rm.tun)).length);
  if (SHOTS) await page.screenshot({ path: SHOTS + '/walk.png' });
  await page.keyboard.press('Tab');
  check('tunables panel closes', !(await page.isVisible('#panel')));
  await page.close();
}

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
process.exit(failed ? 1 : 0);
