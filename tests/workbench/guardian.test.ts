import { describe, expect, it } from 'vitest';
import { StageData, StageEvent, StageSim } from '../../src/core/stage/sim';
import stage01 from '../../src/data/stages/stage-01.json';

const BEAT = 60 / 110, STEP = BEAT / 4, BAR = 4 * BEAT;

/** A guardian alone: one bar of pattern, an attack on beats 2 and 4 that covers the arena. */
const arena = (): StageSim => {
  const d: StageData = {
    meter: { bpm: 110 }, lives: 9, start: [1.2, 0],
    map: { blend: 0, ground: [{ kind: 'circle', x: 0, y: 0, r: 10 }] },
    attacks: { big: { shape: { kind: 'circle', r: 3 }, tele: 4, layer: 'drum' } },
    emitters: [{ id: 'gem', kind: 'guardian', x: 0, y: 0, body: 0.3 }],
    encounters: [{ id: 'g', kind: 'guardian', emitter: 'gem', x: 0, y: 0, r: 4, flag: 'g-done',
      phrases: [{ id: 'p', bars: 1, events: [{ at: 4, attack: 'big' }, { at: 12, attack: 'big' }], advance: { survived: true } }] }],
  };
  const s = StageSim.from(d);
  s.stepTo(32 * STEP);
  return s;
};
const run = (s: StageSim, until: number, input: { moveX?: number; dashAt?: number } = {}): StageEvent[] => {
  const out: StageEvent[] = [];
  let first = true;
  while (s.time < until - 1e-9) {
    out.push(...s.stepTo(Math.min(until, s.time + 1 / 60), { moveX: input.moveX ?? 0, moveY: 0, dashAt: first && input.dashAt !== undefined ? input.dashAt : null }));
    first = false;
  }
  return out;
};

describe('a guardian (planner, 2026-11-19: passed only by one whole loop of its pattern without a hit)', () => {
  it('is passed when the player dodges every attack of one loop', () => {
    const s = arena();
    const ev: StageEvent[] = [];
    // the fight starts on the bar line at step 48; its attacks land on steps 52 and 60
    for (const [k, hit] of [52, 60].entries()) {
      ev.push(...run(s, hit * STEP - 0.03));
      ev.push(...run(s, hit * STEP + 0.3, { dashAt: hit * STEP - 0.02, moveX: k % 2 === 0 ? -1 : 1 }));
    }
    ev.push(...run(s, 64 * STEP + 0.05));
    expect(ev.filter(e => e.type === 'hurt')).toHaveLength(0);
    expect(ev.filter(e => e.type === 'cleared')).toHaveLength(1);
  });

  it('is not passed by a loop in which the player was hit; the loop starts over', () => {
    const s = arena();
    const ev = run(s, 48 * STEP + 2 * BAR);
    expect(ev.filter(e => e.type === 'hurt').length).toBeGreaterThan(0);
    expect(ev.filter(e => e.type === 'cleared')).toHaveLength(0);
  });

  it('in stage-01, every guardian is passed only this way and cannot be hurt', () => {
    const d = stage01 as unknown as StageData;
    for (const e of d.encounters!.filter(q => q.kind === 'guardian')) {
      for (const ph of e.phrases) expect(ph.advance).toEqual({ survived: true });
      expect(d.emitters!.find(q => q.id === e.emitter)!.hp ?? 0).toBe(0);
    }
  });
});
