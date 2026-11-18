import { describe, expect, it } from 'vitest';
import { Meter } from '../src/core/stage/meter';
import { GroundField, sdShape } from '../src/core/stage/ground';
import { contains, Shape } from '../src/core/stage/shapes';
import { REFORM_STEPS, StageData, StageEvent, StageSim } from '../src/core/stage/sim';
import stage01 from '../src/data/stages/stage-01.json';

const BEAT = 60 / 110, STEP = BEAT / 4, U = 120;

const stage = (extra: Partial<StageData> = {}): StageData => ({
  meter: { bpm: 110 }, lives: 3, start: [0, 0],
  map: { blend: 0, ground: [{ kind: 'circle', x: 0, y: 0, r: 10 }], holes: [{ kind: 'rect', x: 5, y: 0, w: 0.7, h: 6 }] },
  attacks: {
    big: { shape: { kind: 'circle', r: 3 }, tele: 4, anchor: 'self', layer: 'drum' },
    ring: { shape: { kind: 'ring', r0: 1.0, r1: 1.9 }, tele: 4, anchor: 'self', layer: 'drum' },
    zone: { shape: { kind: 'zone', w: 2, h: 2 }, tele: 4, hold: 8, anchor: 'self', layer: 'bass' },
    aim: { shape: { kind: 'circle', r: 0.6 }, tele: 4, anchor: 'target', layer: 'lead' },
  },
  ...extra,
});
/** A sim already started at bar 2 (step 32), so every test begins on a bar line. */
const make = (extra: Partial<StageData> = {}): StageSim => { const s = StageSim.from(stage(extra)); s.stepTo(32 * STEP); return s; };
const run = (s: StageSim, until: number, input: { moveX?: number; moveY?: number; dashAt?: number } = {}): StageEvent[] => {
  const out: StageEvent[] = [];
  let first = true;
  while (s.time < until - 1e-9) {
    out.push(...s.stepTo(Math.min(until, s.time + 1 / 60), { moveX: input.moveX ?? 0, moveY: input.moveY ?? 0, dashAt: first && input.dashAt !== undefined ? input.dashAt : null }));
    first = false;
  }
  return out;
};
type Ev<T> = StageEvent extends infer E ? (E extends { type: infer K } ? (T extends K ? E : never) : never) : never;
const of = <T extends StageEvent['type']>(ev: StageEvent[], type: T): Ev<T>[] => ev.filter(e => e.type === type) as any;
const device = (attack: string, at = 8): Partial<StageData> => ({ emitters: [{ id: 'dev', kind: 'device', x: 0, y: 0, pattern: { length: 16, rest: 16, events: [{ at, attack }] } }] });
const gate = (requires: any): Partial<StageData> => ({ gates: [{ id: 'b', shape: { kind: 'rect', x: 12, y: 0, w: 4, h: 1 }, requires }] });

describe('the ground', () => {
  const ground: Shape[] = [{ kind: 'circle', x: 0, y: 0, r: 100 }, { kind: 'capsule', x1: 100, y1: 0, x2: 300, y2: 0, r: 20 },
    { kind: 'sector', x: 0, y: 0, r0: 200, r1: 300, a0: 80, a1: 100 }, { kind: 'rect', x: 0, y: -300, w: 100, h: 40, rot: 45 }];
  const on = (x: number, y: number): boolean => ground.some(g => contains(g, x, y)) && !contains({ kind: 'circle', x: 0, y: 0, r: 20 }, x, y);
  it('is made of shapes, and a hole is not ground', () => {
    expect(on(50, 0)).toBe(true);
    expect(on(5, 5)).toBe(false);
    expect(on(250, 15) && !on(250, 25)).toBe(true);
    expect(on(0, 250) && !on(-250, 0) && !on(0, 150)).toBe(true);
    expect(on(30, -270) && !on(45, -315)).toBe(true);
    expect(on(900, 900)).toBe(false);
  });
});

