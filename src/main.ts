import { AudioEngine, OneShot } from './audio/engine';
import { timeToStep } from './core/beat';
import { createGame, stepGame } from './core/game/sim';
import { GameEvent } from './core/game/types';
import { heardTime } from './core/judge';
import { computeMix, MixState, mixStateOf } from './core/music/mix';
import { LayerId } from './core/music/song';
import { defaultTunables } from './core/tunables';
import { Keyboard } from './input/keyboard';
import { drawDebug } from './render/debug';
import { Renderer } from './render/renderer';
import { runCalibration } from './ui/calibrate';
import { loadTunables, mountPanel, saveTunables } from './ui/panel';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 7);
const tun = defaultTunables();
const stored = loadTunables(tun);
const state = createGame(seed, tun);
const engine = new AudioEngine(state.song, tun);
const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const kb = new Keyboard(window, () => engine.now());

if (params.get('skip') === 'boss') {
  // Dev shortcut: all instruments in hand, standing at the boss door.
  const entry = state.world.rooms.boss!.entry;
  state.player.owned = ['drum', 'hat', 'bass'];
  state.player.equipped = 'drum';
  state.doorOpen = true;
  state.player.x = entry.x;
  state.player.y = entry.y;
}
if (params.get('god')) state.flags.god = true;

const panel = mountPanel(tun, (key, value) => { if (key === 'bpm') engine.setBpm(value); });
let debugOn = !!params.get('debug');
let calibrating = false;

const rm = { state, engine, tun, renderer, kb, eventLog: [] as GameEvent[], fps: 0 };
(window as any).__rm = rm;

function sound(e: GameEvent): OneShot | null {
  switch (e.type) {
    case 'dodge': return e.grade === 'perfect' ? 'dodgePerfect' : e.grade === 'near' ? 'dodgeNear' : 'dodgeMiss';
    case 'collect': return 'collect';
    case 'hurt': return 'hit';
    case 'phrase': return e.advanced ? 'fill' : null;
    case 'solved': return 'resolve';
    case 'bossDefeated': return 'victory';
    default: return null;
  }
}

let running = false;
let lastFrame = 0;
function frame(now: number): void {
  if (!running) return;
  if (calibrating) { requestAnimationFrame(frame); return; }
  rm.fps = rm.fps * 0.9 + (1000 / Math.max(1, now - lastFrame)) * 0.1;
  lastFrame = now;
  const heard = heardTime(engine.now(), tun);
  const events = stepGame(state, kb.poll(), heard, engine.grid);
  for (const e of events) {
    const k = sound(e);
    if (k) engine.oneShot(k);
    if (e.type === 'phrase') engine.setVariation(e.advanced ? 0 : e.repeat);
    if (e.type === 'death' || e.type === 'bossDefeated') engine.setVariation(0);
    if (e.type !== 'attack') { rm.eventLog.push(e); if (rm.eventLog.length > 200) rm.eventLog.shift(); }
  }
  engine.setMix(computeMix(mixStateOf(state)));
  const stepF = timeToStep(engine.grid, heard);
  const beat = stepF / 4;
  renderer.draw(state, beat - Math.floor(beat), stepF, events);
  if (debugOn) drawDebug(renderer.ctx, state, engine.grid, heard, rm.fps, engine.outputLatencyMs(), renderer.width, renderer.height);
  requestAnimationFrame(frame);
}

async function calibrate(): Promise<void> {
  if (calibrating || !engine.ctx) return;
  calibrating = true;
  const ms = await runCalibration(engine, kb, tun.audioOffsetMs);
  if (ms !== null) {
    tun.inputOffsetMs = ms;
    saveTunables(tun);
    panel.refresh();
  }
  kb.poll();
  calibrating = false;
}

async function boot(withCalibration: boolean): Promise<void> {
  await engine.start();
  if (!stored.hadAudioOffset) tun.audioOffsetMs = engine.outputLatencyMs();
  document.getElementById('overlay')!.remove();
  if (params.get('jam')) return jam();
  running = true;
  requestAnimationFrame(frame);
  if (withCalibration) await calibrate();
}
document.getElementById('start')!.addEventListener('click', () => void boot(false));
document.getElementById('calibrate-btn')!.addEventListener('click', () => void boot(true));

kb.onPress = code => {
  if (code === 'Tab') panel.toggle();
  else if (code === 'Backquote') debugOn = !debugOn;
  else if (code === 'KeyC') void calibrate();
};

document.addEventListener('visibilitychange', () => {
  if (!engine.ctx) return;
  if (document.hidden) { running = false; engine.suspend(); }
  else if (!params.get('jam')) { engine.resume(); running = true; requestAnimationFrame(frame); }
  else engine.resume();
});

/** Dev page: toggle layers by ear. */
function jam(): void {
  const st: MixState = { owned: [], equipped: null, previewLayer: null, leadOn: false, harmony: 0, harmonyMax: 3, muffled: false, intensity: 0, focus: null };
  const box = document.createElement('div');
  box.id = 'jam';
  box.style.cssText = 'position:fixed;left:16px;top:16px;display:grid;gap:6px';
  const apply = (): void => engine.setMix(computeMix(st));
  const check = (label: string, on: (v: boolean) => void): void => {
    const l = document.createElement('label');
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.addEventListener('change', () => { on(c.checked); apply(); });
    l.append(c, ' ' + label);
    box.append(l);
  };
  for (const layer of ['drum', 'hat', 'bass'] as LayerId[]) {
    check(layer, v => { st.owned = v ? [...st.owned, layer] : st.owned.filter(x => x !== layer); });
  }
  check('lead', v => { st.leadOn = v; });
  check('pad', v => { st.harmony = v ? 3 : 0; });
  check('muffled', v => { st.muffled = v; });
  check('bright', v => { st.intensity = v ? 1 : 0; });
  const bpm = document.createElement('input');
  bpm.type = 'number';
  bpm.value = String(tun.bpm);
  bpm.addEventListener('change', () => engine.setBpm(Number(bpm.value)));
  box.append(bpm);
  document.body.append(box);
  apply();
}
