import { mulberry32 } from '../rng';
import { euclid } from './song';

/**
 * A stage's music as data.
 *
 * The notes still come from the seed. What a score adds is the arrangement: for each state of
 * the game (a "scene": intro, a boss phase, a build-up, a drop) it says which part every layer
 * plays, on which instrument, with which mix. Parts are rules that turn the seed into notes;
 * instruments are synth settings plus a mixing strip. It is plain JSON, so the studio can edit
 * it and the game can read it.
 */

export type Layer = 'drum' | 'hat' | 'bass' | 'lead' | 'pad';
export const SCORE_LAYERS: Layer[] = ['drum', 'hat', 'bass', 'lead', 'pad'];

/** step and len are in steps from the start of the scene. `voice` picks the instrument of a drum layer. */
export interface ScoreNote { step: number; len: number; midi: number; vel: number; voice: string; acc?: boolean; slide?: boolean }

export type EqType = 'hp' | 'lp' | 'peak' | 'loshelf' | 'hishelf';
export interface EqBand { type: EqType; hz: number; q: number; gain: number }
/** A mixing strip: level, tone, a share of the common room, and how far the kick pushes it down. */
export interface Strip { gain_db: number; eq: EqBand[]; room: number; duck: number; duck_release: number }
export type SynthKind = 'tone' | 'kick' | 'snare' | 'hat';
export interface Instrument { synth: SynthKind; p: Record<string, number>; mix: Strip }
/** `roll` draws the part again from the seed without touching any other part. */
export interface Part { rule: string; p: Record<string, number>; roll: number; notes?: number[][]; bars?: number }
/** `inst` is one instrument name, or for drums one per voice: { kick, snare }. */
export interface Track { part: string; inst: string | Record<string, string>; gain_db?: number }
export interface Scene {
  bars: number;
  /** Filters on the whole scene. With lp_to / hp_to they move from one value to the other over the scene. */
  lp?: number; hp?: number; lp_to?: number; hp_to?: number;
  /** Played once, then `next` takes over (a build-up). Without it the scene loops. */
  once?: boolean; next?: string;
  tracks: Partial<Record<Layer, Track>>;
}
export interface Meter { stepsPerBeat: number; beatsPerBar: number; kick: number[]; snare: number[] }
export interface Key { scale: string; root: number; bars: number; chords: number[] }
export interface Score {
  id: string; bpm: number; seed: number; meter: Meter; key: Key;
  instruments: Record<string, Instrument>;
  parts: Record<string, Part>;
  scenes: Record<string, Scene>;
  /** Which scene each state of the game plays. */
  states: Record<string, string>;
}

