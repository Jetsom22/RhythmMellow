import { parseWorld } from '../src/core/game/world';
import { createGame, stepGame } from '../src/core/game/sim';
import { GameEvent, GameState, Input } from '../src/core/game/types';
import { defaultTunables, Tunables } from '../src/core/tunables';
import { BeatGrid } from '../src/core/beat';

export const GRID: BeatGrid = { bpm: 120, t0: 0 };
export const idle = (over: Partial<Input> = {}): Input => ({ moveX: 0, moveY: 0, dodgeAt: null, switchDir: 0, switchTo: null, ...over });

export const OPEN_ROOM = [
  '####################',
  '#..................#',
  '#..................#',
  '#..P...............#',
  '#..................#',
  '#..................#',
  '####################',
];
export const CHASM_ROOM = [
  '############',
  '#....~~....#',
  '#P...~~....#',
  '#....~~....#',
  '############',
];

/** A game on a hand-made map, already started at song time `t`. */
export function gameOn(cells: string[], t = 1.0, tun: Tunables = defaultTunables()): GameState {
  const s = createGame(7, tun, parseWorld(cells, 32));
  stepGame(s, idle(), t, GRID);
  return s;
}

/** Advance in 20ms frames until song time `until`, collecting events. */
export function run(s: GameState, until: number, input: Partial<Input> = {}, grid: BeatGrid = GRID): GameEvent[] {
  const out: GameEvent[] = [];
  let first = true;
  while (s.time < until - 1e-9) {
    const t = Math.min(until, s.time + 0.02);
    out.push(...stepGame(s, first ? idle(input) : idle({ moveX: input.moveX ?? 0, moveY: input.moveY ?? 0 }), t, grid));
    first = false;
  }
  return out;
}
