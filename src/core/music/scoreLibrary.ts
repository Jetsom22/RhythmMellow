import { EqBand, Instrument, Score, Strip } from './score';

/**
 * The scores that ship with the build. For now one: a starting point arranged into the scenes
 * of a boss fight. Nothing here has been judged by ear yet; it is a place to start from in the studio.
 * The levels were set by measuring: each instrument alone was matched to the loudness it had in the first mix.
 */

const band = (type: EqBand['type'], hz: number, q: number, gain = 0): EqBand => ({ type, hz, q, gain });
const strip = (gain_db: number, eq: EqBand[], more: Partial<Strip> = {}): Strip => ({ gain_db, eq, room: 0, duck: 0, duck_release: 0.16, ...more });
const tone = (p: Record<string, number>, mix: Strip): Instrument => ({ synth: 'tone', p, mix });

const bassEq = (): EqBand[] => [band('hp', 36, 0.7), band('peak', 58, 1, -3), band('peak', 105, 1, 1.5), band('peak', 280, 1, -4.5), band('peak', 800, 0.9, 2.5), band('lp', 2400, 0.7)];
const leadEq = (): EqBand[] => [band('hp', 420, 0.7), band('peak', 520, 1, -2.5), band('peak', 3200, 0.8, 1.5), band('lp', 8500, 0.7)];
const bassMix = (gain: number): Strip => strip(gain, bassEq(), { duck: 0.45 });
const leadMix = (gain: number): Strip => strip(gain, leadEq(), { room: 0.2 });
const kit = { kick: 'kick', snare: 'snare' };

