import { mulberry32 } from '../rng';
import { STEPS_PER_BAR } from '../beat';

export type LayerId = 'drum' | 'hat' | 'bass' | 'lead' | 'pad';
export type VoiceId = 'kick' | 'snare' | 'hat' | 'bass' | 'lead' | 'pad' | 'tick';
export const LAYERS: LayerId[] = ['drum', 'hat', 'bass', 'lead', 'pad'];

/** step is the position inside the loop, len is in 16th steps. */
export interface Note { step: number; len: number; midi: number; vel: number; voice: VoiceId }

export interface Song {
  seed: number;
  loopSteps: number;
  rootMidi: number;
  /** Semitone offsets of the scale from rootMidi. */
  scale: number[];
  /** One chord root per bar, as a semitone offset from rootMidi. */
  chordRoots: number[];
  layers: Record<LayerId, Note[]>;
  /** Base pulse heard before the drums are owned. */
  tick: Note[];
}

const MINOR_PENTATONIC = [0, 3, 5, 7, 10];

/** Spread `pulses` hits as evenly as possible over `steps` slots. */
export function euclid(pulses: number, steps: number, rotate = 0): boolean[] {
  const out: boolean[] = [];
  for (let i = 0; i < steps; i++) {
    const j = (((i - rotate) % steps) + steps) % steps;
    out.push(Math.floor((j * pulses) / steps) !== Math.floor(((j - 1) * pulses) / steps));
  }
  return out;
}

/** Pitch of the scale tone `index` steps above the root (index may exceed one octave). */
function scaleTone(scale: number[], index: number): number {
  const oct = Math.floor(index / scale.length);
  return scale[((index % scale.length) + scale.length) % scale.length] + 12 * oct;
}

export function generateSong(seed: number, loopBars: number): Song {
  const rnd = mulberry32(seed);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  const scale = MINOR_PENTATONIC;
  const rootMidi = 45 + Math.floor(rnd() * 8);
  const loopSteps = loopBars * STEPS_PER_BAR;
  const chordRoots: number[] = [];
  for (let b = 0; b < loopBars; b++) chordRoots.push(b === 0 ? 0 : pick([3, 5, 7, 10]));

  const drum: Note[] = [], hat: Note[] = [], bass: Note[] = [], lead: Note[] = [], pad: Note[] = [], tick: Note[] = [];
  const hat16 = euclid(3 + Math.floor(rnd() * 3), 16, Math.floor(rnd() * 16));

  let degree = scale.length; // lead starts one octave up
  for (let b = 0; b < loopBars; b++) {
    const o = b * STEPS_PER_BAR;
    // Drums: the skeleton never moves; ornaments sit off the quarter beats.
    drum.push({ step: o, len: 1, midi: 36, vel: 1, voice: 'kick' }, { step: o + 8, len: 1, midi: 36, vel: 1, voice: 'kick' });
    drum.push({ step: o + 4, len: 1, midi: 38, vel: 0.9, voice: 'snare' }, { step: o + 12, len: 1, midi: 38, vel: 0.9, voice: 'snare' });
    if (rnd() < 0.6) drum.push({ step: o + pick([7, 10, 14]), len: 1, midi: 36, vel: 0.6, voice: 'kick' });

    // Hats: every off-beat, plus some 16ths, never on a quarter beat.
    for (let i = 0; i < 16; i++) {
      if (i % 4 === 2) hat.push({ step: o + i, len: 1, midi: 90, vel: 0.8, voice: 'hat' });
      else if (i % 4 !== 0 && hat16[i]) hat.push({ step: o + i, len: 1, midi: 90, vel: 0.4, voice: 'hat' });
    }

    // Bass: long notes on the chord root, always leaving a rest of 6+ steps (the bass room needs it).
    const rootPitch = rootMidi - 12 + chordRoots[b];
    const shape = pick([[[0, 8]], [[0, 4], [6, 4]], [[0, 10]], [[0, 6]]]);
    shape.forEach(([st, len], i) => bass.push({ step: o + st, len, midi: rootPitch + (i === 1 && rnd() < 0.5 ? 12 : 0), vel: 0.9, voice: 'bass' }));

    // Lead: a note on every bar start, then a wandering line on the 8th grid.
    for (let i = 0; i < 16; i += 2) {
      if (i !== 0 && rnd() < 0.4) continue;
      degree = Math.max(scale.length - 2, Math.min(scale.length * 2 + 2, degree + pick([-2, -1, -1, 1, 1, 2])));
      if (i === 0) degree = scale.length + scale.indexOf(chordRoots[b]) + pick([0, 2]);
      lead.push({ step: o + i, len: pick([2, 2, 3, 4]), midi: rootMidi + scaleTone(scale, degree), vel: 0.8, voice: 'lead' });
    }

    // Pad: three stacked scale tones over the chord root, held for the bar.
    const ci = scale.indexOf(chordRoots[b]);
    for (const k of [0, 2, 4]) pad.push({ step: o, len: 16, midi: rootMidi + 12 + scaleTone(scale, ci + k), vel: 0.5, voice: 'pad' });

    for (let i = 0; i < 16; i += 4) tick.push({ step: o + i, len: 1, midi: 84, vel: i === 0 ? 1 : 0.6, voice: 'tick' });
  }
  return { seed, loopSteps, rootMidi, scale, chordRoots, layers: { drum, hat, bass, lead, pad }, tick };
}

/**
 * A small deterministic variation of a layer for repeated phrases.
 * Notes on quarter beats and the bass rhythm are never touched: gameplay reads them.
 */
export function vary(song: Song, layer: LayerId, n: number): Note[] {
  const src = song.layers[layer];
  if (n === 0) return src;
  const rnd = mulberry32(song.seed * 31 + n * 977 + LAYERS.indexOf(layer) * 131);
  const pcs = song.scale.map(d => (song.rootMidi + d) % 12);
  const nudge = (midi: number): number => {
    for (const d of rnd() < 0.5 ? [2, 3, -2, -3] : [-2, -3, 2, 3]) if (pcs.includes((midi + d + 120) % 12)) return midi + d;
    return midi;
  };
  let out: Note[];
  if (layer === 'drum') {
    out = src.slice();
    const st = Math.floor(rnd() * (song.loopSteps / 2)) * 2 + 1;
    out.push({ step: st, len: 1, midi: 36, vel: 0.5, voice: 'kick' });
  } else if (layer === 'hat') {
    out = src.filter(nt => nt.step % 4 === 2 || rnd() > 0.35);
    const st = Math.floor(rnd() * (song.loopSteps / 4)) * 4 + (rnd() < 0.5 ? 1 : 3);
    if (!out.some(nt => nt.step === st)) out.push({ step: st, len: 1, midi: 90, vel: 0.5, voice: 'hat' });
    if (out.length === src.length && out.every((nt, i) => nt === src[i])) out = out.slice(0, -1);
  } else if (layer === 'bass') {
    out = src.map(nt => (rnd() < 0.3 ? { ...nt, midi: nt.midi + 12 } : nt));
  } else if (layer === 'lead') {
    out = src.map(nt => (nt.step % 16 !== 0 && rnd() < 0.4 ? { ...nt, midi: nudge(nt.midi) } : nt));
  } else {
    out = src;
  }
  return out.slice().sort((a, b) => a.step - b.step);
}

export function notesAt(notes: Note[], loopSteps: number, absStep: number): Note[] {
  const st = ((absStep % loopSteps) + loopSteps) % loopSteps;
  return notes.filter(n => n.step === st);
}