describe('the ground as one lump', () => {
  const shapes: Shape[] = [{ kind: 'circle', x: 0, y: 0, r: 100 }, { kind: 'capsule', x1: 0, y1: 0, x2: 300, y2: 0, r: 30 }, { kind: 'rect', x: 0, y: -200, w: 100, h: 40, rot: 30 },
    { kind: 'sector', x: 0, y: 0, r0: 200, r1: 300, a0: 80, a1: 100 }, { kind: 'polygon', points: [[400, 0], [500, 0], [450, 80]] }];
  it('the distance to each shape is negative exactly where the shape is', () => {
    for (const s of shapes) for (let y = -350; y <= 350; y += 17) for (let x = -350; x <= 550; x += 17) {
      const d = sdShape(s, x, y);
      if (Math.abs(d) > 0.01) expect(d < 0, `${s.kind} at ${x},${y}`).toBe(contains(s, x, y));
    }
  });
  it('with no blend it is plain geometry; with blend the joins fill in and nothing else moves', () => {
    const plain = new GroundField([shapes[0], shapes[1]], [], 0), soft = new GroundField([shapes[0], shapes[1]], [], 60);
    expect(plain.isGround(105, 35)).toBe(false);       // the corner where the path leaves the circle
    expect(soft.isGround(105, 35)).toBe(true);
    expect(soft.isGround(250, 35)).toBe(false);        // far from the join the path is as wide as before
    expect(soft.isGround(0, 105)).toBe(false);
  });
  it('holes are cut out, and an open way is laid over a hole', () => {
    const f = new GroundField([shapes[0]], [{ kind: 'circle', x: 0, y: 0, r: 40 }], 30);
    expect(f.isGround(0, 0)).toBe(false);
    f.setWays([{ kind: 'rect', x: 0, y: 0, w: 120, h: 20 }]);
    expect(f.isGround(0, 0)).toBe(true);
    expect(f.isGround(0, 25)).toBe(false);
  });
  it('a point travelling into the edge bounces back onto the ground', () => {
    const f = new GroundField([shapes[0]], [], 0), [x, y, hits] = f.travel(80, 0, 1, 0, 60);
    expect(hits).toBe(1);
    expect(x).toBeCloseTo(60, 0);
    expect(y).toBeCloseTo(0, 0);
  });
  it('its edge can be traced', () => {
    const f = new GroundField([shapes[0]], [], 0), [edge] = f.contour(-128, -128, 256, [0]);
    expect(edge.length).toBeGreaterThan(100);
    for (const [x0, y0] of edge) expect(Math.hypot(x0, y0)).toBeCloseTo(100, 0);
  });
});

describe('walking and the dash judgement', () => {
  it('1U is the distance walked in one beat: 120 px at 110 bpm', () => {
    const s = make();
    expect(s.u).toBeCloseTo(120, 3);
    run(s, s.time + BEAT, { moveX: 1 });
    expect(s.x).toBeCloseTo(120, 0);
  });
  it('off the beat, the dash does not happen', () => {
    const s = make();
    const ev = run(s, s.time + 0.3, { dashAt: s.time + 0.2 });
    expect(of(ev, 'dash')).toHaveLength(0);
    expect(of(ev, 'fizzle')).toHaveLength(1);
    expect(s.x).toBe(0);
  });
  it.each([['on the beat', 0], ['a little off the beat', 0.09]])('a dash %s travels exactly 1U', (_n, off) => {
    const s = make();
    run(s, s.time + 0.3, { dashAt: s.time + (off as number) });
    expect(s.x).toBeCloseTo(120, 0);
  });
  it('with no attack there is no just, however well timed the dash', () => {
    const s = make();
    const ev = run(s, s.time + 0.3, { dashAt: s.time });
    expect(of(ev, 'dash')[0].just).toBe(false);
    expect(of(ev, 'absorb')).toHaveLength(0);
  });
  it('a dash carries the player over a gap, just or not', () => {
    const s = make(); s.x = 4.5 * U;
    const ev = run(s, s.time + 0.3, { dashAt: s.time + 0.09 });
    expect(of(ev, 'hurt')).toHaveLength(0);
    expect(s.x).toBeGreaterThan(5.35 * U);
  });
  it('walking off the ground is a fall: a life, two beats scattered, back at the checkpoint', () => {
    const s = make(); s.x = 4.5 * U;
    const ev = run(s, s.time + 0.5, { moveX: 1 });
    expect(of(ev, 'hurt')).toHaveLength(1);
    expect(of(ev, 'hurt')[0].kind).toBe('fall');
    expect(s.lives).toBe(2);
    expect(s.x).toBe(0);
    const until = s.reform!.until;
    expect(until - s.step).toBeLessThanOrEqual(REFORM_STEPS);
    run(s, (until - 1) * STEP, { moveX: 1, dashAt: s.time });
    expect(s.x).toBe(0);
    expect(s.dash).toBeNull();
    run(s, (until + 2) * STEP, { moveX: 1 });
    expect(s.reform).toBeNull();
    expect(s.x).toBeGreaterThan(10);
  });
});

