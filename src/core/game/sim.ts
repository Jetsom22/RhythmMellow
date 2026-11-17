import { BeatGrid, stepToTime, timeToStep } from '../beat';
import { generateSong } from '../music/song';
import { Tunables } from '../tunables';
import { createPlayer, equip, movePlayer, switchInstrument, tryDodge } from './player';
import { GameEvent, GameState, Input, World } from './types';
import { autoAttack, Target } from './attack';
import { stepGimmicks } from './gimmicks';
import { buildWorld, findTile, isSolid } from './world';

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

function advance(s: GameState, input: Input, dt: number, stepF: number, ev: GameEvent[]): void {
  movePlayer(s, input, dt, (x, y) => isSolid(s.world, x, y, s.doorOpen));
  stepGimmicks(s, stepF, ev);
}

/** Everything the player's attack could aim at right now. */
function targetsOf(s: GameState): Target[] {
  const out: Target[] = [];
  const t = findTile(s.world, 'T');
  if (t) out.push({ x: t.x, y: t.y, r: 12, takeDamage: () => {} });
  return out;
}

function onStep(s: GameState, absStep: number, ev: GameEvent[]): void {
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
  if (heardT <= s.time) return ev;

  if (input.switchTo) equip(s.player, input.switchTo);
  if (input.switchDir !== 0) switchInstrument(s.player, input.switchDir);
  const dodge = tryDodge(s, input, grid);
  if (dodge) ev.push(dodge);

  const simFrom = Math.max(s.time, heardT - MAX_SIM);
  let t = s.time;
  while (t < heardT - 1e-12) {
    const nextStepT = stepToTime(grid, s.step + 1);
    const tn = Math.min(heardT, nextStepT, t < simFrom ? simFrom : t + SLICE);
    if (tn > simFrom) advance(s, input, tn - Math.max(t, simFrom), timeToStep(grid, tn), ev);
    t = tn;
    if (t >= nextStepT - 1e-12) {
      s.step++;
      onStep(s, s.step, ev);
    }
  }
  s.time = heardT;
  return ev;
}
