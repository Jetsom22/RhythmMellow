import { describe, it, expect } from 'vitest';
import { BOSS_PATTERNS } from '../src/core/game/bossPatterns';
import { Conductor } from '../src/core/game/conductor';

describe('boss pattern data', () => {
  const attacks = BOSS_PATTERNS.flatMap(p => p.attacks.map(a => ({ a, p })));
  it('lands every hit on a quarter beat with a telegraph of at least a beat, inside its phrase', () => {
    expect(attacks.length).toBeGreaterThan(10);
    for (const { a, p } of attacks) {
      expect(a.hitStep % 4, p.id).toBe(0);
      expect(a.telegraph, p.id).toBeGreaterThanOrEqual(4);
      expect(a.hitStep - a.telegraph, p.id).toBeGreaterThanOrEqual(0);
      expect(a.hitStep, p.id).toBeLessThan(p.bars * 16);
    }
  });
  it('covers the four sections in order and all three textures', () => {
    expect([...new Set(BOSS_PATTERNS.map(p => p.section))]).toEqual(['gi', 'seung', 'jeon', 'gyeol']);
    expect(new Set(BOSS_PATTERNS.map(p => p.texture))).toEqual(new Set(['call', 'tutti', 'resolve']));
    expect(BOSS_PATTERNS.map(p => p.id)).toEqual(['gi-solo', 'seung-drum', 'seung-hat', 'jeon-resolve', 'gyeol-tutti']);
  });
  it('lowers the health gate monotonically and ends at zero', () => {
    const gates = BOSS_PATTERNS.filter(p => p.advance.hpBelow !== undefined).map(p => p.advance.hpBelow!);
    expect(gates).toEqual([...gates].sort((a, b) => b - a));
    expect(gates[gates.length - 1]).toBe(0);
  });
});

describe('conductor', () => {
  it('repeats a phrase until its condition is met, then advances', () => {
    const c = new Conductor(BOSS_PATTERNS);
    expect(c.current.id).toBe('gi-solo');
    expect(c.phraseEnd({ hpFrac: 0.95, solved: false })).toEqual({ advanced: false, done: false });
    expect(c.phraseEnd({ hpFrac: 0.9, solved: false })).toEqual({ advanced: false, done: false });
    expect(c.repeat).toBe(2);
    expect(c.phraseEnd({ hpFrac: 0.8, solved: false })).toEqual({ advanced: true, done: false });
    expect(c.current.id).toBe('seung-drum');
    expect(c.repeat).toBe(0);
    expect(c.index).toBe(1);
  });
  it('leaves the puzzle phrase only when solved, whatever the health', () => {
    const c = new Conductor(BOSS_PATTERNS);
    for (const hp of [0.8, 0.6, 0.4]) c.phraseEnd({ hpFrac: hp, solved: false });
    expect(c.current.id).toBe('jeon-resolve');
    expect(c.phraseEnd({ hpFrac: 0, solved: false }).advanced).toBe(false);
    expect(c.phraseEnd({ hpFrac: 0.45, solved: true }).advanced).toBe(true);
    expect(c.current.id).toBe('gyeol-tutti');
  });
  it('reports done at the end of the last phrase', () => {
    const c = new Conductor(BOSS_PATTERNS);
    for (const hp of [0.8, 0.6, 0.4]) c.phraseEnd({ hpFrac: hp, solved: false });
    c.phraseEnd({ hpFrac: 0.4, solved: true });
    expect(c.phraseEnd({ hpFrac: 0.2, solved: true })).toEqual({ advanced: false, done: false });
    expect(c.phraseEnd({ hpFrac: 0, solved: true })).toEqual({ advanced: false, done: true });
  });
});
