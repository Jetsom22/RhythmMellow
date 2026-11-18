import { bassSounding } from '../core/game/gimmicks';
import { generateSong, Song } from '../core/music/song';
import { contains, Shape } from '../core/stage/shapes';
import { AttackDef, Inst, Instrument, PatternEvent, Phrase, StageData, StageSim } from '../core/stage/sim';

/**
 * The workbench reads the same stage data and the same rules as the game (src/core/stage),
 * and adds what a level designer needs: where each attack reaches, what plays at a given step,
 * and a grid of the field to walk on.
 */

export type Kind = 'circle' | 'ring' | 'beam' | 'zone';
export const KINDS: Kind[] = ['circle', 'ring', 'beam', 'zone'];
export const KIND_NAME: Record<Kind, string> = { circle: '원', ring: '고리', beam: '빔', zone: '장판' };
export const KIND_BIT: Record<Kind, number> = { circle: 1, ring: 2, beam: 4, zone: 8 };
export const LAYER_NAME: Record<Instrument, string> = { drum: '드럼', hat: '하이햇', bass: '베이스' };
const INSTRUMENTS: Instrument[] = ['drum', 'hat', 'bass'];

type EmitterData = NonNullable<StageData['emitters']>[number];
type EncounterData = NonNullable<StageData['encounters']>[number];

export interface Model {
  data: StageData;
  sim: StageSim;
  /** px per U */
  u: number;
  song: Song;
  /** the instrument area a point is in, by the ground sector that holds the area's instrument */
  areaOf(x: number, y: number): Instrument | null;
  /** a readable name for an emitter */
  label(id: string): string;
}

export function loadModel(data: StageData): Model {
  const sim = StageSim.from(data);
  const u = sim.u;
  const song = generateSong(data.seed ?? 7, 2);
  // An instrument area is a ground sector that holds that instrument's part.
  const sectors: { layer: Instrument; shape: Shape }[] = [];
  for (const g of sim.field.ground) {
    if (g.kind !== 'sector') continue;
    const part = sim.parts.find(p => contains(g, p.x, p.y));
    if (part) sectors.push({ layer: part.layer, shape: g });
  }
  const areaOf = (x: number, y: number): Instrument | null => sectors.find(s => contains(s.shape, x, y))?.layer ?? null;
  const label = (id: string): string => {
    const e = sim.emitters.find(q => q.id === id);
    if (!e) return id;
    const what = { device: '장치', monster: '음표 몬스터', guardian: '수호자', boss: '보스' }[e.kind];
    const area = areaOf(e.x, e.y);
    return `${area ? `${LAYER_NAME[area]} 구역` : '가운데 필드'} ${what} (${id})`;
  };
  return { data, sim, u, song, areaOf, label };
}

export const emitterData = (m: Model, id: string): EmitterData | undefined => m.data.emitters?.find(e => e.id === id);
export const encounterOf = (m: Model, emitterId: string): EncounterData | undefined => m.data.encounters?.find(e => e.emitter === emitterId);

/** Attack kinds an emitter uses (an encounter's phrases for guardians and the boss). */
export function kindsOf(m: Model, id: string): Set<Kind> {
  const e = emitterData(m, id), out = new Set<Kind>();
  if (!e) return out;
  const add = (ev: { attack: string }): void => { const d = m.sim.attacks[ev.attack]; if (d) out.add(d.shape.kind); };
  if (e.follow) add(e.follow);
  for (const ev of e.pattern?.events ?? []) add(ev);
  for (const ph of encounterOf(m, id)?.phrases ?? []) for (const ev of ph.events) add(ev);
  return out;
}

export const isRoad = (kind: string): boolean => kind === 'device' || kind === 'monster';

/* ---------------- what plays at step S ---------------- */

export interface Live {
  emitter: string;
  def: AttackDef;
  inst: Inst;
  phase: 'tele' | 'hit' | 'hold' | 'after';
  /** 0..1, grows one 16th step at a time while the range is shown before the hit */
  grow: number;
}

/** Attacks aimed at the player are drawn this far from their source: the workbench has no player. */
export const STAND_IN_U = 1.25;

