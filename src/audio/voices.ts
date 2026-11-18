import { mulberry32 } from '../core/rng';
import { filled, Instrument, SYNTH_PARAMS } from '../core/music/score';

/**
 * Voices whose sound is data. A patch says what the oscillators, filter and envelopes do;
 * every note builds a small graph of audio nodes from it. A changed patch is heard on the
 * very next note.
 */

const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** Things every note needs and that are worth making once per audio context. */
export class VoiceKit {
  readonly noise: AudioBuffer;
  private curves = new Map<number, Float32Array<ArrayBuffer>>();
  private pulses = new Map<number, PeriodicWave>();
  private rnd = mulberry32(1234);

  constructor(readonly ctx: BaseAudioContext) {
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    const r = mulberry32(99);
    for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
  }

  /** A soft-clipping curve for the given drive (0..1). */
  curve(drive: number): Float32Array<ArrayBuffer> {
    const key = Math.round(drive * 50);
    let c = this.curves.get(key);
    if (!c) {
      const k = 1 + 3 * (key / 50);
      c = new Float32Array(1025);
      for (let i = 0; i < c.length; i++) c[i] = Math.tanh(((i / 512) - 1) * 2 * k);
      this.curves.set(key, c);
    }
    return c;
  }

  /** A band-limited pulse wave of the given width. */
  pulse(width: number): PeriodicWave {
    const key = Math.round(width * 100);
    let w = this.pulses.get(key);
    if (!w) {
      const n = 64, real = new Float32Array(n), imag = new Float32Array(n);
      for (let i = 1; i < n; i++) real[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * (key / 100));
      w = this.ctx.createPeriodicWave(real, imag);
      this.pulses.set(key, w);
    }
    return w;
  }

  noiseSource(time: number, dur: number): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start(time, this.rnd() * 0.5);
    s.stop(time + dur);
    return s;
  }
}

export interface NoteOn { midi: number; vel: number; acc?: boolean; slideFrom?: number }

/** Play one note of a patch into `out`. `dur` is the written length in seconds. */
export function playVoice(kit: VoiceKit, patch: Instrument, n: NoteOn, time: number, dur: number, out: AudioNode): void {
  switch (patch.synth) {
    case 'kick': return kick(kit, filled(SYNTH_PARAMS.kick, patch.p), n.vel, time, out);
    case 'snare': return snare(kit, filled(SYNTH_PARAMS.snare, patch.p), n.vel, time, out);
    case 'hat': return hat(kit, filled(SYNTH_PARAMS.hat, patch.p), n.vel, time, out);
    default: return tone(kit, filled(SYNTH_PARAMS.tone, patch.p), n, time, dur, out);
  }
}

