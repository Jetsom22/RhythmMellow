import { VoiceId } from '../core/music/song';

const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** All timbres are synthesized: no samples. */
export class Synth {
  private noise: AudioBuffer;
  brightness = 0;

  constructor(private ctx: AudioContext) {
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  play(voice: VoiceId, midi: number, time: number, dur: number, vel: number, out: AudioNode): void {
    switch (voice) {
      case 'kick': return this.kick(time, vel, out);
      case 'snare': return this.snare(time, vel, out);
      case 'hat': return this.hat(time, vel, out);
      case 'bass': return this.bass(midi, time, dur, vel, out);
      case 'lead': return this.lead(midi, time, dur, vel, out);
      case 'pad': return this.pad(midi, time, dur, vel, out);
      case 'tick': return this.tone(2000, time, 0.02, vel * 0.5, 'sine', out);
    }
  }

  private env(time: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), time + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);
    return g;
  }

  private noiseSrc(time: number, dur: number): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start(time, Math.random() * 0.5);
    s.stop(time + dur);
    return s;
  }

  tone(freq: number, time: number, dur: number, vel: number, type: OscillatorType, out: AudioNode): void {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.env(time, vel, 0.004, dur);
    o.connect(g).connect(out);
    o.start(time);
    o.stop(time + dur + 0.05);
  }

  private kick(time: number, vel: number, out: AudioNode): void {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(150, time);
    o.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    const g = this.env(time, vel, 0.002, 0.26);
    o.connect(g).connect(out);
    o.start(time);
    o.stop(time + 0.32);
  }

  private snare(time: number, vel: number, out: AudioNode): void {
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.7;
    const g = this.env(time, vel * 0.7, 0.001, 0.13);
    this.noiseSrc(time, 0.2).connect(bp).connect(g).connect(out);
    this.tone(180, time, 0.09, vel * 0.5, 'triangle', out);
  }

  private hat(time: number, vel: number, out: AudioNode): void {
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = this.env(time, vel * 0.35, 0.001, 0.04 + this.brightness * 0.03);
    this.noiseSrc(time, 0.12).connect(hp).connect(g).connect(out);
  }

  private bass(midi: number, time: number, dur: number, vel: number, out: AudioNode): void {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = mtof(midi);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 6;
    const top = 500 + this.brightness * 1800;
    lp.frequency.setValueAtTime(top, time);
    lp.frequency.exponentialRampToValueAtTime(160, time + Math.max(dur, 0.1));
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(vel * 0.55, time + 0.01);
    g.gain.setValueAtTime(vel * 0.55, time + Math.max(dur - 0.04, 0.02));
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur + 0.03);
    o.connect(lp).connect(g).connect(out);
    o.start(time);
    o.stop(time + dur + 0.08);
  }

  private lead(midi: number, time: number, dur: number, vel: number, out: AudioNode): void {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800 + this.brightness * 2500;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(vel * 0.22, time + 0.012);
    g.gain.exponentialRampToValueAtTime(vel * 0.12, time + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur + 0.12);
    for (const cents of [-7, 7]) {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = mtof(midi);
      o.detune.value = cents;
      o.connect(lp);
      o.start(time);
      o.stop(time + dur + 0.2);
    }
    lp.connect(g).connect(out);
  }

  private pad(midi: number, time: number, dur: number, vel: number, out: AudioNode): void {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(vel * 0.2, time + Math.min(0.35, dur / 2));
    g.gain.setValueAtTime(vel * 0.2, time + dur - 0.05);
    g.gain.linearRampToValueAtTime(0.0001, time + dur + 0.25);
    for (const cents of [-5, 5]) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = mtof(midi);
      o.detune.value = cents;
      o.connect(g);
      o.start(time);
      o.stop(time + dur + 0.3);
    }
    g.connect(out);
  }
}
