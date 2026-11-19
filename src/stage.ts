import { AudioEngine, OneShot } from './audio/engine';
import { ScorePlayer } from './audio/scorePlayer';
import { timeToStep } from './core/beat';
import { heardTime, inputTime } from './core/judge';
import { notesOf, sceneFor } from './core/music/score';
import { demoScore } from './core/music/scoreLibrary';
import { generateSong } from './core/music/song';
import { Instrument, StageData, StageEvent, StageSim } from './core/stage/sim';
import { defaultTunables } from './core/tunables';
import { Keyboard } from './input/keyboard';
import { StageRenderer } from './render/stageRenderer';
import { runCalibration } from './ui/calibrate';
import { loadTunables, mountPanel, saveTunables } from './ui/panel';

/**
 * The stage build: one open map, walked with fixed lives.
 * Address options (a workbench for level and art work):
 *   ?stage=name      which file in src/data/stages
 *   ?at=x,y          start there (U)          ?parts=drum,hat   start holding these
 *   ?god=1           cannot be hurt           ?palette=rust|mid|navy|ochre
 *   ?zoom=0.3        look from further away   ?seed=7
 */
const stages = import.meta.glob<StageData>('./data/stages/*.json', { eager: true, import: 'default' });
const params = new URLSearchParams(location.search);
const data = stages[`./data/stages/${params.get('stage') ?? 'stage-01'}.json`] ?? stages['./data/stages/stage-01.json'];

const tun = defaultTunables();
const stored = loadTunables(tun);
const sim = StageSim.from(data);
tun.bpm = sim.meter.bpm;
const song = generateSong(Number(params.get('seed') ?? data.seed ?? 7), tun.loopBars);
// The music is the sound session's score, played live. The old engine stays for one-shot sounds, the base pulse and calibration.
const score = demoScore();
score.bpm = sim.meter.bpm;
let player: ScorePlayer | null = null;
/** Steps of each scene on which a bass note is sounding. */
const bassSteps = new Map<string, Set<number>>();
function bassAt(step: number): boolean {
  if (!player) return false;
  const pos = player.position();
  let set = bassSteps.get(pos.scene);
  if (!set) {
    set = new Set();
    for (const n of notesOf(score, pos.scene, 'bass')) for (let i = 0; i < Math.max(1, n.len); i++) set.add((n.step + i) % pos.steps);
    bassSteps.set(pos.scene, set);
  }
  // pos.step is where the scene is now; `step` may be a little ahead of the game's current step.
  const local = Math.floor(pos.step) + (step - sim.step);
  return set.has(((local % pos.steps) + pos.steps) % pos.steps);
}
sim.layerSounding = (layer, step) => layer === 'bass' && bassAt(step);

const at = params.get('at')?.split(',').map(Number);
if (at?.length === 2 && at.every(Number.isFinite)) { sim.x = at[0] * sim.u; sim.y = at[1] * sim.u; }
for (const p of (params.get('parts') ?? '').split(',').filter(Boolean) as Instrument[]) {
  if (sim.owned.includes(p)) continue;
  sim.owned.push(p);
  sim.equipped ??= p;
  for (const part of sim.parts) if (part.layer === p) part.taken = true;
}
sim.openGates();
sim.events = [];
sim.god = !!params.get('god');

const engine = new AudioEngine(song, tun);
const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new StageRenderer(canvas);
renderer.setPalette(params.get('palette') ?? data.palette);
renderer.zoom = Math.max(0.1, Math.min(1, Number(params.get('zoom') ?? 1) || 1));
document.body.style.background = renderer.pal.bg;
const kb = new Keyboard(window, () => engine.now());
const panel = mountPanel(tun, (key, value) => { if (key === 'bpm') engine.setBpm(value); });
let calibrating = false;

const rm = { sim, engine, tun, renderer, kb, song, score, player: null as ScorePlayer | null, eventLog: [] as StageEvent[], fps: 0 };
(window as any).__rm = rm;

function sound(e: StageEvent): OneShot | null {
  switch (e.type) {
    case 'dash': return e.just ? 'dodgePerfect' : 'dodgeNear';
    case 'fizzle': return 'dodgeMiss';
    case 'special': return 'fill';
    case 'trigger': return 'resolve';
    case 'part': return 'collect';
    case 'plate': return 'resolve';
    case 'hurt': case 'gameover': return 'hit';
    case 'phrase': return e.advanced ? 'fill' : null;
    case 'cleared': return e.kind === 'boss' ? 'victory' : 'resolve';
    default: return null;
  }
}