export function demoScore(): Score {
  return {
    id: 'demo', bpm: 110, seed: 7,
    meter: { stepsPerBeat: 4, beatsPerBar: 4, kick: [0, 8], snare: [4, 12] },
    key: { scale: 'minor_pentatonic', root: -1, bars: 4, chords: [] },
    instruments: {
      'kick': { synth: 'kick', p: {}, mix: strip(-2.7, [band('hp', 30, 0.7), band('peak', 62, 1, 2), band('peak', 320, 1.2, -4), band('lp', 6000, 0.7)]) },
      'snare': { synth: 'snare', p: {}, mix: strip(-11.7, [band('hp', 170, 0.7), band('peak', 220, 1, 1.5), band('peak', 3000, 0.9, 2), band('lp', 10000, 0.7)], { room: 0.16 }) },
      'hat': { synth: 'hat', p: {}, mix: strip(-13.6, [band('hp', 6000, 0.7), band('lp', 15000, 0.7)], { room: 0.05 }) },
      'bass sub': tone({ oct: 12, sub: 0.7, saw: 0.6, cutoff: 140, env: 1500, env_decay: 8, reso: 0.3, drive: 0.1, release: 0.08 }, bassMix(-11.3)),
      'bass round': tone({ oct: 12, sub: 0.8, sine: 0.18, tri: 0.28, cutoff: 300, env: 900, env_decay: 3, reso: 0.1, drive: 0.1, release: 0.08 }, bassMix(-11.5)),
      'bass fm': tone({ sine: 0.85, fm: 2.85, fm_ratio: 2, fm_decay: 16, fm_hold: 0.09, drive: 0.1, release: 0.08 }, bassMix(-12.4)),
      // Short notes, a filter that snaps shut, accents and slides: made for the bass_pulse rule, not for long notes.
      'bass acid': tone({ oct: 12, sub: 0.45, saw: 0.8, cutoff: 220, env: 1800, env_decay: 14, reso: 0.75, accent: 0.6, glide: 0.05, gate: 0.55, release: 0.04 }, bassMix(-9.7)),
      'lead bell': tone({ oct: 12, sine: 1, fm: 2.2, fm_ratio: 2, fm_decay: 8, fm_hold: 0.1, attack: 0.004, decay: 0.31, sustain: 0.4, release: 0.3, vib: 6, echo: 0.28 }, leadMix(-10.6)),
      'lead pulse': tone({ oct: 12, pulse: 1, pw: 0.32, cutoff: 900, env: 1700, env_decay: 6, reso: 0.25, attack: 0.012, decay: 0.25, sustain: 0.6, release: 0.16, vib: 6, echo: 0.28 }, leadMix(-9.2)),
      'lead glass': tone({ oct: 12, sine: 0.85, fm: 0.35, fm_ratio: 3, fm_decay: 6, fm_hold: 0.2, attack: 0.008, decay: 0.33, sustain: 0.55, release: 0.28, vib: 6, echo: 0.28 }, leadMix(-9)),
      'lead reed': tone({ oct: 12, sine: 0.6, tri: 0.3, fm: 0.7, fm_ratio: 3, fm_decay: 3, fm_hold: 0.4, attack: 0.03, release: 0.2, vib: 6, echo: 0.28 }, leadMix(-9.6)),
      'pad soft': tone({ tri: 0.8, detune: 10, attack: 0.35, release: 0.3 }, strip(-14.6, [band('hp', 240, 0.7), band('peak', 900, 0.8, -3), band('peak', 2600, 0.7, 1.5), band('lp', 5000, 0.7)], { room: 0.32 })),
    },
    parts: {
      'rest': { rule: 'rest', p: {}, roll: 0 },
      'drum plain': { rule: 'drum', p: { ghost: 0 }, roll: 0 },
      'drum main': { rule: 'drum', p: { ghost: 0.6 }, roll: 0 },
      'hat light': { rule: 'hat', p: { pulses: 0 }, roll: 0 },
      'hat main': { rule: 'hat', p: { pulses: 4 }, roll: 0 },
      'hat rush': { rule: 'hat', p: { pulses: 8, quarters: 1 }, roll: 0 },
      'bass long': { rule: 'bass_hold', p: {}, roll: 0 },
      'bass eighths': { rule: 'bass_pulse', p: { div: 2, density: 0.8, octave: 0.25 }, roll: 0 },
      'bass sixteenths': { rule: 'bass_pulse', p: { div: 1, density: 0.7, octave: 0.3, accent: 0.35, slide: 0.2 }, roll: 0 },
      'lead line': { rule: 'lead_wander', p: { rest: 0.4, span: 2 }, roll: 0 },
      'lead sparse': { rule: 'lead_wander', p: { rest: 0.75, span: 2 }, roll: 0 },
      'lead arp': { rule: 'arp', p: { div: 2, octaves: 2, shape: 2 }, roll: 0 },
      'lead climb': { rule: 'rise', p: {}, roll: 0 },
      'pad hold': { rule: 'pad_chord', p: { voices: 3 }, roll: 0 },
      'pad stabs': { rule: 'pad_chord', p: { voices: 3, stab: 1 }, roll: 0 },
    },
    scenes: {
      'explore': { bars: 4, tracks: {
        drum: { part: 'drum main', inst: kit }, hat: { part: 'hat main', inst: 'hat' }, bass: { part: 'bass long', inst: 'bass sub' },
        lead: { part: 'lead line', inst: 'lead bell' }, pad: { part: 'pad hold', inst: 'pad soft' },
      } },
      'intro': { bars: 4, lp: 2500, tracks: {
        drum: { part: 'drum plain', inst: kit }, hat: { part: 'hat light', inst: 'hat' }, bass: { part: 'bass long', inst: 'bass round' },
        lead: { part: 'lead sparse', inst: 'lead glass' }, pad: { part: 'pad hold', inst: 'pad soft' },
      } },
      'phase 1': { bars: 4, tracks: {
        drum: { part: 'drum main', inst: kit }, hat: { part: 'hat main', inst: 'hat' }, bass: { part: 'bass eighths', inst: 'bass fm' },
        lead: { part: 'lead line', inst: 'lead bell' }, pad: { part: 'pad hold', inst: 'pad soft' },
      } },
      // Played once: the filter opens over two bars, then the drop takes over.
      'build': { bars: 2, once: true, next: 'drop', lp: 700, lp_to: 16000, tracks: {
        drum: { part: 'drum plain', inst: kit }, hat: { part: 'hat rush', inst: 'hat' }, bass: { part: 'bass eighths', inst: 'bass fm' },
        lead: { part: 'lead climb', inst: 'lead pulse' }, pad: { part: 'pad stabs', inst: 'pad soft' },
      } },
      'drop': { bars: 4, tracks: {
        drum: { part: 'drum main', inst: kit }, hat: { part: 'hat rush', inst: 'hat' }, bass: { part: 'bass sixteenths', inst: 'bass acid' },
        lead: { part: 'lead arp', inst: 'lead pulse' }, pad: { part: 'pad stabs', inst: 'pad soft' },
      } },
    },
    states: { 'explore': 'explore', 'boss.enter': 'intro', 'boss.phase1': 'phase 1', 'boss.shift': 'build', 'boss.phase2': 'drop' },
  };
}