function tone(kit: VoiceKit, p: Record<string, number>, n: NoteOn, time: number, dur: number, out: AudioNode): void {
  const ctx = kit.ctx;
  const f = mtof(n.midi + p.oct);
  const from = n.slideFrom === undefined ? f : mtof(n.slideFrom + p.oct);
  const push = 1 + (n.acc ? p.accent : 0);
  const hold = Math.max(p.attack, dur * p.gate);
  const end = time + hold + p.release + 0.05;
  const oscs: OscillatorNode[] = [];
  const pre = ctx.createGain();

  const osc = (type: OscillatorType | PeriodicWave, mult: number, cents: number, level: number, into: AudioNode): OscillatorNode => {
    const o = ctx.createOscillator();
    if (typeof type === 'string') o.type = type as OscillatorType; else o.setPeriodicWave(type);
    if (from !== f) { o.frequency.setValueAtTime(from * mult, time); o.frequency.setTargetAtTime(f * mult, time, p.glide / 3); }
    else o.frequency.value = f * mult;
    o.detune.value = cents;
    const g = ctx.createGain();
    g.gain.value = level;
    o.connect(g).connect(into);
    o.start(time);
    o.stop(end);
    oscs.push(o);
    return o;
  };

  const two = p.detune > 0;
  if (p.saw > 0) { osc('sawtooth', 1, 0, two ? p.saw / 2 : p.saw, pre); if (two) osc('sawtooth', 1, p.detune, p.saw / 2, pre); }
  if (p.tri > 0) { osc('triangle', 1, 0, two ? p.tri / 2 : p.tri, pre); if (two) osc('triangle', 1, p.detune, p.tri / 2, pre); }
  if (p.pulse > 0) osc(Math.abs(p.pw - 0.5) < 0.01 ? ('square' as OscillatorType) : kit.pulse(p.pw), 1, 0, p.pulse, pre);
  if (p.sine > 0) {
    const carrier = osc('sine', 1, 0, p.sine, pre);
    if (p.fm > 0) {
      // The modulator bends the carrier's pitch: hard at the start of the note, then it dies away.
      const mod = ctx.createOscillator();
      mod.frequency.value = f * p.fm_ratio;
      const depth = ctx.createGain();
      const full = p.fm * f * p.fm_ratio;
      depth.gain.setValueAtTime(full, time);
      depth.gain.setTargetAtTime(full * p.fm_hold, time, 1 / p.fm_decay);
      mod.connect(depth).connect(carrier.frequency);
      mod.start(time);
      mod.stop(end);
    }
  }

  let node: AudioNode = pre;
  if (p.cutoff < 17900 || p.env > 0) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.5 * Math.pow(40, p.reso);
    const base = Math.min(p.cutoff + p.track * f, 20000);
    lp.frequency.setValueAtTime(Math.min(base + p.env * push, 20000), time);
    lp.frequency.setTargetAtTime(base, time, 1 / p.env_decay);
    node.connect(lp);
    node = lp;
  }
  const sum = ctx.createGain();
  node.connect(sum);
  if (p.sub > 0) osc('sine', 0.5, 0, p.sub, sum);
  node = sum;
  if (p.drive > 0) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = kit.curve(p.drive);
    node.connect(shaper);
    node = shaper;
  }
  if (p.vib > 0) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = p.vib_rate;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, time + 0.14);
    depth.gain.linearRampToValueAtTime(p.vib, time + 0.34);
    lfo.connect(depth);
    for (const o of oscs) depth.connect(o.detune);
    lfo.start(time);
    lfo.stop(end);
  }
  const amp = ctx.createGain();
  const peak = n.vel * push * 0.5;
  amp.gain.setValueAtTime(0, time);
  amp.gain.linearRampToValueAtTime(peak, time + p.attack);
  if (p.sustain < 1) amp.gain.setTargetAtTime(peak * p.sustain, time + p.attack, p.decay);
  amp.gain.setValueAtTime(peak * (p.sustain + (1 - p.sustain) * Math.exp(-(hold - p.attack) / p.decay)), time + hold);
  amp.gain.linearRampToValueAtTime(0, time + hold + p.release);
  node.connect(amp).connect(out);
}

function shaped(kit: VoiceKit, drive: number, into: AudioNode): AudioNode {
  if (drive <= 0) return into;
  const shaper = kit.ctx.createWaveShaper();
  shaper.curve = kit.curve(drive);
  shaper.connect(into);
  return shaper;
}

function kick(kit: VoiceKit, p: Record<string, number>, vel: number, time: number, out: AudioNode): void {
  const ctx = kit.ctx;
  const end = time + p.decay * 2 + 0.05;
  const into = shaped(kit, p.drive, out);
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(p.f_start, time);
  o.frequency.exponentialRampToValueAtTime(p.f_end, time + p.sweep);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(vel, time + 0.002);
  g.gain.setTargetAtTime(0, time + 0.002, p.decay / 3);
  o.connect(g).connect(into);
  o.start(time);
  o.stop(end);
  if (p.click > 0) {
    const c = ctx.createOscillator();
    c.frequency.value = 1900;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(p.click * vel * 0.5, time);
    cg.gain.setTargetAtTime(0, time, 0.002);
    c.connect(cg).connect(into);
    c.start(time);
    c.stop(time + 0.03);
  }
}

function snare(kit: VoiceKit, p: Record<string, number>, vel: number, time: number, out: AudioNode): void {
  const ctx = kit.ctx;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = p.noise_hp;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = p.noise_lp;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vel * p.noise_level * 0.7, time);
  g.gain.setTargetAtTime(0, time, p.noise_decay / 3);
  kit.noiseSource(time, p.noise_decay * 2 + 0.05).connect(hp).connect(lp).connect(g).connect(out);
  if (p.tone_level > 0) {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = p.tone;
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(vel * p.tone_level, time);
    tg.gain.setTargetAtTime(0, time, p.tone_decay / 3);
    o.connect(tg).connect(out);
    o.start(time);
    o.stop(time + p.tone_decay * 2 + 0.05);
  }
}

function hat(kit: VoiceKit, p: Record<string, number>, vel: number, time: number, out: AudioNode): void {
  const ctx = kit.ctx;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = p.hp;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vel * 0.35, time);
  g.gain.setTargetAtTime(0, time, p.decay / 3);
  kit.noiseSource(time, p.decay * 2 + 0.05).connect(hp).connect(g).connect(out);
}
