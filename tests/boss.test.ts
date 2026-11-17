import { describe, it, expect } from 'vitest';
import { BOSS_PATTERNS } from '../src/core/game/bossPatterns';
import { damageMult, hitTest } from '../src/core/game/boss';
import { createGame, stepGame } from '../src/core/game/sim';
import { GameEvent, GameState, Input } from '../src/core/game/types';
import { mixStateOf } from '../src/core/music/mix';
import { defaultTunables } from '../src/core/tunables';
import { GRID, idle } from './helpers';

const pat = (id: string) => BOSS_PATTERNS.find(p => p.id === id)!;
const tun = defaultTunables();
const STEP = 0.125;          // seconds per 16th at 120 bpm
const BAR = 2;

/** A game with all instruments, standing in the boss arena, fight started at bar `startBar`. */
function fight(over: Partial<GameState['flags']> = {}): { s: GameState; t0: number } {
  const s = createGame(7, defaultTunables());
  s.player.owned = ['drum', 'hat', 'bass']; s.player.equipped = 'drum'; s.doorOpen = true;
  Object.assign(s.flags, over);
  const room = s.world.rooms.boss!;
  s.player.x = room.x + room.w / 2 - 250; s.player.y = room.y + room.h / 2;
  stepGame(s, idle(), 1.99, GRID);                 // just before bar 1
  const ev = stepGame(s, idle(), 2.001, GRID);     // bar 1 begins: the fight starts on the bar line
  expect(ev).toContainEqual({ type: 'bossStart' });
  return { s, t0: 2.0 };
}
function runTo(s: GameState, until: number, input: (s: GameState) => Partial<Input> = () => ({})): GameEvent[] {
  const out: GameEvent[] = [];
  while (s.time < until - 1e-9) out.push(...stepGame(s, idle(input(s)), Math.min(until, s.time + 0.02), GRID));
  return out;
}

describe('shapes', () => {
  const boss = { x: 0, y: 0 };
  it('tests circles, rings, lines and zones', () => {
    expect(hitTest({ kind: 'circle', at: 'player', r: 50 }, { x: 10, y: 0 }, boss, 40, 30)).toBe(true);
    expect(hitTest({ kind: 'circle', at: 'player', r: 50 }, { x: 10, y: 0 }, boss, 80, 0)).toBe(false);
    expect(hitTest({ kind: 'ring', rIn: 60, rOut: 160 }, boss, boss, 100, 0)).toBe(true);
    expect(hitTest({ kind: 'ring', rIn: 60, rOut: 160 }, boss, boss, 30, 0)).toBe(false);
    expect(hitTest({ kind: 'line', angle: 0, width: 60 }, boss, boss, 300, 20)).toBe(true);
    expect(hitTest({ kind: 'line', angle: 0, width: 60 }, boss, boss, -300, 0)).toBe(false);
    expect(hitTest({ kind: 'line', angle: 0, width: 60 }, boss, boss, 300, 40)).toBe(false);
    expect(hitTest({ kind: 'zone', x: -100, y: -50, w: 100, h: 100, holdSteps: 4 }, boss, boss, -50, 0)).toBe(true);
    expect(hitTest({ kind: 'zone', x: -100, y: -50, w: 100, h: 100, holdSteps: 4 }, boss, boss, 10, 0)).toBe(false);
  });
});

describe('damage multipliers', () => {
  it('rewards the weak instrument and the open bars of a call phrase', () => {
    const p = pat('seung-drum');
    const open = p.openBars[0], closed = [0, 1, 2, 3].find(b => !p.openBars.includes(b))!;
    expect(damageMult(p, open, 'hat', tun, false)).toBeCloseTo(tun.weakMult * tun.callOpenMult);
    expect(damageMult(p, closed, 'hat', tun, false)).toBeCloseTo(tun.weakMult * tun.callClosedMult);
    expect(damageMult(p, open, 'drum', tun, false)).toBeCloseTo(tun.otherMult * tun.callOpenMult);
  });
  it('is neutral with no weakness and zero behind the shield', () => {
    expect(damageMult(pat('gyeol-tutti'), 0, 'bass', tun, false)).toBe(1);
    expect(damageMult(pat('seung-hat'), 0, 'drum', tun, false)).toBe(tun.weakMult);
    expect(damageMult(pat('gyeol-tutti'), 0, 'bass', tun, true)).toBe(0);
  });
});