function instFor(m: Model, src: { id: string; kind: string; x: number; y: number; rot: number }, ev: PatternEvent, hitStep: number): Inst | null {
  const def = m.sim.attacks[ev.attack];
  if (!def) return null;
  const anchor = ev.anchor ?? def.anchor ?? 'self';
  let x = src.x, y = src.y;
  if (anchor === 'target') { x += STAND_IN_U * m.u; }
  else if (anchor === 'fixed') { x += (ev.x ?? 0) * m.u; y += (ev.y ?? 0) * m.u; }
  return {
    def, id: ev.attack, x, y, rot: ((ev.rot ?? 0) * Math.PI) / 180, start: hitStep - def.tele, hitStep, hold: def.hold ?? 0,
    layer: def.layer ?? 'lead', src: src.id, srcKind: src.kind, sx: src.x, sy: src.y,
  };
}

function phaseAt(t: number, hit: number, tele: number, hold: number): { phase: Live['phase']; grow: number } | null {
  const start = hit - tele;
  if (t >= start && t < hit) return { phase: 'tele', grow: (Math.floor(t - start) + 1) / tele };
  if (t >= hit && t < hit + 1) return { phase: 'hit', grow: 1 };
  if (hold && t >= hit + 1 && t < hit + hold + 1) return { phase: (Math.floor(t) - hit) % 4 === 0 ? 'hit' : 'hold', grow: 1 };
  if (t >= hit + hold + 1 && t < hit + hold + 3) return { phase: 'after', grow: 1 };
  return null;
}

/** Which phrase of an encounter plays at step S, when its phrases play one after another. */
export function phraseAt(m: Model, enc: EncounterData, S: number): { phrase: Phrase; local: number; length: number } {
  const bar = m.sim.meter.stepsPerBar, total = enc.phrases.reduce((n, p) => n + p.bars * bar, 0);
  let t = ((S % total) + total) % total;
  for (const p of enc.phrases) { if (t < p.bars * bar) return { phrase: p, local: t, length: p.bars * bar }; t -= p.bars * bar; }
  return { phrase: enc.phrases[0], local: 0, length: enc.phrases[0].bars * bar };
}

export function liveAt(m: Model, S: number): Live[] {
  const out: Live[] = [], spb = m.sim.meter.stepsPerBeat;
  const push = (src: { id: string; kind: string; x: number; y: number; rot: number }, ev: PatternEvent, hit: number, t: number): void => {
    const def = m.sim.attacks[ev.attack];
    if (!def) return;
    const p = phaseAt(t, hit, def.tele, def.hold ?? 0);
    if (!p) return;
    const inst = instFor(m, src, ev, hit);
    if (inst) out.push({ emitter: src.id, def, inst, ...p });
  };
  for (const em of m.sim.emitters) {
    if (em.kind === 'guardian' || em.kind === 'boss') {
      const enc = encounterOf(m, em.id);
      if (!enc) continue;
      const { phrase, local, length } = phraseAt(m, enc, S);
      for (const ev of phrase.events) for (const k of [0, length]) push(em, ev, ev.at, local + k);
      continue;
    }
    if (em.follow) {
      // strikes on each beat the followed layer sounds
      const def = m.sim.attacks[em.follow.attack];
      if (!def) continue;
      const tele = def.tele, last = def.hold ?? 0;
      for (let hit = Math.ceil((S - last - 3) / spb) * spb; hit <= S + tele; hit += spb) {
        if (em.follow.layer === 'bass' && bassSounding(m.song, hit)) push({ ...em, rot: em.rot }, { at: 0, attack: em.follow.attack, rot: em.rot }, hit, S);
      }
      continue;
    }
    const pat = em.pattern, total = pat.length + (pat.rest ?? 0);
    const local = (((S - (pat.phase ?? 0)) % total) + total) % total;
    for (const ev of pat.events) for (const k of [0, total]) push(em, ev, ev.at, local + k);
  }
  return out;
}

/* ---------------- the field as a grid ---------------- */

export interface Grid {
  /** cell size in px */
  cell: number;
  /** half width of the square the grid covers, in px */
  R: number;
  n: number;
  x(i: number): number;
  y(j: number): number;
  index(x: number, y: number): number;
}

export function makeGrid(m: Model, cellU: number, halfU = 32): Grid {
  const cell = cellU * m.u, R = halfU * m.u, n = Math.ceil((2 * R) / cell);
  return {
    cell, R, n,
    x: i => -R + (i + 0.5) * cell,
    y: j => -R + (j + 0.5) * cell,
    index: (x, y) => { const i = Math.floor((x + R) / cell), j = Math.floor((y + R) / cell); return i < 0 || j < 0 || i >= n || j >= n ? -1 : j * n + i; },
  };
}

