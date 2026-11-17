import { describe, it, expect } from 'vitest';
import { autoAttack, Target } from '../src/core/game/attack';
import { stepGame } from '../src/core/game/sim';
import { GameEvent, GameState, Instrument } from '../src/core/game/types';
import { GRID, OPEN_ROOM, gameOn, idle } from './helpers';

const dummy = (x: number, y: number) => {
  const t = { x, y, r: 12, taken: 0, by: [] as Instrument[], takeDamage(n: number, inst: Instrument) { this.taken += n; this.by.push(inst); } };
  return t as Target & { taken: number; by: Instrument[] };
};
const armed = (inst: Instrument | null): GameState => {
  const s = gameOn(OPEN_ROOM);
  s.player.owned = inst ? [inst] : [];
  s.player.equipped = inst;
  return s;
};
const loop = (s: GameState, targets: Target[]): GameEvent[] => {
  const ev: GameEvent[] = [];
  for (let st = 0; st < s.song.loopSteps; st++) ev.push(...autoAttack.onStep(s, st, targets));
  return ev;
};

describe('auto attack', () => {
  it('does nothing without an equipped instrument', () => {
    const s = armed(null);
    expect(loop(s, [dummy(s.player.x + 50, s.player.y)])).toEqual([]);
  });
  it('does nothing without a target', () => {
    expect(loop(armed('drum'), [])).toEqual([]);
  });
  it('drum hits in melee on every quarter beat', () => {
    const s = armed('drum');
    const t = dummy(s.player.x + 50, s.player.y);
    const ev = loop(s, [t]);
    expect(ev).toHaveLength(8);
    expect(ev.every(e => e.type === 'attack' && e.hit)).toBe(true);
    expect(t.taken).toBe(8 * s.tun.dmgDrum);
  });
  it('drum whiffs visibly when out of range', () => {
    const s = armed('drum');
    const t = dummy(s.player.x + 200, s.player.y);
    const ev = loop(s, [t]);
    expect(ev).toHaveLength(8);
    expect(ev.every(e => e.type === 'attack' && !e.hit)).toBe(true);
    expect(t.taken).toBe(0);
  });
  it('hat fires from range on every off-beat', () => {
    const s = armed('hat');
    const t = dummy(s.player.x + 300, s.player.y);
    expect(loop(s, [t])).toHaveLength(8);
    expect(t.taken).toBe(8 * s.tun.dmgHat);
  });
  it('bass deals damage on every step a bass note sounds', () => {
    const s = armed('bass');
    const t = dummy(s.player.x + 100, s.player.y);
    loop(s, [t]);
    const total = s.song.layers.bass.reduce((a, n) => a + n.len, 0);
    expect(t.taken).toBe(total * s.tun.dmgBass);
  });
  it('aims at the nearest target only', () => {
    const s = armed('hat');
    const near = dummy(s.player.x + 100, s.player.y), far = dummy(s.player.x + 250, s.player.y);
    loop(s, [far, near]);
    expect(near.taken).toBeGreaterThan(0);
    expect(far.taken).toBe(0);
  });
});

describe('attack module in the game loop', () => {
  it('is called once per step, in order, even across a long frame', () => {
    const s = gameOn(OPEN_ROOM);
    const seen: number[] = [];
    s.attack = { onStep: (_s, abs) => { seen.push(abs); return []; } };
    stepGame(s, idle(), 1.5, GRID);
    stepGame(s, idle(), 3.0, GRID);
    expect(seen).toEqual(Array.from({ length: 16 }, (_, i) => 9 + i));
  });
});
