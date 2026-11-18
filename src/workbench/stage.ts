/**
 * Stage data as written in data/stages/*.json, and the same data resolved to world pixels.
 * Map positions and map lengths are in U (one beat of walking); attack sizes are in px,
 * exactly as in the validation build. Angles are degrees, y points down.
 */

export type Instrument = 'drum' | 'hat' | 'bass';
export const INSTRUMENTS: Instrument[] = ['drum', 'hat', 'bass'];

export type At = { r: number; deg: number } | { x: number; y: number };

export type GroundShape =
  | { type: 'circle'; at: At; radius: number; id?: string }
  | { type: 'ring'; at: At; inner: number; outer: number; id?: string }
  | { type: 'path'; points: At[]; width: number; id?: string };

export type AreaShape =
  | { type: 'circle'; at: At; radius: number }
  | { type: 'sector'; inner: number; outer: number; from: number; to: number };

export type AttackShape =
  | { type: 'circle'; radius: number }
  | { type: 'ring'; inner: number; outer: number }
  | { type: 'beam'; width: number; angles: number[]; length?: number }
  | { type: 'zone'; w: number; h: number; holdSteps: number };

export type AttackKind = AttackShape['type'];
export const KIND_NAME: Record<AttackKind, string> = { circle: '원', ring: '고리', beam: '빔', zone: '장판' };

export interface Hit {
  step: number;
  telegraph: number;
  /** self = the emitter, player = where the player stands when the telegraph starts, pad:N = pad N of the pattern */
  anchor: string;
  layer: string;
  shape: AttackShape;
  offset?: { x: number; y: number };
}

export interface PatternDef {
  name?: string;
  section?: string;
  texture?: string;
  bars?: number;
  openBars?: number[];
  weakTo?: Instrument | null;
  pads?: { instrument: Instrument; x: number; y: number; radius: number }[];
  hits?: Hit[];
  /** A part of another pattern, unchanged in size and beat. */
  from?: string;
  pick?: number[];
  anchor?: string;
  shift?: number;
  loopBars?: number;
  beamLength?: number;
}

export interface Route { from: string; to: string; twoWay?: boolean; name?: string; requires?: { parts?: Instrument[]; padsLit?: number } }

export interface EmitterDef {
  id: string;
  kind: 'device' | 'monster' | 'guardian' | 'boss';
  name: string;
  pattern?: string;
  patterns?: string[];
  area: string;
  at: At;
  startStep?: number;
  move?: string;
  pass?: string[];
}

export interface StageData {
  format: string;
  id: string;
  title: string;
  chapter: string;
  palette: string;
  bpm: number;
  meter: { stepsPerBeat: number; beatsPerBar: number; strikeSteps: number[]; dodgeSteps: number[] };
  songSeed: number;
  lives: number;
  units: { map: 'U'; attack: 'px'; uPx: number; angle: 'deg' };
  field: { ground: GroundShape[]; holes: GroundShape[]; bridges: (GroundShape & { id: string; name: string; opensWhen: { padsLit: number } })[] };
  areas: { id: string; name: string; zone?: Instrument; role?: string; shape: AreaShape }[];
  routes: Route[];
  patterns: Record<string, PatternDef>;
  emitters: EmitterDef[];
  parts: { instrument: Instrument; area: string; guard: string; at: At }[];
  pads: { instrument: Instrument; area: string; at: At }[];
  checkpoints: { id: string; area: string; at: At }[];
  start: { area: string; at: At };
}

/* ------------------------------------------------------------------ */

export interface Pt { x: number; y: number }

/** A pattern flattened to the hits it plays, with its loop length in steps. */
export interface ResolvedPattern {
  id: string;
  name: string;
  loopSteps: number;
  hits: Hit[];
  pads: { instrument: Instrument; x: number; y: number; radius: number }[];
  /** The boss pattern this one was taken from, if any. */
  source: string | null;
  beamLength: number | null;
}

export interface Stage {
  data: StageData;
  /** px per U */
  u: number;
  stepsPerBar: number;
  pos(at: At): Pt;
  patterns: Record<string, ResolvedPattern>;
}

export function polar(at: At): { x: number; y: number } {
  if ('x' in at) return { x: at.x, y: at.y };
  const a = (at.deg * Math.PI) / 180;
  return { x: at.r * Math.cos(a), y: at.r * Math.sin(a) };
}

export function resolvePattern(id: string, all: Record<string, PatternDef>, stepsPerBar: number): ResolvedPattern {
  const p = all[id];
  if (!p) throw new Error(`패턴 "${id}" 가 없다`);
  if (!p.from) {
    return {
      id, name: p.name ?? id, loopSteps: (p.bars ?? 1) * stepsPerBar, hits: p.hits ?? [], pads: p.pads ?? [],
      source: null, beamLength: p.beamLength ?? null,
    };
  }
  const base = resolvePattern(p.from, all, stepsPerBar);
  const picked = (p.pick ?? base.hits.map((_, i) => i)).map(i => {
    const h = base.hits[i];
    if (!h) throw new Error(`패턴 "${id}": "${p.from}" 에 ${i}번 공격이 없다`);
    return { ...h, step: h.step + (p.shift ?? 0), anchor: p.anchor ?? h.anchor };
  });
  return {
    id, name: p.name ?? id, loopSteps: (p.loopBars ?? base.loopSteps / stepsPerBar) * stepsPerBar, hits: picked,
    pads: base.pads, source: base.source ?? p.from, beamLength: p.beamLength ?? base.beamLength,
  };
}

export function loadStage(json: string | StageData): Stage {
  const data: StageData = typeof json === 'string' ? JSON.parse(json) : json;
  if (data.format !== 'rhythmmellow-stage/1') throw new Error(`모르는 형식: ${data.format}`);
  const u = data.units.uPx;
  const stepsPerBar = data.meter.stepsPerBeat * data.meter.beatsPerBar;
  const patterns: Record<string, ResolvedPattern> = {};
  for (const id of Object.keys(data.patterns)) patterns[id] = resolvePattern(id, data.patterns, stepsPerBar);
  return {
    data, u, stepsPerBar, patterns,
    pos: at => { const p = polar(at); return { x: p.x * u, y: p.y * u }; },
  };
}

export function emitterPatterns(st: Stage, e: EmitterDef): ResolvedPattern[] {
  const ids = e.patterns ?? (e.pattern ? [e.pattern] : []);
  return ids.map(id => {
    const p = st.patterns[id];
    if (!p) throw new Error(`${e.id}: 패턴 "${id}" 가 없다`);
    return p;
  });
}
