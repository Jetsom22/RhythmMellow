import { BeatGrid, stepToTime, timeToStep } from '../beat';
import { generateSong } from '../music/song';
import { Tunables } from '../tunables';
import { createPlayer, equip, movePlayer, switchInstrument, tryDodge } from './player';
import { GameEvent, GameState, Input, World } from './types';
import { buildWorld, findTile, isSolid, roomAt, tileAt } from './world';

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
    dodgeLog: [], flags: { god: false },
  };
}

function sendBack(s: GameState, ev: GameEvent[]): void {
  const p = s.player;
  const room = roomAt(s.world, p.x, p.y);
  p.x = p.respawn.x;
  p.y = p.respawn.y;
  p.dash = null;
  ev.push({ type: 'respawn', room: room ?? '' });
}

function advance(s: GameState, input: Input, dt: number, ev: GameEvent[]): void {
  const p = s.player;
  movePlayer(s, input, dt, (x, y) => isSolid(s.world, x, y, s.doorOpen));
  if (!p.dash && tileAt(s.world, p.x, p.y) === '~') sendBack(s, ev);
}

function onStep(_s: GameState, _absStep: number, _ev: GameEvent[]): void {}

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
    if (tn > simFrom) advance(s, input, tn - Math.max(t, simFrom), ev);
    t = tn;
    if (t >= nextStepT - 1e-12) {
      s.step++;
      onStep(s, s.step, ev);
    }
  }
  s.time = heardT;
  return ev;
}
