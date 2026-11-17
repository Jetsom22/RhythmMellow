import { describe, it, expect } from 'vitest';
import { generateSong, euclid, vary, notesAt } from '../src/core/music/song';

describe('song generation', () => {
  const s = generateSong(7, 2);
  it('is deterministic per seed', () => {
    expect(generateSong(7, 2)).toEqual(generateSong(7, 2));
    expect(generateSong(7, 2)).not.toEqual(generateSong(8, 2));
    expect(s.loopSteps).toBe(32);
  });
  it('puts kick on beats 1 and 3, snare on 2 and 4', () => {
    for (const bar of [0, 1]) {
      const kicks = s.layers.drum.filter(n => n.voice === 'kick').map(n => n.step);
      const snares = s.layers.drum.filter(n => n.voice === 'snare').map(n => n.step);
      expect(kicks).toEqual(expect.arrayContaining([bar * 16, bar * 16 + 8]));
      expect(snares).toEqual(expect.arrayContaining([bar * 16 + 4, bar * 16 + 12]));
    }
  });
  it('keeps hats off the quarter beats and on every off-beat', () => {
    expect(s.layers.hat.every(n => n.step % 4 !== 0)).toBe(true);
    expect([2, 6, 10, 14, 18, 22, 26, 30].every(st => s.layers.hat.some(n => n.step === st))).toBe(true);
  });
  it('gives the bass long notes with a rest of 6+ steps in every bar', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const song = generateSong(seed, 2);
      expect(song.layers.bass.every(n => n.len >= 4)).toBe(true);
      for (const bar of [0, 1]) {
        const sounding = new Set<number>();
        for (const n of song.layers.bass) for (let i = 0; i < n.len; i++) sounding.add(n.step + i);
        let best = 0, run = 0;
        for (let st = bar * 16; st < bar * 16 + 16; st++) { run = sounding.has(st) ? 0 : run + 1; best = Math.max(best, run); }
        expect(best).toBeGreaterThanOrEqual(6);
        expect(song.layers.bass.some(n => n.step >= bar * 16 && n.step < bar * 16 + 16)).toBe(true);
      }
    }
  });
  it('keeps pitched layers inside the scale', () => {
    const pcs = new Set(s.scale.map(d => (s.rootMidi + d) % 12));
    for (const l of ['bass', 'lead', 'pad'] as const) {
      expect(s.layers[l].length).toBeGreaterThan(0);
      expect(s.layers[l].every(n => pcs.has(n.midi % 12))).toBe(true);
    }
  });
  it('has a base pulse on every quarter beat', () => {
    expect(s.tick.map(n => n.step)).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
  });
  it('builds euclidean rhythms', () => {
    expect(euclid(3, 8)).toEqual([true, false, false, true, false, false, true, false]);
  });
  it('varies a layer deterministically while keeping the beat skeleton', () => {
    expect(vary(s, 'hat', 0)).toEqual(s.layers.hat);
    expect(vary(s, 'hat', 1)).toEqual(vary(s, 'hat', 1));
    expect(vary(s, 'hat', 1)).not.toEqual(s.layers.hat);
    const kicks = vary(s, 'drum', 2).filter(n => n.voice === 'kick').map(n => n.step);
    expect(kicks).toEqual(expect.arrayContaining([0, 8, 16, 24]));
  });
  it('looks up notes by absolute step', () => {
    expect(notesAt(s.tick, 32, 36).map(n => n.step)).toEqual([4]);
    expect(notesAt(s.tick, 32, 37)).toEqual([]);
  });
});