describe('attacks and the just judgement', () => {
  it('standing in an attack when it lands costs a life; it is announced one beat ahead', () => {
    const s = make(device('big'));
    const ev = run(s, 40 * STEP + 0.3);
    expect(of(ev, 'hurt')).toHaveLength(1);
    expect(s.lives).toBe(2);
    expect(of(ev, 'strike')[0].step).toBe(40);
    expect(of(ev, 'strike')[0].inst.start).toBe(36);
  });
  it('a dodge started as the attack lands is a just', () => {
    const s = make(device('big'));
    run(s, 40 * STEP - 0.03);
    const ev = run(s, 40 * STEP + 0.4, { dashAt: 40 * STEP - 0.02 });
    expect(of(ev, 'dash')[0].just).toBe(true);
    expect(of(ev, 'hurt')).toHaveLength(0);
    expect(of(ev, 'absorb')).toHaveLength(1);
    expect(s.lives).toBe(3);
  });
  it('a just dodge started a moment late still answers the hit', () => {
    const s = make(device('big'));
    run(s, 40 * STEP + 0.03);
    const ev = run(s, 40 * STEP + 0.4, { dashAt: 40 * STEP + 0.04 });
    expect(of(ev, 'hurt')).toHaveLength(0);
    expect(of(ev, 'absorb')).toHaveLength(1);
  });
  it('any dash is invulnerable from start to end, just or not', () => {
    const s = make(device('big'));
    run(s, 40 * STEP - 0.11);
    const ev = run(s, 40 * STEP + 0.4, { dashAt: 40 * STEP - 0.10 });      // inside the dash time, outside the just time
    expect(of(ev, 'dash')).toHaveLength(1);
    expect(of(ev, 'dash')[0].just).toBe(false);
    expect(of(ev, 'hurt')).toHaveLength(0);
    expect(of(ev, 'absorb')).toHaveLength(0);
    expect(s.charged).toBe(false);
  });
  it('a dash that has ended no longer protects', () => {
    const s = make(device('zone'));          // strikes at 40, 44, 48
    s.x = -0.5 * U;                           // the dash ends still inside the zone
    run(s, 40 * STEP - 0.03);
    const ev = run(s, 44 * STEP + 0.4, { dashAt: 40 * STEP - 0.02 });
    expect(of(ev, 'hurt')).toHaveLength(1);
  });
  it('a just dodge charges one special attack; without a charge the key does nothing', () => {
    const s = make(device('big'));
    s.owned = ['drum']; s.equipped = 'drum';
    expect(of(s.stepTo(s.time, { special: true }), 'special')).toHaveLength(0);
    run(s, 40 * STEP - 0.03);
    const ev = run(s, 40 * STEP + 0.3, { dashAt: 40 * STEP - 0.02 });
    expect(of(ev, 'charge')).toHaveLength(1);
    expect(s.charged).toBe(true);
    expect(of(s.stepTo(s.time, { special: true }), 'special')).toHaveLength(1);
    expect(s.charged).toBe(false);
    expect(of(s.stepTo(s.time, { special: true }), 'special')).toHaveLength(0);
  });
  const dummy = (x: number, y: number, extra: any = {}): Partial<StageData> => ({ emitters: [{ id: 'd', kind: 'device', x, y, hp: 1000, body: 0.2, pattern: { length: 16, events: [] }, ...extra }] });
  it('the drum special bursts around the player', () => {
    const s = make(dummy(1.5, 0)); s.owned = ['drum']; s.equipped = 'drum'; s.charged = true;
    s.stepTo(s.time, { special: true });
    expect(s.emitters[0].hp).toBe(940);
    const far = make(dummy(3, 0)); far.owned = ['drum']; far.equipped = 'drum'; far.charged = true;
    far.stepTo(far.time, { special: true });
    expect(far.emitters[0].hp).toBe(1000);
  });
  it('the hat special is a line the way the player faces', () => {
    const s = make(dummy(5, 0)); s.owned = ['hat']; s.equipped = 'hat'; s.charged = true;
    s.stepTo(s.time, { special: true });
    expect(s.emitters[0].hp).toBe(960);
    const side = make(dummy(0, 5)); side.owned = ['hat']; side.equipped = 'hat'; side.charged = true;
    side.stepTo(side.time, { special: true });
    expect(side.emitters[0].hp).toBe(1000);
  });
  it('the bass special leaves a pool that strikes on every beat for four beats', () => {
    const s = make(dummy(2, 0)); s.owned = ['hat', 'bass']; s.equipped = 'bass'; s.charged = true; s.god = true;
    s.stepTo(s.time, { special: true });
    s.equipped = 'hat';                       // so that the ordinary bass attack does not add to it
    s.x = -9 * U;
    run(s, 60 * STEP);
    expect(s.emitters[0].hp).toBe(1000 - 15 * 5);       // once when fired, then on four beats
    expect(s.pools).toHaveLength(0);
  });
  it('a device can react to a special attack: that is how a special solves things', () => {
    const s = make({ ...dummy(1, 0, { hp: 0, onSpecial: { flag: 'sw', layer: 'drum' } }), ...gate({ flag: 'sw' }) });
    s.owned = ['drum', 'hat']; s.equipped = 'hat'; s.charged = true;
    s.stepTo(s.time, { special: true });
    expect(s.isGround(12 * U, 0)).toBe(false);          // the wrong instrument
    s.equipped = 'drum'; s.charged = true;
    expect(of(s.stepTo(s.time, { special: true }), 'trigger')).toHaveLength(1);
    expect(s.isGround(12 * U, 0)).toBe(true);
  });
  it('being hit loses the charge', () => {
    const s = make(device('big')); s.charged = true;
    run(s, 40 * STEP + 0.3);
    expect(s.charged).toBe(false);
  });
  it('a held attack strikes on every beat while it lasts', () => {
    const s = make(device('zone')); s.god = true;
    expect(of(run(s, 56 * STEP), 'strike').map(e => e.step)).toEqual([40, 44, 48]);
  });
  it('both judgement times come from the stage data', () => {
    const m = Meter.from({ bpm: 110, dashMs: 80, justMs: 30 });
    expect([m.dashMs, m.justMs, m.judge(0.07).dash, m.judge(0.09).dash]).toEqual([80, 30, true, false]);
  });
  it('a device can follow a layer of the song', () => {
    const s = make({ emitters: [{ id: 'dike', kind: 'device', x: 0, y: 0, follow: { layer: 'bass', attack: 'big' } }] });
    s.god = true;
    s.layerSounding = (_l, st) => ((st % 16) + 16) % 16 < 8;
    expect(of(run(s, 64 * STEP + 0.01), 'strike').map(e => e.step)).toEqual([48, 52, 64]);
  });
  it('devices with a phase start later', () => {
    const s = make({ emitters: [{ id: 'd', kind: 'device', x: 0, y: 0, pattern: { length: 16, rest: 16, phase: 8, events: [{ at: 8, attack: 'big' }] } }] });
    s.god = true;
    expect(of(run(s, 60 * STEP), 'strike').map(e => e.step)).toEqual([48]);
  });
});

