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
  const page = await open('?classic=1&jam=1');
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
  const page = await open('?classic=1');
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
  // Hiding and showing the tab must not stack up frame loops.
  const drawsPerFrame = () => page.evaluate(() => new Promise(res => {
    const r = window.__rm.renderer, orig = r.draw.bind(r);
    let draws = 0, frames = 0;
    r.draw = (...a) => { draws++; return orig(...a); };
    const tick = () => { if (++frames < 20) requestAnimationFrame(tick); else { r.draw = orig; res(draws / frames); } };
    requestAnimationFrame(tick);
  }));
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) {
      for (const hidden of [true, false]) {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
        document.dispatchEvent(new Event('visibilitychange'));
      }
      // A really hidden tab runs no frames, so the pending frame is still queued on return.
      await new Promise(r => setTimeout(r, 60));
    }
  });
  await page.waitForTimeout(300);
  const dpf = await drawsPerFrame();
  check('one draw per frame after tab switches', dpf > 0.8 && dpf < 1.3, `draws per frame ${dpf.toFixed(2)}`);
  if (SHOTS) await page.screenshot({ path: SHOTS + '/walk.png' });
  await page.keyboard.press('Tab');
  check('tunables panel closes', !(await page.isVisible('#panel')));
  await page.close();
}

// 3. The boss fight starts, phrases turn over, and the clock does not drift.
{
  const page = await open('?classic=1&skip=boss&god=1');
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

// 4. The stage build (the default page): walking, the dash judgement, a fight, and the clock.
{
  const page = await open('');
  await page.waitForTimeout(400);
  const x0 = await page.evaluate(() => window.__rm.sim.x);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(300);
  await page.keyboard.up('KeyD');
  // Press on a beat and off a beat, by the game's own clock.
  const press = async frac => {
    await page.evaluate(f => new Promise(res => {
      const { engine, tun, sim } = window.__rm, spb = 60 / sim.meter.bpm;
      const tick = () => {
        const t = engine.now() - tun.audioOffsetMs / 1000 - tun.inputOffsetMs / 1000 - engine.grid.t0, ph = ((t / spb) % 1 + 1) % 1;
        if (Math.abs(ph - f) < 0.03) { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' })); res(); }
        else requestAnimationFrame(tick);
      };
      tick();
    }), frac);
    await page.waitForTimeout(500);
  };
  await press(0.5);
  await press(0.0);
  const r = await page.evaluate(() => ({ x: window.__rm.sim.x, step: window.__rm.sim.step, log: window.__rm.eventLog.map(e => e.type) }));
  check('stage: player walks', r.x > x0 + 20, `${x0.toFixed(0)} -> ${r.x.toFixed(0)}`);
  check('stage: off the beat there is no dash', r.log.filter(t => t === 'fizzle').length === 1, r.log.join(','));
  check('stage: on the beat the dash happens', r.log.filter(t => t === 'dash').length === 1, r.log.join(','));
  if (SHOTS) await page.screenshot({ path: SHOTS + '/stage.png' });
  await page.close();
}
{
  const page = await open('?at=0.9,1.6&parts=drum,hat,bass&god=1');
  await page.waitForFunction(() => window.__rm.sim.fight, null, { timeout: 10000 });
  await page.waitForTimeout(20000);
  const d = await page.evaluate(() => {
    const e = window.__rm.engine, sps = 60 / e.grid.bpm / 4, nowStep = (e.now() - e.grid.t0) / sps;
    return { fight: window.__rm.sim.fight?.id, behind: nowStep - window.__rm.sim.step, fps: window.__rm.fps };
  });
  check('stage: the boss fight runs', d.fight === 'boss', JSON.stringify(d));
  check('stage: after 20s the game is on the same step as the music', d.behind >= 0 && d.behind < 3, `behind ${d.behind.toFixed(2)} steps`);
  if (SHOTS) await page.screenshot({ path: SHOTS + '/stage-boss.png' });
  await page.close();
}

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
process.exit(failed ? 1 : 0);