export const SCALES: Record<string, number[]> = {
  minor_pentatonic: [0, 3, 5, 7, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  major_pentatonic: [0, 2, 4, 7, 9],
};

/** One adjustable value: what a slider in the studio is built from. */
export interface ParamSpec { key: string; lo: number; hi: number; def: number; scale: 'lin' | 'log' | 'int'; label: string }
const P = (key: string, lo: number, hi: number, def: number, scale: 'lin' | 'log' | 'int', label: string): ParamSpec => ({ key, lo, hi, def, scale, label });

export const SYNTH_PARAMS: Record<SynthKind, ParamSpec[]> = {
  tone: [
    P('oct', -24, 24, 0, 'int', '옮김 (반음)'),
    P('sub', 0, 1, 0, 'lin', '서브 (한 옥타브 아래 사인, 필터 안 거침)'),
    P('sine', 0, 1, 0, 'lin', '사인'),
    P('saw', 0, 1, 0, 'lin', '톱니'),
    P('pulse', 0, 1, 0, 'lin', '펄스'),
    P('pw', 0.05, 0.5, 0.5, 'lin', '펄스 폭'),
    P('tri', 0, 1, 0, 'lin', '삼각'),
    P('detune', 0, 40, 0, 'lin', '디튠 (센트)'),
    P('fm', 0, 8, 0, 'lin', 'FM 세기'),
    P('fm_ratio', 0.5, 8, 2, 'lin', 'FM 비율'),
    P('fm_decay', 0.5, 40, 8, 'log', 'FM 감쇠 (1/초)'),
    P('fm_hold', 0, 1, 0.1, 'lin', 'FM 남는 양'),
    P('cutoff', 40, 18000, 18000, 'log', '필터 컷오프 (Hz)'),
    P('env', 0, 8000, 0, 'lin', '필터 열림 (Hz)'),
    P('env_decay', 0.5, 40, 8, 'log', '필터 닫힘 (1/초)'),
    P('reso', 0, 1, 0.2, 'lin', '레조넌스'),
    P('track', 0, 8, 0, 'lin', '음높이 따라가기'),
    P('drive', 0, 1, 0, 'lin', '드라이브'),
    P('attack', 0.001, 1, 0.006, 'log', '어택 (초)'),
    P('decay', 0.02, 3, 0.3, 'log', '디케이 (초)'),
    P('sustain', 0, 1, 1, 'lin', '서스테인'),
    P('release', 0.01, 2, 0.08, 'log', '릴리스 (초)'),
    P('gate', 0.05, 1, 1, 'lin', '음 길이 비율'),
    P('accent', 0, 1, 0.5, 'lin', '악센트 세기'),
    P('glide', 0.005, 0.3, 0.05, 'log', '슬라이드 시간 (초)'),
    P('vib', 0, 30, 0, 'lin', '비브라토 (센트)'),
    P('vib_rate', 1, 9, 5.2, 'lin', '비브라토 빠르기 (Hz)'),
    P('echo', 0, 0.8, 0, 'lin', '에코 양'),
    P('echo_steps', 1, 8, 3, 'int', '에코 간격 (스텝)'),
    P('echo_fb', 0, 0.7, 0.34, 'lin', '에코 되먹임'),
  ],
  kick: [
    P('f_start', 60, 400, 150, 'log', '시작 음높이 (Hz)'),
    P('f_end', 30, 90, 45, 'log', '끝 음높이 (Hz)'),
    P('sweep', 0.01, 0.3, 0.12, 'log', '내려가는 시간 (초)'),
    P('decay', 0.05, 0.6, 0.2, 'log', '길이 (초)'),
    P('click', 0, 1, 0, 'lin', '클릭'),
    P('drive', 0, 1, 0, 'lin', '드라이브'),
  ],
  snare: [
    P('tone', 120, 320, 180, 'log', '몸통 음높이 (Hz)'),
    P('tone_level', 0, 1, 0.5, 'lin', '몸통 양'),
    P('tone_decay', 0.02, 0.3, 0.07, 'log', '몸통 길이 (초)'),
    P('noise_level', 0, 1.5, 0.8, 'lin', '노이즈 양'),
    P('noise_decay', 0.03, 0.5, 0.11, 'log', '노이즈 길이 (초)'),
    P('noise_lp', 2000, 16000, 9000, 'log', '노이즈 위쪽 한계 (Hz)'),
    P('noise_hp', 200, 4000, 900, 'log', '노이즈 아래쪽 한계 (Hz)'),
  ],
  hat: [
    P('decay', 0.01, 0.4, 0.035, 'log', '길이 (초)'),
    P('hp', 3000, 12000, 7000, 'log', '아래쪽 한계 (Hz)'),
  ],
};

export const RULE_PARAMS: Record<string, ParamSpec[]> = {
  rest: [],
  // Kick and snare sit where the meter says, always. Only the ornament is the rule's to place.
  drum: [P('kick', 0, 1, 1, 'lin', '킥 세기'), P('snare', 0, 1, 1, 'lin', '스네어 세기'), P('ghost', 0, 1, 0.6, 'lin', '꾸밈 킥이 나올 확률')],
  hat: [P('offbeat', 0, 1, 1, 'int', '엇박'), P('pulses', 0, 12, 4, 'int', '16분 음 수'), P('quarters', 0, 1, 0, 'int', '정박에도')],
  bass_hold: [],
  bass_pulse: [
    P('div', 1, 4, 2, 'int', '음 간격 (스텝)'), P('density', 0, 1, 0.8, 'lin', '음이 나올 확률'), P('octave', 0, 1, 0.25, 'lin', '옥타브 위로 뛸 확률'),
    P('move', 0, 1, 0.15, 'lin', '다른 음으로 갈 확률'), P('accent', 0, 1, 0.3, 'lin', '악센트 확률'), P('slide', 0, 1, 0, 'lin', '슬라이드 확률'), P('skip_kick', 0, 1, 0, 'int', '킥 자리 비우기'),
  ],
  lead_wander: [P('rest', 0, 0.9, 0.4, 'lin', '쉴 확률'), P('span', 1, 4, 2, 'int', '음형 길이 (마디)')],
  arp: [P('div', 1, 4, 2, 'int', '음 간격 (스텝)'), P('density', 0, 1, 1, 'lin', '음이 나올 확률'), P('octaves', 1, 3, 2, 'int', '옥타브 폭'), P('shape', 0, 3, 0, 'int', '모양 (0 위로, 1 아래로, 2 오르내림, 3 무작위)')],
  pad_chord: [P('voices', 1, 4, 3, 'int', '쌓는 음 수'), P('stab', 0, 1, 0, 'int', '엇박에 짧게')],
  rise: [],
  written: [],
};

export const RULE_NOTES: Record<string, string> = {
  rest: '아무것도 연주하지 않는다.',
  drum: '킥과 스네어는 박자표의 자리에 고정이다. 꾸밈 킥만 규칙이 놓는다.',
  hat: '엇박과 16분 음 일부.',
  bass_hold: '화음 뿌리음을 길게 끌고 쉰다.',
  bass_pulse: '짧은 음으로 된 한 마디 음형을 화음마다 되풀이한다. 애시드 베이스에 맞는다.',
  lead_wander: '8분 격자를 오르내리는 선율. 음형이 몇 마디마다 돌아온다.',
  arp: '화음을 한 음씩 펼친다.',
  pad_chord: '화음을 마디 내내 누르거나, 엇박에 짧게 친다.',
  rise: '장면 전체에 걸쳐 음이 점점 빨라지고 높아진다.',
  written: '손으로 적은 음. 지금은 파일에서만 고칠 수 있다.',
};

export function filled(specs: ParamSpec[], given: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of specs) out[s.key] = s.def;
  for (const k in given ?? {}) out[k] = Number(given![k]);
  return out;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Every part draws from its own stream, so changing one part never reshuffles another. */
function stream(score: Score, salt: string, roll: number): () => number {
  return mulberry32((Math.imul(score.seed + 1, 0x9e3779b1) ^ hash(salt) ^ Math.imul(roll + 1, 0x85ebca6b)) >>> 0);
}

export const stepsPerBar = (s: Score): number => s.meter.stepsPerBeat * s.meter.beatsPerBar;
export const secPerStepOf = (s: Score): number => 60 / s.bpm / s.meter.stepsPerBeat;
export const sceneSteps = (s: Score, scene: string): number => Math.max(1, Math.floor(s.scenes[scene].bars)) * stepsPerBar(s);

/** Key and chords: from the seed unless the score pins them (key.root >= 0, key.chords not empty). */
export function harmony(score: Score): { root: number; scale: number[]; chords: number[] } {
  const scale = SCALES[score.key.scale] ?? SCALES.minor_pentatonic;
  const rnd = stream(score, 'harmony', 0);
  let root = 45 + Math.floor(rnd() * 8);
  let chords = [0];
  for (let b = 1; b < Math.max(1, score.key.bars); b++) chords.push(1 + Math.floor(rnd() * (scale.length - 1)));
  if (score.key.root >= 0) root = score.key.root;
  if (score.key.chords && score.key.chords.length > 0) chords = score.key.chords;
  return { root, scale, chords };
}

function tone(scale: number[], index: number): number {
  const n = scale.length;
  return scale[((index % n) + n) % n] + 12 * Math.floor(index / n);
}

/** The notes one layer plays in one scene. */
export function notesOf(score: Score, sceneId: string, layer: Layer): ScoreNote[] {
  const scene = score.scenes[sceneId];
  const track = scene?.tracks[layer];
  const part = track ? score.parts[track.part] : undefined;
  if (!scene || !track || !part) return [];
  const p = filled(RULE_PARAMS[part.rule] ?? [], part.p);
  const { root, scale, chords } = harmony(score);
  const rnd = stream(score, track.part, part.roll ?? 0);
  const bars = Math.max(1, Math.floor(scene.bars));
  const bar = stepsPerBar(score);
  const beat = score.meter.stepsPerBeat;
  const size = scale.length;
  const chord = (b: number): number => chords[b % chords.length];
  const out: ScoreNote[] = [];
  const note = (step: number, len: number, midi: number, vel: number, voice = 'note'): ScoreNote => ({ step, len, midi, vel, voice });

  switch (part.rule) {
    case 'drum': {
      const taken = new Set([...score.meter.kick, ...score.meter.snare]);
      const spots = [7, 10, 14].map(s => Math.floor((bar * s) / 16)).filter(s => !taken.has(s));
      for (let b = 0; b < bars; b++) {
        const o = b * bar;
        if (p.kick > 0) for (const s of score.meter.kick) out.push(note(o + s, 1, 36, p.kick, 'kick'));
        if (p.snare > 0) for (const s of score.meter.snare) out.push(note(o + s, 1, 38, 0.9 * p.snare, 'snare'));
        const chance = rnd(), where = rnd();
        if (chance < p.ghost && p.kick > 0 && spots.length > 0) out.push(note(o + spots[Math.floor(where * spots.length)], 1, 36, 0.6 * p.kick, 'kick'));
      }
      break;
    }
    case 'hat': {
      const spread = euclid(Math.floor(p.pulses), bar, Math.floor(rnd() * bar));
      for (let b = 0; b < bars; b++) for (let i = 0; i < bar; i++) {
        const pos = i % beat;
        if (pos === 0) { if (p.quarters > 0) out.push(note(b * bar + i, 1, 90, 0.55, 'hat')); }
        else if (pos * 2 === beat) { if (p.offbeat > 0) out.push(note(b * bar + i, 1, 90, 0.8, 'hat')); }
        else if (spread[i]) out.push(note(b * bar + i, 1, 90, 0.4, 'hat'));
      }
      break;
    }
    case 'bass_hold': {
      const k = bar / 16;
      const shapes = [[[0, 8]], [[0, 4], [6, 4]], [[0, 10]], [[0, 6]]];
      for (let b = 0; b < bars; b++) {
        const pitch = root - 12 + tone(scale, chord(b));
        const shape = shapes[Math.floor(rnd() * shapes.length)];
        shape.forEach(([st, len], i) => {
          const up = i === 1 && rnd() < 0.5 ? 12 : 0;
          out.push(note(b * bar + Math.floor(st * k), len * k, pitch + up, 0.9));
        });
      }
      break;
    }
    case 'bass_pulse': {
      const div = Math.max(1, Math.floor(p.div));
      const figure: { s: number; up: number; lift: number; acc: boolean; slide: boolean }[] = [];
      for (let s = 0; s < bar; s += div) {
        const r = [rnd(), rnd(), rnd(), rnd(), rnd()];
        if (s !== 0 && r[0] >= p.density) continue;
        if (p.skip_kick > 0 && score.meter.kick.includes(s)) continue;
        const lift = r[2] < p.move ? (r[2] < p.move * 0.5 ? 2 : 4) : 0;
        figure.push({ s, up: r[1] < p.octave ? 12 : 0, lift, acc: r[3] < p.accent, slide: r[4] < p.slide });
      }
      for (let b = 0; b < bars; b++) for (const f of figure) {
        out.push({ ...note(b * bar + f.s, div, root - 12 + tone(scale, chord(b) + f.lift) + f.up, 0.9), acc: f.acc, slide: f.slide });
      }
      break;
    }
    case 'lead_wander': {
      const span = Math.max(1, Math.floor(p.span));
      const figure: { s: number; rel: number; len: number }[] = [];
      let rel = 0;
      for (let b = 0; b < span; b++) for (let i = 0; i < bar; i += 2) {
        const r = [rnd(), rnd(), rnd(), rnd()];
        if (i !== 0 && r[0] < p.rest) continue;
        rel = Math.max(-2, Math.min(size + 2, rel + [-2, -1, -1, 1, 1, 2][Math.floor(r[1] * 6)]));
        if (i === 0) rel = r[2] < 0.5 ? 0 : 2;
        figure.push({ s: b * bar + i, rel, len: [2, 2, 3, 4][Math.floor(r[3] * 4)] });
      }
      for (let b = 0; b < bars; b++) for (const f of figure) {
        if (Math.floor(f.s / bar) === b % span) out.push(note(b * bar + (f.s % bar), f.len, root + tone(scale, size + chord(b) + f.rel), 0.8));
      }
      break;
    }
    case 'arp': {
      const div = Math.max(1, Math.floor(p.div));
      const steps: number[] = [];
      for (let o = 0; o < Math.floor(p.octaves); o++) for (const k of [0, 2, 4]) steps.push(k + o * size);
      const figure: { s: number; rel: number }[] = [];
      let count = 0;
      for (let s = 0; s < bar; s += div) {
        const r = [rnd(), rnd()];
        if (r[0] >= p.density) continue;
        let at = count % steps.length;
        const shape = Math.floor(p.shape);
        if (shape === 1) at = steps.length - 1 - at;
        else if (shape === 2) { const lap = Math.max(1, steps.length * 2 - 2); at = count % lap; if (at >= steps.length) at = lap - at; }
        else if (shape === 3) at = Math.floor(r[1] * steps.length);
        figure.push({ s, rel: steps[at] });
        count++;
      }
      for (let b = 0; b < bars; b++) for (const f of figure) out.push(note(b * bar + f.s, div, root + tone(scale, size + chord(b) + f.rel), 0.75));
      break;
    }
    case 'pad_chord': {
      for (let b = 0; b < bars; b++) for (let v = 0; v < Math.floor(p.voices); v++) {
        const midi = root + 12 + tone(scale, chord(b) + v * 2);
        if (p.stab > 0) for (let s = beat / 2; s < bar; s += beat) out.push(note(b * bar + s, beat / 2, midi, 0.5));
        else out.push(note(b * bar, bar, midi, 0.5));
      }
      break;
    }
    case 'rise': {
      const total = bars * bar;
      for (let s = 0, i = 0; s < total; i++) {
        const along = s / total;
        const div = Math.max(1, Math.floor(along < 0.5 ? beat : along < 0.75 ? beat / 2 : beat / 4));
        out.push(note(s, div, root + tone(scale, size + Math.min(Math.floor(i / 2), size * 2)), 0.35 + 0.65 * along));
        s += div;
      }
      break;
    }
    case 'written': {
      const every = Math.max(1, Math.floor(part.bars ?? bars)) * bar;
      for (let start = 0; start < bars * bar; start += every) for (const w of part.notes ?? []) {
        const at = start + w[0];
        if (at < bars * bar) out.push(note(at, w[1], root + tone(scale, chord(Math.floor(at / bar)) + w[2]), w[3] ?? 0.8));
      }
      break;
    }
  }
  return out;
}

export function instrumentOf(score: Score, track: Track, voice: string): string {
  return typeof track.inst === 'string' ? track.inst : (track.inst[voice] ?? '');
}

/** The voices a layer's notes can carry: a drum layer has two instruments, the others one. */
export function voicesOf(layer: Layer): string[] {
  return layer === 'drum' ? ['kick', 'snare'] : layer === 'hat' ? ['hat'] : ['note'];
}

export function sceneFor(score: Score, state: string): string {
  return score.states[state] ?? Object.keys(score.scenes)[0];
}

export function scoreToText(score: Score): string { return JSON.stringify(score, null, 2); }

export function scoreFromText(text: string): Score | null {
  try {
    const s = JSON.parse(text);
    return s && typeof s === 'object' && s.scenes && s.instruments && s.parts && s.meter && s.key ? (s as Score) : null;
  } catch { return null; }
}