describe('monsters', () => {
  const mon = (pattern: any): Partial<StageData> => ({ emitters: [{ id: 'mon', kind: 'monster', x: 3, y: 0, motion: { kind: 'approach', every: 4, by: 0.5, min: 1.0 }, pattern }] });
  it('step toward the player on the beat and stop short', () => {
    const s = make(mon({ length: 16, events: [] }));
    run(s, 36 * STEP + 0.01);
    expect(s.emitters[0].x).toBeCloseTo(2.5 * U, 0);
    run(s, 60 * STEP);
    expect(s.emitters[0].x).toBeGreaterThanOrEqual(1.0 * U - 0.5);
  });
  it('never chain hits on a player who stands still, and never aim at one who is scattered', () => {
    const s = make({ emitters: [{ id: 'mon', kind: 'monster', x: 2, y: 0, pattern: { length: 8, events: [{ at: 4, attack: 'aim' }] } }] });
    const ev: StageEvent[] = [];
    let aimedWhileGone = false;
    while (s.time < 32 * STEP + 8 * BEAT) {
      ev.push(...s.stepTo(s.time + 1 / 60));
      if (s.reform) for (const a of s.active) if (a.start > s.reform.until - REFORM_STEPS) aimedWhileGone = true;
    }
    expect(of(ev, 'hurt').length).toBeLessThanOrEqual(3);
    expect(of(ev, 'gameover')).toHaveLength(0);
    expect(aimedWhileGone).toBe(false);
  });
});

