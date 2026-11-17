import { describe, it, expect } from 'vitest';
import { BeatGrid, secPerBeat, secPerStep, timeToStep } from '../src/core/beat';
import { bassSounding, gimmickDeadly } from '../src/core/game/gimmicks';
import { createGame, stepGame } from '../src/core/game/sim';
import { GameEvent, GameState, Input } from '../src/core/game/types';
import { defaultTunables } from '../src/core/tunables';
import { idle } from './helpers';

/**
 * Each room must be solvable with plain inputs at the default tuning:
 * these bots only walk and press dodge on the beat, at 60 frames a second.
 */
const tun = defaultTunables();
const GRID: BeatGrid = { bpm: tun.bpm, t0: 0 };
const FRAME = 1 / 60;

type Bot = (s: GameState, t: number, onBeat: boolean) => Partial<Input>;

function play(room: 'drum' | 'hat' | 'bass', seed: number, bot: Bot, maxSeconds = 40): { s: GameState; ev: GameEvent[] } {
  const s = createGame(seed, defaultTunables());
  const entry = s.world.rooms[room]!.entry;
  s.player.x = entry.x; s.player.y = entry.y;
  let t = 4 * secPerBeat(GRID.bpm) * 4;
  stepGame(s, idle(), t, GRID);
  const ev: GameEvent[] = [];
  while (t < maxSeconds && !s.player.owned.includes(room)) {
    const next = t + FRAME;
    const beat = Math.floor(next / secPerBeat(GRID.bpm));
    const onBeat = beat > Math.floor(t / secPerBeat(GRID.bpm));
    const input = bot(s, next, onBeat);
    // A dodge on the beat is stamped with the beat's own time: a perfect press.
    if (input.dodgeAt !== undefined && input.dodgeAt !== null) input.dodgeAt = beat * secPerBeat(GRID.bpm);
    ev.push(...stepGame(s, idle(input), next, GRID));
    t = next;
  }
  return { s, ev };
}

describe.each([7, 1, 2, 3, 11])('rooms are solvable (seed %i)', seed => {
  it('drum room: pass each gate while it is open, then dodge the gap on a beat', () => {
    const T = 32;
    const { s, ev } = play('drum', seed, (st, t, onBeat) => {
      const p = st.player;
      const edge = 7 * T + 8;                                  // just right of the gap
      if (p.x <= edge + 2 && p.x > 6 * T) return onBeat ? { dodgeAt: t, moveX: -1 } : {};
      if (p.x <= 6 * T) return { moveX: -1 };
      // Is there a gate just ahead? Only step in right after it opens.
      const ahead = [18, 15, 12, 9].find(c => p.x > (c + 1) * T && p.x - (c + 1) * T < 14);
      if (ahead !== undefined) {
        const stepF = timeToStep(GRID, t);
        const open = !gimmickDeadly(st.world, st.song, stepF, (ahead + 0.5) * T, p.y, tun);
        const intoBeat = (stepF / 4) % 1;
        return open && intoBeat < 0.3 ? { moveX: -1 } : {};
      }
      return { moveX: -1 };
    });
    expect(s.player.owned).toContain('drum');
    expect(ev.filter(e => e.type === 'respawn')).toEqual([]);
  });

  it('hat room: start walking on the beat and keep walking, then dodge the gap on a beat', () => {
    const { s, ev } = play('hat', seed, (st, _t, onBeat) => {
      const p = st.player;
      const ledge = 5 * 32;                                    // stable floor row before the gap
      if (p.y < ledge) return { moveY: -1 };
      if (p.y <= ledge + 14) return onBeat ? { dodgeAt: 0, moveY: -1 } : {};
      if (p.y <= 12 * 32) return { moveY: -1 };                // on the platforms: never stop
      if (p.y > 12 * 32 + 2.5) return { moveY: -1 };           // walk up to the edge
      return onBeat ? { moveY: -1 } : {};                      // step on exactly on the beat
    });
    expect(s.player.owned).toContain('hat');
    expect(ev.filter(e => e.type === 'respawn')).toEqual([]);
  });

  it('bass room: cross between safe columns during the rests, then dodge the gap on a beat', () => {
    const stops = [1404, 1520, 1616, 1712, 1810];
    const { s, ev } = play('bass', seed, (st, t, onBeat) => {
      const p = st.player;
      if (p.x >= stops[4] - 1 && p.x < 1830) return onBeat ? { dodgeAt: 0, moveX: 1 } : {};
      if (p.x >= 1830) return { moveX: 1 };
      const next = stops.find(x => x > p.x + 1)!;
      const here = stops.filter(x => x <= p.x + 1).pop();
      if (here === undefined || p.x - here > 4) return { moveX: 1 };   // not at a stop yet: keep going
      // Leave only when the lane is silent for long enough to reach the next stop.
      const step = Math.floor(timeToStep(GRID, t - FRAME));
      const need = Math.ceil((next - p.x) / tun.playerSpeed / secPerStep(GRID.bpm)) + 1;
      for (let i = 0; i < need; i++) if (bassSounding(st.song, step + i)) return {};
      return { moveX: 1 };
    });
    expect(s.player.owned).toContain('bass');
    expect(ev.filter(e => e.type === 'respawn')).toEqual([]);
  });
});
