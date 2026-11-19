import { describe, expect, it } from 'vitest';
import { StageData, StageEvent, StageSim } from '../../src/core/stage/sim';
import lab from '../../src/data/stages/lab-monster.json';

const BEAT = 60 / 110, STEP = BEAT / 4, BAR = BEAT * 4;

/** One chasing monster on an open field. The player stands at (px, 0); the monster starts at the centre. */
const field = (monster: Record<string, unknown> = {}, px = 3): StageSim => {
  const d: StageData = {
    meter: { bpm: 110 }, lives: 9, start: [px, 0],
    map: { blend: 0, ground: [{ kind: 'circle', x: 0, y: 0, r: 12 }], holes: [{ kind: 'circle', x: -4, y: 0, r: 1 }] },
    attacks: { slam: { shape: { kind: 'ring', r0: 1 / 3, r1: 1.25 }, tele: 4, layer: 'drum' } },
    emitters: [{ id: 'm', kind: 'monster', x: 0, y: 0, hp: 30, body: 0.12, touch: true, respawn: 2,
      motion: { kind: 'chase', by: 0.8, min: 0.7, sight: 6 }, pattern: { length: 16, events: [] }, ...monster } as any],
  };
  const s = StageSim.from(d);
  s.stepTo(32 * STEP);
  return s;
};
const run = (s: StageSim, until: number, input: { moveX?: number; moveY?: number; dashAt?: number } = {}): StageEvent[] => {
  const out: StageEvent[] = [];
  let first = true;
  while (s.time < until - 1e-9) {
    out.push(...s.stepTo(Math.min(until, s.time + 1 / 60), { moveX: input.moveX ?? 0, moveY: input.moveY ?? 0, dashAt: first && input.dashAt !== undefined ? input.dashAt : null }));
    first = false;
  }
  return out;
};
const U = (s: StageSim, v: number): number => v / s.u;

describe('a chasing monster', () => {
  it('walks after the player at its speed, every frame, and keeps its distance', () => {
    const s = field();
    run(s, s.time + BEAT);
    expect(U(s, s.emitters[0].x)).toBeCloseTo(0.8, 1);
    run(s, s.time + 4 * BEAT);
    expect(U(s, 3 * s.u - s.emitters[0].x)).toBeCloseTo(0.7, 2);
  });

  it('stands still while its own attack is on the way', () => {
    const s = field({ range: 6, pattern: { length: 16, events: [{ at: 8, attack: 'slam' }] } });
    // the slam is telegraphed from step 36 to step 40
    run(s, 36.5 * STEP);
    const x = s.emitters[0].x;
    expect(U(s, x)).toBeGreaterThan(0.7);
    run(s, 39.5 * STEP);
    expect(s.emitters[0].x).toBe(x);
    run(s, 44 * STEP);
    expect(s.emitters[0].x).toBeGreaterThan(x + 0.5 * s.u);
  });

  it('goes back home when it loses the player, and never steps into a hole', () => {
    const s = field({}, 5);
    run(s, s.time + 2 * BEAT);
    expect(s.emitters[0].x).toBeGreaterThan(0);
    s.x = 11 * s.u;                       // far out of sight
    run(s, s.time + 8 * BEAT);
    expect(U(s, Math.hypot(s.emitters[0].x, s.emitters[0].y))).toBeLessThan(0.05);
    // the player on the far side of the hole: the monster stops at its edge
    const h = field({}, -6.5);
    run(h, h.time + 8 * BEAT);
    expect(h.isGround(h.emitters[0].x, h.emitters[0].y)).toBe(true);
    expect(U(h, h.emitters[0].x)).toBeGreaterThan(-3.05);
  });

  it('walking into it is a hit; dashing through it on the beat is not', () => {
    const s = field({ motion: { kind: 'chase', by: 0, sight: 6 } }, 1);
    const hurt = run(s, s.time + BEAT, { moveX: -1 }).filter(e => e.type === 'hurt');
    expect(hurt).toHaveLength(1);
    const d = field({ motion: { kind: 'chase', by: 0, sight: 6 } }, 0.6);
    // dash left on the bar line (40 * STEP): 1U, through the body to -0.4U
    run(d, 40 * STEP - 0.03);
    const ev = run(d, 40 * STEP + 0.5, { moveX: -1, dashAt: 40 * STEP });
    expect(ev.filter(e => e.type === 'hurt')).toHaveLength(0);
    expect(U(d, d.x)).toBeLessThan(-0.3);
  });

  it('the drum breaks it in three beats, and it comes back two bars later when the player is away', () => {
    const s = field({ motion: { kind: 'chase', by: 0, sight: 6 } }, 0.5);
    s.owned = ['drum']; s.equipped = 'drum'; s.god = true;
    const ev = run(s, s.time + 3 * BEAT + STEP);
    expect(ev.filter(e => e.type === 'broken')).toHaveLength(1);
    s.x = 10 * s.u;
    run(s, s.time + 2 * BAR + BEAT);
    expect(s.emitters[0].broken).toBe(false);
    expect(s.emitters[0].hp).toBe(30);
  });
});

describe('the monster test field', () => {
  it('has the three monsters to compare, all on the ground', () => {
    const s = StageSim.from(lab as unknown as StageData);
    expect(s.emitters.map(e => e.id)).toEqual(['A-ring', 'B-circle', 'C-now']);
    for (const e of s.emitters) expect(s.isGround(e.x, e.y), e.id).toBe(true);
  });
});