describe('lives and saving', () => {
  const withPart: Partial<StageData> = { parts: [{ layer: 'drum', x: 2, y: 0 }], checkpoints: [{ x: -2, y: 0, r: 0.5 }] };
  it('taking an instrument restores every life and saves', () => {
    const s = make(withPart); s.lives = 1;
    const ev = run(s, s.time + 2.2 * BEAT, { moveX: 1 });
    expect(of(ev, 'part')).toHaveLength(1);
    expect([s.lives, s.owned, s.equipped]).toEqual([3, ['drum'], 'drum']);
    s.x = 4.6 * U;
    run(s, s.time + 0.6, { moveX: 1 });
    expect(s.x).toBeCloseTo(2 * U, 0);      // still scattered: waiting at the checkpoint
    expect(s.lives).toBe(2);
    s.lives = 1; s.reform = null; s.x = 4.6 * U;
    const over = run(s, s.time + 0.6, { moveX: 1 });
    expect(of(over, 'gameover')).toHaveLength(1);
    expect([s.owned, s.lives]).toEqual([['drum'], 3]);
    expect(s.x).toBeCloseTo(2 * U, 0);
  });
  it('before any instrument, the save is the start', () => {
    const s = make(withPart); s.lives = 1; s.x = 4.6 * U;
    run(s, s.time + 1.0, { moveX: 1 });
    expect([s.x, s.owned.length, s.lives]).toEqual([0, 0, 3]);
  });
});

