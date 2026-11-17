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

// 3. The boss fight starts, phrases turn over, and the clock does not drift.
{
  const page = await open('?skip=boss&god=1');
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(1400);
  await page.keyboard.up('KeyS');
  await page.waitForFunction(() => window.__rm.eventLog.some(e => e.type === 'phrase'), null, { timeout: 20000 });
  const r = await page.evaluate(() => ({ boss: !!window.__rm.state.boss, lead: window.__rm.state.leadOwner, id: window.__rm.state.boss?.conductor.current.id }));
  check('boss fight is running', r.boss && r.lead === 'boss', JSON.stringify(r));
  if (SHOTS) await page.screenshot({ path: SHOTS + '/boss.png' });
  for (let i = 1; i <= 3; i++) {
    await page.waitForTimeout(20000);
    const d = await page.evaluate(() => {
      const e = window.__rm.engine, sps = 60 / e.grid.bpm / 4;
      const nowStep = (e.now() - e.grid.t0) / sps;
      return { ahead: (e.scheduler.lastScheduled - nowStep) * sps, gameBehind: nowStep - window.__rm.state.step, state: e.ctx.state };
    });
    check(`after ${i * 20}s the scheduler is still just ahead of the clock`, d.state === 'running' && d.ahead > -0.05 && d.ahead < 0.3, `ahead ${d.ahead.toFixed(3)}s`);
    check(`after ${i * 20}s the game is on the same step as the music`, d.gameBehind >= 0 && d.gameBehind < 3, `behind ${d.gameBehind.toFixed(2)} steps`);
  }
  await page.close();
}

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
process.exit(failed ? 1 : 0);
