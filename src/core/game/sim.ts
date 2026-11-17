import { BeatGrid, stepToTime, timeToStep } from '../beat';
import { generateSong } from '../music/song';
import { Tunables } from '../tunables';
import { createPlayer, equip, movePlayer, switchInstrument, tryDodge } from './player';
import { GameEvent, GameState, Input, World } from './types';
import { autoAttack, Target } from './attack';
import { bossOnDodge, bossTarget, stepBoss, updateBoss } from './boss';
import { stepGimmicks } from './gimmicks';
import { buildWorld, findTile, isSolid, roomAt } from './world';

/** Movement is integrated in slices this long, so a slow frame stays accurate. */
const SLICE = 1 / 120;
/** After a hitch longer than this, only the last part is simulated (steps are never skipped). */
const MAX_SIM = 0.25;

export function createGame(seed: number, tun: Tunables, world: World = buildWorld()): GameState {
  const start = findTile(world, 'P') ?? { x: world.tile * 1.5, y: world.tile * 1.5 };
  return {
    tun, world,
    song: generateSong(seed, tun.loopBars),
    player: createPlayer(start.x, start.y, tun.playerHp),
    started: false, step: 0, time: 0,
    doorOpen: false, boss: null, leadOwner: null,
    dodgeLog: [], flags: { god: false }, attack: autoAttack,
  };
}

function advance(s: GameState, input: Input, dt: number, t: number, stepF: number, ev: GameEvent[]): void {
  movePlayer(s, input, dt, (x, y) => isSolid(s.world, x, y, s.doorOpen));
  stepGimmicks(s, stepF, ev);
  updateBoss(s, t, ev);
}

/** Everything the player's attack could aim at right now. */
function targetsOf(s: GameState): Target[] {
  const out: Target[] = [];
  const boss = bossTarget(s);
  if (boss) out.push(boss);
  // The practice target only counts from inside the hub: attacks do not aim through walls.
  const t = findTile(s.world, 'T');
  if (t && roomAt(s.world, s.player.x, s.player.y) === 'hub') out.push({ x: t.x, y: t.y, r: 12, takeDamage: () => {} });
  return out;
}

function onStep(s: GameState, absStep: number, grid: BeatGrid, ev: GameEvent[]): void {
  stepBoss(s, absStep, grid, ev);
  ev.push(...s.attack.onStep(s, absStep, targetsOf(s)));
}

/**
 * Advance the game to song time `heardT`. Every whole step crossed on the way
 * is processed in order, however long the frame was.
 */
export function stepGame(s: GameState, input: Input, heardT: number, grid: BeatGrid): GameEvent[] {
  const ev: GameEvent[] = [];
  if (!s.started) {
    s.started = true;
    s.time = heardT;
    s.step = Math.floor(timeToStep(grid, heardT) + 1e-9);
    return ev;
  }
  // Presses are handled even on a frame where the audio clock has not moved:
  // the clock advances in buffer-sized jumps, and a press must never be lost to one.
  if (input.switchTo) equip(s.player, input.switchTo);
  if (input.switchDir !== 0) switchInstrument(s.player, input.switchDir);
  const dodge = tryDodge(s, input, grid);
  if (dodge) {
    ev.push(dodge);
    if (dodge.type === 'dodge') bossOnDodge(s, dodge.beat, dodge.grade);
  }
  if (heardT <= s.time) return ev;

  const simFrom = Math.max(s.time, heardT - MAX_SIM);
  let t = s.time;
  while (t < heardT - 1e-12) {
    const nextStepT = stepToTime(grid, s.step + 1);
    const tn = Math.min(heardT, nextStepT, t < simFrom ? simFrom : t + SLICE);
    if (tn > simFrom) advance(s, input, tn - Math.max(t, simFrom), tn, timeToStep(grid, tn), ev);
    t = tn;
    if (t >= nextStepT - 1e-12) {
      s.step++;
      onStep(s, s.step, grid, ev);
    }
  }
  s.time = heardT;
  return ev;
}