describe('guardians', () => {
  const guarded: Partial<StageData> = {
    parts: [{ layer: 'hat', x: 0, y: 2, guard: 'g' }],
    emitters: [{ id: 'gem', kind: 'guardian', x: 0, y: 0, hp: 30, body: 0.3 }],
    encounters: [{ id: 'g', kind: 'guardian', emitter: 'gem', x: 0, y: 0, r: 4, flag: 'g-done',
      phrases: [{ id: 'p', bars: 1, events: [{ at: 4, attack: 'big' }, { at: 8, attack: 'big' }, { at: 12, attack: 'big' }], advance: { hpBelow: 0, answered: 3 } }] }],
    ...gate({ flag: 'g-done' }),
  };
  it('guard their instrument and keep the gate shut', () => {
    const s = make(guarded); s.y = 2 * U;
    run(s, s.time + 0.2);
    expect(s.owned).toHaveLength(0);
    expect(s.isGround(12 * U, 0)).toBe(false);
  });
  it('can be passed with three just dodges in a row, without any instrument', () => {
    const s = make(guarded); s.x = 1.2 * U;
    const ev: StageEvent[] = [];
    for (let k = 0; k < 3; k++) {
      const t = (48 + 4 + 4 * k) * STEP;       // the fight starts on the next bar line (step 48)
      ev.push(...run(s, t - 0.03));
      ev.push(...run(s, t + 0.3, { dashAt: t - 0.02, moveX: k % 2 === 0 ? -1 : 1 }));
    }
    expect(of(ev, 'encounter')).toHaveLength(1);
    expect(of(ev, 'cleared')).toHaveLength(1);
    expect(of(ev, 'hurt')).toHaveLength(0);
    expect(s.flags['g-done']).toBe(true);
    expect(s.isGround(12 * U, 0)).toBe(true);
  });
  it('can also be beaten with an instrument', () => {
    const s = make(guarded); s.god = true; s.owned = ['drum']; s.equipped = 'drum'; s.x = 0.7 * U;
    const ev = run(s, 90 * STEP);
    expect(of(ev, 'cleared')).toHaveLength(1);
    expect(of(ev, 'attack').length).toBeGreaterThanOrEqual(3);
  });
  it('repeat a phrase that was not met, counting up', () => {
    const s = make(guarded); s.god = true; s.x = 1.2 * U;
    const ph = of(run(s, 100 * STEP), 'phrase');
    expect([ph[0].repeat, ph[1].repeat, ph[0].advanced]).toEqual([1, 2, false]);
  });
  it('stop when the player is hit', () => {
    const s = make(guarded); s.x = 1.2 * U;
    run(s, 52 * STEP + 0.4);
    expect(s.lives).toBe(2);
    expect(s.encounters[0].running).toBe(false);
  });
});

describe('instruments, plates and gates', () => {
  it('no instrument, no attack', () => {
    expect(of(run(make(device('big')), 48 * STEP), 'attack')).toHaveLength(0);
  });
  it('the drum attacks on every beat, breaks a breakable device, and that can open a gate', () => {
    const s = make({ emitters: [{ id: 'pot', kind: 'device', x: 0.6, y: 0, hp: 20, body: 0.2, onBreak: 'pot', pattern: { length: 16, events: [] } }], ...gate({ flag: 'pot' }) });
    s.owned = ['drum']; s.equipped = 'drum';
    expect(of(run(s, 44 * STEP), 'broken')).toHaveLength(1);
    expect(s.isGround(12 * U, 0)).toBe(true);
  });
  it('a gate can open on the number of instruments held', () => {
    const s = make({ ...gate({ parts: 1 }), parts: [{ layer: 'bass', x: 1, y: 0 }] });
    run(s, s.time + 1.2 * BEAT, { moveX: 1 });
    expect(s.isGround(12 * U, 0)).toBe(true);
  });
  it('a plate lights after a whole bar with the right instrument, and opens what waits for it', () => {
    const s = make({ plates: [{ id: 'pd', layer: 'drum', x: 1, y: 0, flag: 'pd' }], ...gate({ flags: ['pd'] }) });
    s.x = U;
    run(s, s.time + 5 * BEAT);
    expect(s.plates[0].lit).toBe(false);
    s.owned = ['drum', 'hat']; s.equipped = 'hat';
    run(s, s.time + 5 * BEAT);
    expect(s.plates[0].lit).toBe(false);
    s.equipped = 'drum';
    run(s, s.time + 3 * BEAT);
    expect(s.plates[0].lit).toBe(false);
    expect(of(run(s, s.time + 1.5 * BEAT), 'plate')).toHaveLength(1);
    expect(s.isGround(12 * U, 0)).toBe(true);
  });
  it('a shielded boss phrase takes no damage until its plates are lit; lighting them moves the fight on', () => {
    const s = make({
      plates: [{ id: 'bp', layer: 'drum', x: 1, y: 0, encounter: 'boss' }],
      emitters: [{ id: 'b', kind: 'boss', x: 0, y: 0, hp: 100, body: 0.3 }],
      encounters: [{ id: 'boss', kind: 'boss', emitter: 'b', x: 0, y: 0, r: 4, phrases: [
        { id: 'jeon', bars: 1, events: [], shield: true, advance: { solved: true } }, { id: 'gyeol', bars: 1, events: [], advance: { hpBelow: 0 } }] }],
    });
    s.owned = ['drum']; s.equipped = 'drum'; s.x = 0.5 * U;
    run(s, 64 * STEP);
    expect([s.emitters[0].hp, s.encounters[0].index]).toEqual([100, 0]);
    s.x = U;
    const ev = run(s, 100 * STEP);
    expect(s.plates[0].lit).toBe(true);
    expect(of(ev, 'phrase').some(e => e.id === 'gyeol' && e.advanced)).toBe(true);
  });
});

