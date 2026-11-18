import { AttackShape, EmitterDef, Hit, Pt, ResolvedPattern, Stage, emitterPatterns } from './stage';

/** Where an attack shows on the map at one moment. */
export interface Live {
  emitter: string;
  layer: string;
  shape: AttackShape;
  /** centre of the shape in world px */
  at: Pt;
  /** tele: the range is shown before the hit; hit: the beat it is judged; hold: a zone that stays and is judged on each beat; after: just faded */
  phase: 'tele' | 'hit' | 'hold' | 'after';
  /** 0..1 how far the telegraph has grown (16th-step stairs) */
  grow: number;
  beamLength: number | null;
}

/** Players are not simulated here: attacks aimed at the player are drawn this far from their emitter. */
export const PLAYER_STANDIN: Pt = { x: 150, y: 0 };

function anchorPoint(e: Pt, h: Hit, pat: ResolvedPattern): Pt {
  let p = e;
  if (h.anchor === 'player') p = { x: e.x + PLAYER_STANDIN.x, y: e.y + PLAYER_STANDIN.y };
  else if (h.anchor.startsWith('pad:')) { const pad = pat.pads[Number(h.anchor.slice(4))]; p = { x: e.x + pad.x, y: e.y + pad.y }; }
  return h.offset ? { x: p.x + h.offset.x, y: p.y + h.offset.y } : p;
}

/** Which pattern of the emitter is playing at step S (a boss plays its patterns one after another). */
export function playingAt(st: Stage, e: EmitterDef, S: number): { pat: ResolvedPattern; local: number } {
  const pats = emitterPatterns(st, e);
  const s = S - (e.startStep ?? 0);
  const total = pats.reduce((n, p) => n + p.loopSteps, 0);
  let t = ((s % total) + total) % total;
  for (const p of pats) { if (t < p.loopSteps) return { pat: p, local: t }; t -= p.loopSteps; }
  return { pat: pats[0], local: 0 };
}

export function liveAt(st: Stage, e: EmitterDef, S: number): Live[] {
  const { pat, local } = playingAt(st, e, S);
  const at = st.pos(e.at), out: Live[] = [];
  const L = pat.loopSteps;
  for (const h of pat.hits) {
    // look one loop back as well, so telegraphs and holds that cross the loop line still show
    for (const k of [0, L]) {
      const t = local + k;
      const start = h.step - h.telegraph, hold = h.shape.type === 'zone' ? h.shape.holdSteps : 0;
      let phase: Live['phase'] | null = null, grow = 1;
      if (t >= start && t < h.step) { phase = 'tele'; grow = (Math.floor(t - start) + 1) / h.telegraph; }
      else if (t >= h.step && t < h.step + 1) phase = 'hit';
      else if (hold && t >= h.step + 1 && t < h.step + hold + 1) phase = (Math.floor(t) - h.step) % 4 === 0 ? 'hit' : 'hold';
      else if (t >= h.step + hold + 1 && t < h.step + hold + 3) phase = 'after';
      if (phase) out.push({ emitter: e.id, layer: h.layer, shape: h.shape, at: anchorPoint(at, h, pat), phase, grow, beamLength: pat.beamLength });
    }
  }
  return out;
}

/** Every step at which this pattern judges a hit (zones are judged on each beat they stay). */
export function judgedSteps(pat: ResolvedPattern): number[] {
  const out: number[] = [];
  for (const h of pat.hits) {
    out.push(h.step);
    if (h.shape.type === 'zone') for (let s = h.step + 4; s <= h.step + h.shape.holdSteps; s += 4) out.push(s);
  }
  return out;
}