describe('boss fight', () => {
  it('starts on a bar line with the boss carrying the lead', () => {
    const { s } = fight();
    expect(s.boss).not.toBeNull();
    expect(s.boss!.conductor.current.id).toBe('gi-solo');
    expect(s.leadOwner).toBe('boss');
    expect(mixStateOf(s).leadOn).toBe(true);
    expect(mixStateOf(s).focus).toEqual(['lead']);
  });
  it('hurts a player who stands in a telegraphed attack', () => {
    const { s, t0 } = fight();
    const hit = pat('gi-solo').attacks[0];
    const ev = runTo(s, t0 + hit.hitStep * STEP + 0.3);
    expect(ev.filter(e => e.type === 'hurt')).toEqual([{ type: 'hurt', hp: tun.playerHp - 1 }]);
    expect(s.player.hp).toBe(tun.playerHp - 1);
    expect(s.boss!.harmony).toBe(0);
    expect(mixStateOf(s).muffled).toBe(true);
    runTo(s, s.time + tun.muffleBars * BAR + 0.1, () => ({ moveX: 0 }));
  });
  it('spares a player who walks out of the telegraph', () => {
    const { s, t0 } = fight();
    const hit = pat('gi-solo').attacks[0];
    runTo(s, t0 + (hit.hitStep - hit.telegraph) * STEP + 0.05);
    s.player.y += 150;
    const ev = runTo(s, t0 + hit.hitStep * STEP + 0.3);
    expect(ev.some(e => e.type === 'hurt')).toBe(false);
  });
  it('lets a beat dodge absorb the hit and raises harmony', () => {
    const { s, t0 } = fight();
    const hit = pat('gi-solo').attacks[0];
    const beatT = t0 + hit.hitStep * STEP;
    runTo(s, beatT - 0.03);
    const ev = [...stepGame(s, idle({ dodgeAt: beatT - 0.02, moveY: 1 }), beatT - 0.01, GRID), ...runTo(s, beatT + 0.3)];
    expect(ev.some(e => e.type === 'hurt')).toBe(false);
    expect(s.boss!.harmony).toBe(1);
    expect(mixStateOf(s).harmony).toBe(1);
  });
  it('forgives a dodge pressed slightly after the beat', () => {
    const { s, t0 } = fight();
    const hit = pat('gi-solo').attacks[0];
    const beatT = t0 + hit.hitStep * STEP;
    runTo(s, beatT + 0.04);
    const ev = [...stepGame(s, idle({ dodgeAt: beatT + 0.05 }), beatT + 0.06, GRID), ...runTo(s, beatT + 0.4)];
    expect(ev.some(e => e.type === 'hurt')).toBe(false);
    expect(s.boss!.harmony).toBe(1);
  });
  it('does not forgive a missed dodge', () => {
    const { s, t0 } = fight();
    const hit = pat('gi-solo').attacks[0];
    const beatT = t0 + hit.hitStep * STEP;
    runTo(s, beatT - 0.26);
    // Off the beat: a short hop with almost no protection, still inside the circle.
    const ev = [...stepGame(s, idle({ dodgeAt: beatT - 0.25 }), beatT - 0.24, GRID), ...runTo(s, beatT + 0.3)];
    expect(ev.filter(e => e.type === 'hurt')).toHaveLength(1);
  });
  it('resets harmony and muffles the music when hit, then recovers', () => {
    const { s, t0 } = fight();
    s.boss!.harmony = 2;
    const hit = pat('gi-solo').attacks[0];
    runTo(s, t0 + hit.hitStep * STEP + 0.3);
    expect(s.boss!.harmony).toBe(0);
    expect(mixStateOf(s).muffled).toBe(true);
    s.flags.god = true;
    runTo(s, s.time + tun.muffleBars * BAR + 0.2);
    expect(mixStateOf(s).muffled).toBe(false);
  });
  it('sends a dead player back to the door and resets the fight', () => {
    const { s, t0 } = fight();
    s.player.hp = 1;
    const hit = pat('gi-solo').attacks[0];
    const ev = runTo(s, t0 + hit.hitStep * STEP + 0.3);
    expect(ev).toContainEqual({ type: 'death' });
    expect(s.boss).toBeNull();
    expect(s.leadOwner).toBeNull();
    expect(s.player.hp).toBe(tun.playerHp);
    expect({ x: s.player.x, y: s.player.y }).toEqual(s.world.rooms.boss!.entry);
  });
  it('keeps the boss above the health gate of the current phrase', () => {
    const { s } = fight({ god: true });
    const b = s.boss!;
    s.player.x = b.x + 50; s.player.y = b.y;
    runTo(s, s.time + 3.9);     // not yet at the end of the 4-bar phrase
    expect(b.hp).toBeGreaterThanOrEqual(pat('gi-solo').advance.hpBelow! * tun.bossHp - 1e-6);
    expect(b.conductor.current.id).toBe('gi-solo');
  });
  it('repeats the phrase, with rising repeat counts, while the player does no damage', () => {
    const { s } = fight({ god: true });
    s.player.equipped = null; s.player.owned = [];
    const ev = runTo(s, s.time + 4 * BAR * 3 + 0.1).filter(e => e.type === 'phrase');
    expect(ev).toEqual([1, 2, 3].map(repeat => ({ type: 'phrase', id: 'gi-solo', repeat, advanced: false })));
  });
});