describe('stage 1, as data', () => {
  const load = (): StageSim => StageSim.from(stage01 as unknown as StageData);
  it('everything stands on ground and every attack lands on a beat', () => {
    const s = load(), off: string[] = [];
    if (!s.isGround(s.x, s.y)) off.push('start');
    for (const c of s.checkpoints) if (!s.isGround(c.x, c.y)) off.push(`checkpoint ${c.x / s.u},${c.y / s.u}`);
    for (const p of s.parts) if (!s.isGround(p.x, p.y)) off.push('part ' + p.layer);
    for (const p of s.plates) if (!s.isGround(p.x, p.y)) off.push('plate ' + p.id);
    for (const e of s.emitters) if (!e.hidden && !s.isGround(e.x, e.y)) off.push('emitter ' + e.id);
    const lists = [...s.encounters.flatMap(e => e.phrases.map(p => [p.id, p.events] as const)), ...s.emitters.map(e => [e.id, e.pattern.events] as const)];
    for (const [id, evs] of lists) for (const ev of evs) if (!s.attacks[ev.attack] || !s.meter.isStrikeStep(ev.at)) off.push(`${id} ${ev.attack}@${ev.at}`);
    expect(off).toEqual([]);
  });
  it('the boss stage is cut off until the three plates are lit', () => {
    const s = load();
    expect(s.isGround(0, 5.8 * s.u)).toBe(false);
    expect(s.isGround(0, 0)).toBe(true);
    for (const f of ['plate-drum', 'plate-hat', 'plate-bass']) s.flags[f] = true;
    s.openGates();
    expect(s.isGround(0, 5.8 * s.u)).toBe(true);
  });
  it('zones are cut apart by cliff until an instrument opens the way round', () => {
    const s = load(), a = (210 * Math.PI) / 180, x = Math.cos(a) * 26.5 * s.u, y = Math.sin(a) * 26.5 * s.u;
    expect(s.isGround(x, y)).toBe(false);
    s.owned = ['drum']; s.openGates();
    expect(s.isGround(x, y)).toBe(true);
  });
  it('every instrument, every plate and the boss can be walked to', () => {
    const s = load();
    s.owned = ['drum', 'hat', 'bass'];
    for (const f of ['plate-drum', 'plate-hat', 'plate-bass']) s.flags[f] = true;
    s.openGates();
    const cell = 0.5 * s.u, key = (x: number, y: number): string => `${Math.round(x / cell)},${Math.round(y / cell)}`;
    const seen = new Set([key(s.x, s.y)]), todo = [[Math.round(s.x / cell), Math.round(s.y / cell)]];
    while (todo.length) {
      const [cx, cy] = todo.pop()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${cx + dx},${cy + dy}`;
        if (!seen.has(k) && s.isGround((cx + dx) * cell, (cy + dy) * cell)) { seen.add(k); todo.push([cx + dx, cy + dy]); }
      }
    }
    const lost = [...s.parts.map(p => [p.layer, p.x, p.y] as const), ...s.plates.map(p => [p.id, p.x, p.y] as const)].filter(([, x, y]) => !seen.has(key(x, y))).map(p => p[0]);
    expect(lost).toEqual([]);
    expect(seen.has('0,0')).toBe(true);
  });
});
