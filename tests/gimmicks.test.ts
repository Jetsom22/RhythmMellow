import { describe, it, expect } from 'vitest';
import { gimmickDeadly, bassSounding } from '../src/core/game/gimmicks';
import { createGame, stepGame } from '../src/core/game/sim';
import { buildWorld, isSolid, findTile } from '../src/core/game/world';
import { defaultTunables } from '../src/core/tunables';
import { GameState, Instrument } from '../src/core/game/types';
import { GRID, idle } from './helpers';

const w = buildWorld();
const tun = defaultTunables();
const centre = (ch: string, nth = 0): { x: number; y: number; col: number } => {
  const hits: { x: number; y: number; col: number }[] = [];
  w.cells.forEach((row, r) => [...row].forEach((c, col) => { if (c === ch) hits.push({ x: (col + 0.5) * w.tile, y: (r + 0.5) * w.tile, col }); }));
  return hits[nth];
};
const game = (t = 1.0): GameState => { const s = createGame(7, defaultTunables()); stepGame(s, idle(), t, GRID); return s; };
const put = (s: GameState, ch: string): void => { const c = centre(ch); s.player.x = c.x; s.player.y = c.y; };
const tick = (s: GameState) => stepGame(s, idle(), s.time + 0.005, GRID);

describe('drum room gates', () => {
  it('slam shut on alternate quarter beats, neighbours out of phase', () => {
    const g0 = centre('g', 0);
    const song = createGame(7, defaultTunables()).song;
    const closedAt = (x: number, y: number, step: number) => gimmickDeadly(w, song, step, x, y, tun);
    const a = closedAt(g0.x, g0.y, 0), b = closedAt(g0.x, g0.y, 4);
    expect(a).not.toBe(b);
    expect(closedAt(g0.x, g0.y, 3.9)).toBe(a);
    expect(closedAt(g0.x, g0.y, 8)).toBe(a);
    const other = [1, 2, 3, 4, 5, 6, 7, 8].map(n => centre('g', n)).find(g => g && Math.abs(g.col - g0.col) === 3)!;
    expect(closedAt(other.x, other.y, 0)).toBe(!a);
  });
});

describe('hat room platforms', () => {
  const song = createGame(7, defaultTunables()).song;
  const at = (ch: string, phase: number) => { const c = centre(ch); return gimmickDeadly(w, song, phase * 4, c.x, c.y, tun); };
  it('platform A blinks out just before the beat and is solid on it', () => {
    expect([0, 0.25, 0.5, 0.78, 0.95, 4.78].map(ph => at('p', ph))).toEqual([false, false, false, true, false, true]);
  });
  it('platform B does the same half a beat later, so both are solid on the beat and the off-beat', () => {
    expect([0, 0.28, 0.5, 0.78].map(ph => at('q', ph))).toEqual([false, true, false, false]);
  });
});

describe('bass room wave', () => {
  const song = createGame(7, defaultTunables()).song;
  it('fills the lane while a bass note sounds and spares the safe cells', () => {
    const lane = centre('w'), safe = centre('s');
    for (let st = 0; st < song.loopSteps; st++) {
      expect(gimmickDeadly(w, song, st + 0.5, lane.x, lane.y, tun)).toBe(bassSounding(song, st));
      expect(gimmickDeadly(w, song, st + 0.5, safe.x, safe.y, tun)).toBe(false);
    }
    expect(bassSounding(song, song.layers.bass[0].step)).toBe(true);
  });
});

describe('collecting', () => {
  it('picks up an instrument and equips the first one', () => {
    const s = game();
    put(s, 'd');
    const ev = tick(s);
    expect(ev).toContainEqual({ type: 'collect', inst: 'drum' });
    expect(s.player.owned).toEqual(['drum']);
    expect(s.player.equipped).toBe('drum');
    expect(tick(s).filter(e => e.type === 'collect')).toHaveLength(0);
  });
  it.each([[['d', 'h', 'b']], [['b', 'h', 'd']], [['h', 'b', 'd']]])('opens the boss door once all three are owned, in any order %j', order => {
    const s = game();
    const door = findTile(w, 'D')!;
    let opens = 0;
    for (const ch of order) {
      expect(s.doorOpen).toBe(false);
      put(s, ch);
      opens += tick(s).filter(e => e.type === 'doorOpen').length;
    }
    expect(opens).toBe(1);
    expect(s.doorOpen).toBe(true);
    expect([...s.player.owned].sort()).toEqual<Instrument[]>(['bass', 'drum', 'hat']);
    expect(isSolid(w, door.x, door.y, s.doorOpen)).toBe(false);
    expect(isSolid(w, door.x, door.y, false)).toBe(true);
    expect(s.player.equipped).toBe(order[0] === 'd' ? 'drum' : order[0] === 'b' ? 'bass' : 'hat');
  });
});

describe('failing inside a room', () => {
  it('sends the player back to the room entry without losing health', () => {
    const s = game(1.0);       // step 8
    const p = centre('p');
    s.player.x = p.x; s.player.y = p.y;
    tick(s);                   // entering the room sets the respawn point
    const ev: ReturnType<typeof tick> = [];
    while (s.time < 1.5) ev.push(...tick(s));   // step 11 (missing platform) passes
    expect(ev.filter(e => e.type === 'respawn')).toEqual([{ type: 'respawn', room: 'hat' }]);
    expect({ x: s.player.x, y: s.player.y }).toEqual(w.rooms.hat!.entry);
    expect(s.player.hp).toBe(s.tun.playerHp);
  });
  it('lets a dash carry the player over a hazard', () => {
    const s = game(1.0);
    const g = [0, 1, 2, 3].map(n => centre('g', n)).sort((a, b) => b.col - a.col)[0];
    s.player.x = g.x + 40; s.player.y = g.y;
    tick(s);
    const ev = [...stepGame(s, idle({ dodgeAt: 1.0, moveX: -1 }), s.time + 0.005, GRID)];
    while (s.time < 1.2) ev.push(...stepGame(s, idle({ moveX: -1 }), s.time + 0.005, GRID));
    expect(ev.some(e => e.type === 'respawn')).toBe(false);
    expect(s.player.x).toBeLessThan(g.x - 16);
  });
});