describe('resonance pads', () => {
  function atPuzzle(): GameState {
    const { s } = fight({ god: true });
    const b = s.boss!;
    while (b.conductor.current.id !== 'jeon-resolve') {
      const p = b.conductor.current;
      s.player.x = b.x + 50; s.player.y = b.y; s.player.equipped = p.weakTo ?? 'drum';
      stepGame(s, idle(), s.time + 0.02, GRID);
      if (s.time > 400) throw new Error('never reached the puzzle');
    }
    return s;
  }
  it('shields the boss and locks a pad after a full bar with the matching instrument', () => {
    const s = atPuzzle(), b = s.boss!;
    expect(b.shield).toBe(true);
    const hp = b.hp;
    const pad = b.pads[0];
    const ev = runTo(s, s.time + 17 * STEP + 0.05, st => { st.player.x = pad.x; st.player.y = pad.y; st.player.equipped = pad.inst; return {}; });
    expect(pad.locked).toBe(true);
    expect(b.hp).toBe(hp);
    expect(ev.some(e => e.type === 'solved')).toBe(false);
  });
  it('makes no progress with the wrong instrument and resets when the player steps off', () => {
    const s = atPuzzle(), b = s.boss!;
    const pad = b.pads[0];
    const wrong = b.pads[1].inst;
    runTo(s, s.time + 10 * STEP, st => { st.player.x = pad.x; st.player.y = pad.y; st.player.equipped = wrong; return {}; });
    expect(pad.progress).toBe(0);
    runTo(s, s.time + 10 * STEP, st => { st.player.x = pad.x; st.player.y = pad.y; st.player.equipped = pad.inst; return {}; });
    expect(pad.progress).toBeGreaterThan(5);
    runTo(s, s.time + 2 * STEP, st => { st.player.x = pad.x + 200; st.player.y = pad.y; return {}; });
    expect(pad.progress).toBe(0);
    expect(pad.locked).toBe(false);
  });
  it('drops the shield and resolves once all three are locked', () => {
    const s = atPuzzle(), b = s.boss!;
    const ev: GameEvent[] = [];
    for (const pad of b.pads) ev.push(...runTo(s, s.time + 17 * STEP + 0.05, st => { st.player.x = pad.x; st.player.y = pad.y; st.player.equipped = pad.inst; return {}; }));
    expect(ev.filter(e => e.type === 'solved')).toHaveLength(1);
    expect(b.shield).toBe(false);
    const next = runTo(s, s.time + 4 * BAR + 0.1).filter(e => e.type === 'phrase' && e.advanced);
    expect(next).toEqual([{ type: 'phrase', id: 'gyeol-tutti', repeat: 0, advanced: true }]);
  });
});

describe('a whole fight', () => {
  it('walks through every phrase in order and ends with the song complete', () => {
    const { s } = fight({ god: true });
    const b = s.boss!;
    const ev: GameEvent[] = [];
    while (!b.defeated) {
      const p = b.conductor.current;
      const pad = b.pads.find(x => !x.locked);
      if (p.texture === 'resolve' && pad) { s.player.x = pad.x; s.player.y = pad.y; s.player.equipped = pad.inst; }
      else { s.player.x = b.x + 50; s.player.y = b.y; s.player.equipped = p.weakTo ?? 'drum'; }
      ev.push(...stepGame(s, idle(), s.time + 0.02, GRID));
      if (s.time > 900) throw new Error('fight never ended');
    }
    expect(ev.filter(e => e.type === 'phrase' && e.advanced).map(e => (e as { id: string }).id)).toEqual(['seung-drum', 'seung-hat', 'jeon-resolve', 'gyeol-tutti']);
    expect(ev.filter(e => e.type === 'bossDefeated')).toHaveLength(1);
    expect(s.leadOwner).toBe('player');
    const m = mixStateOf(s);
    expect(m.leadOn).toBe(true);
    expect(m.harmony).toBe(tun.harmonyMax);
    expect(m.focus).toBeNull();
    // Nothing attacks after the end.
    s.flags.god = false;
    const after = runTo(s, s.time + 8 * BAR);
    expect(after.some(e => e.type === 'hurt' || e.type === 'phrase')).toBe(false);
  });
});

describe('aiming inside the arena', () => {
  it.each([[-14, -240], [276, -148], [300, 200]])('hits the boss, not the practice target in the hub, from offset %i,%i', (dx, dy) => {
    const { s } = fight({ god: true });
    const b = s.boss!;
    s.player.equipped = 'hat';
    s.player.x = b.x + dx; s.player.y = b.y + dy;
    const hp = b.hp;
    const ev = runTo(s, s.time + 2).filter(e => e.type === 'attack');
    expect(ev.length).toBeGreaterThan(0);
    expect(ev.every(e => e.type === 'attack' && e.hit)).toBe(true);
    expect(b.hp).toBeLessThan(hp);
  });
});