/** Open the gates a player holding these parts would find open (plates light up once their instrument is held). */
export function setGates(m: Model, parts: Instrument[]): void {
  for (const g of m.sim.gates) {
    const r = g.requires;
    let ok = true;
    if (r.parts !== undefined && parts.length < r.parts) ok = false;
    if (r.layer !== undefined && !parts.includes(r.layer)) ok = false;
    const lit = (f: string): boolean => INSTRUMENTS.some(i => parts.includes(i) && f === `plate-${i}`);
    if (r.flag !== undefined && !lit(r.flag)) ok = false;
    for (const f of r.flags ?? []) if (!lit(f)) ok = false;
    g.open = ok;
  }
  m.sim.field.setWays(m.sim.gates.filter(g => g.open).map(g => g.shape));
}

/** Walkable cells for a set of parts. */
export function walkable(m: Model, g: Grid, parts: Instrument[]): Uint8Array {
  setGates(m, parts);
  const out = new Uint8Array(g.n * g.n);
  for (let j = 0; j < g.n; j++) for (let i = 0; i < g.n; i++) out[j * g.n + i] = m.sim.isGround(g.x(i), g.y(j)) ? 1 : 0;
  return out;
}

/** Grid offsets a dash can reach: anything within the dash length. */
export function dashOffsets(m: Model, g: Grid): [number, number][] {
  const r = (m.sim.dashU * m.u) / g.cell, out: [number, number][] = [];
  for (let dj = -Math.ceil(r); dj <= Math.ceil(r); dj++) for (let di = -Math.ceil(r); di <= Math.ceil(r); di++) {
    if ((di || dj) && Math.hypot(di, dj) <= r) out.push([di, dj]);
  }
  return out;
}

/**
 * Which attack kinds can reach each cell, from the road (devices and monsters) and from encounters.
 * A monster's attack lands where the player stands, anywhere within its range; an encounter covers its circle.
 */
export function coverage(m: Model, g: Grid): { road: Uint8Array; enc: Uint8Array; byEmitter: Map<string, number[]> } {
  const road = new Uint8Array(g.n * g.n), enc = new Uint8Array(g.n * g.n), byEmitter = new Map<string, number[]>();
  const mark = (id: string, arr: Uint8Array, bit: number, test: (x: number, y: number) => boolean): void => {
    const cells = byEmitter.get(id) ?? [];
    for (let j = 0; j < g.n; j++) for (let i = 0; i < g.n; i++) {
      if (!test(g.x(i), g.y(j))) continue;
      const k = j * g.n + i;
      arr[k] |= bit;
      cells.push(k);
    }
    byEmitter.set(id, cells);
  };
  for (const em of m.sim.emitters) {
    if (em.kind === 'guardian' || em.kind === 'boss') {
      const e = encounterOf(m, em.id);
      if (!e) continue;
      let bits = 0;
      for (const k of kindsOf(m, em.id)) bits |= KIND_BIT[k];
      const ex = e.x * m.u, ey = e.y * m.u, r = e.r * m.u;
      mark(em.id, enc, bits, (x, y) => Math.hypot(x - ex, y - ey) <= r);
      continue;
    }
    const events: PatternEvent[] = em.follow ? [{ at: 0, attack: em.follow.attack, rot: em.rot }] : em.pattern.events;
    for (const ev of events) {
      const inst = instFor(m, em, ev, 0);
      if (!inst) continue;
      const bit = KIND_BIT[inst.def.shape.kind];
      const anchor = ev.anchor ?? inst.def.anchor ?? 'self';
      if (anchor === 'target') {
        const reach = (em.range ?? 6) * m.u + ('r' in inst.def.shape ? inst.def.shape.r : 0);
        mark(em.id, road, bit, (x, y) => Math.hypot(x - em.x, y - em.y) <= reach);
      } else mark(em.id, road, bit, (x, y) => m.sim.hits(inst, x, y));
    }
  }
  return { road, enc, byEmitter };
}

export const bitsToKinds = (b: number): Kind[] => KINDS.filter(k => b & KIND_BIT[k]);