/** Which state of the game the music should be playing. The score maps a state to a scene. */
function musicState(): string {
  const f = sim.fight;
  if (!f || f.kind !== 'boss') return 'explore';
  return f.index === 0 ? 'boss.enter' : f.index < 4 ? 'boss.phase1' : 'boss.shift';
}
let askedState = '';
const sentGain: Record<string, number> = {};
function mixMusic(): void {
  const fight = sim.fight;
  // The base pulse (old engine) is heard until the drum is in hand.
  engine.setMix({ gain: { drum: 0, hat: 0, bass: 0, lead: 0, pad: 0, tick: sim.owned.includes('drum') ? 0 : 0.35 }, cutoffHz: 18000, brightness: 0 });
  if (!player) return;
  const want = {
    drum: 0, hat: 0, bass: 0,
    lead: fight ? 1 : 0, pad: sim.owned.length / 3,
  };
  for (const l of ['drum', 'hat', 'bass'] as const) want[l] = sim.equipped === l ? 1 : sim.owned.includes(l) ? 0.8 : 0;
  for (const l of ['drum', 'hat', 'bass', 'lead', 'pad'] as const) if (sentGain[l] !== want[l]) { sentGain[l] = want[l]; player.setLayerGain(l, want[l]); }
  const st = musicState();
  if (st !== askedState) { askedState = st; player.setScene(sceneFor(score, st)); }
}

let running = false;
let lastFrame = 0;
let rafId = 0;
/** The only way frames are requested: at most one is ever pending. */
function schedule(): void {
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(frame);
}
function frame(now: number): void {
  if (!running) return;
  if (calibrating) { schedule(); return; }
  rm.fps = rm.fps * 0.9 + (1000 / Math.max(1, now - lastFrame)) * 0.1;
  lastFrame = now;
  const t0 = engine.grid.t0;
  const heard = heardTime(engine.now(), tun) - t0;
  const input = kb.poll();
  const events = sim.stepTo(heard, {
    moveX: input.moveX, moveY: input.moveY, switchDir: input.switchDir, switchTo: input.switchTo, specialAt: input.specialAt == null ? null : inputTime(input.specialAt, tun) - t0,
    dashAt: input.dodgeAt === null ? null : inputTime(input.dodgeAt, tun) - t0,
  });
  for (const e of events) {
    const k = sound(e);
    if (k) engine.oneShot(k);
    if (e.type === 'phrase') engine.setVariation(e.advanced ? 0 : e.repeat);
    if (e.type === 'gameover' || e.type === 'cleared') engine.setVariation(0);
    if (e.type !== 'attack' && e.type !== 'strike') { rm.eventLog.push(e); if (rm.eventLog.length > 200) rm.eventLog.shift(); }
  }
  mixMusic();
  const stepF = timeToStep({ bpm: sim.meter.bpm, t0: 0 }, heard);
  const beat = stepF / sim.meter.stepsPerBeat;
  renderer.draw(sim, beat - Math.floor(beat), stepF, events);
  schedule();
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
  // One clock for both: the score player sets the beat grid and the old engine follows it.
  player = rm.player = new ScorePlayer(engine.ctx, score, sceneFor(score, 'explore'));
  for (const l of ['drum', 'hat', 'bass', 'lead', 'pad'] as const) player.setLayerGain(l, 0);
  player.start(0.15);
  engine.grid = { ...player.grid };
  engine.scheduler.reset();
  if (!stored.hadAudioOffset) tun.audioOffsetMs = engine.outputLatencyMs();
  document.getElementById('overlay')!.remove();
  running = true;
  schedule();
  if (withCalibration) await calibrate();
}
document.getElementById('start')!.addEventListener('click', () => void boot(false));
document.getElementById('calibrate-btn')!.addEventListener('click', () => void boot(true));

kb.onPress = code => {
  if (code === 'Tab') panel.toggle();
  else if (code === 'KeyC') void calibrate();
  else if (code === 'Minus') renderer.zoom = Math.max(0.1, renderer.zoom - 0.1);
  else if (code === 'Equal') renderer.zoom = Math.min(1, renderer.zoom + 0.1);
};

document.addEventListener('visibilitychange', () => {
  if (!engine.ctx) return;
  if (document.hidden) { running = false; cancelAnimationFrame(rafId); engine.suspend(); }
  else { engine.resume(); running = true; schedule(); }
});
