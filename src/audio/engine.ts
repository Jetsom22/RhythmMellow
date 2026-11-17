import { BeatGrid, rebase, secPerStep } from '../core/beat';
import { Mix } from '../core/music/mix';
import { LayerId, LAYERS, Note, Song, notesAt, vary } from '../core/music/song';
import { Scheduler } from '../core/scheduler';
import { Tunables } from '../core/tunables';
import { Synth } from './synth';

export type OneShot = 'collect' | 'hit' | 'dodgePerfect' | 'dodgeNear' | 'dodgeMiss' | 'fill' | 'resolve' | 'victory';
type Bus = LayerId | 'tick';

/** Owns the AudioContext: the single clock everything else reads. */
export class AudioEngine {
  ctx!: AudioContext;
  grid: BeatGrid;
  scheduler = new Scheduler({ lookahead: 0.12, maxCatchUp: 0.25 });
  private synth!: Synth;
  private buses = {} as Record<Bus, GainNode>;
  private fx!: GainNode;
  private filter!: BiquadFilterNode;
  private timer: ReturnType<typeof setInterval> | null = null;
  private variation = 0;
  private varied = new Map<string, Note[]>();

  constructor(private song: Song, tun: Tunables) {
    this.grid = { bpm: tun.bpm, t0: 0 };
  }

  /** Must be called from a user gesture. */
  async start(): Promise<void> {
    const ctx = (this.ctx = new AudioContext({ latencyHint: 'interactive' }));
    await ctx.resume();
    this.synth = new Synth(ctx);
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    const master = ctx.createGain();
    master.gain.value = 0.8;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 18000;
    this.filter.connect(limiter).connect(master).connect(ctx.destination);
    for (const b of [...LAYERS, 'tick'] as Bus[]) {
      const g = (this.buses[b] = ctx.createGain());
      g.gain.value = 0;
      g.connect(this.filter);
    }
    // A short echo on the lead only.
    const delay = ctx.createDelay(1);
    delay.delayTime.value = secPerStep(this.grid.bpm) * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    this.buses.lead.connect(delay);
    delay.connect(fb).connect(delay);
    fb.connect(this.filter);
    this.fx = ctx.createGain();
    this.fx.gain.value = 0.7;
    this.fx.connect(limiter);

    this.grid = { bpm: this.grid.bpm, t0: ctx.currentTime + 0.15 };
    this.timer = setInterval(() => this.pump(), 25);
    this.pump();
  }

  now(): number { return this.ctx ? this.ctx.currentTime : 0; }

  outputLatencyMs(): number {
    if (!this.ctx) return 0;
    return Math.round(((this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0)) * 1000);
  }

  private layerNotes(layer: LayerId): Note[] {
    const key = layer + ':' + this.variation;
    let v = this.varied.get(key);
    if (!v) this.varied.set(key, (v = vary(this.song, layer, this.variation)));
    return v;
  }

  private pump(): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const sps = secPerStep(this.grid.bpm);
    this.scheduler.tick(
      this.ctx.currentTime, this.grid,
      abs => {
        const out: { note: Note; layer: Bus }[] = [];
        for (const l of LAYERS) for (const note of notesAt(this.layerNotes(l), this.song.loopSteps, abs)) out.push({ note, layer: l });
        for (const note of notesAt(this.song.tick, this.song.loopSteps, abs)) out.push({ note, layer: 'tick' });
        return out;
      },
      n => this.synth.play(n.note.voice, n.note.midi, n.time, n.note.len * sps, n.note.vel, this.buses[n.layer]),
    );
  }

  setMix(m: Mix): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const b of Object.keys(this.buses) as Bus[]) this.buses[b].gain.setTargetAtTime(m.gain[b], t, 0.05);
    this.filter.frequency.setTargetAtTime(m.cutoffHz, t, 0.08);
    this.synth.brightness = m.brightness;
  }

  setVariation(n: number): void { this.variation = n; }

  setBpm(bpm: number): void {
    if (!this.ctx || bpm === this.grid.bpm || !(bpm > 0)) return;
    this.grid = rebase(this.grid, bpm, this.ctx.currentTime);
    this.scheduler.reset();
  }

  oneShot(kind: OneShot): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.005;
    const root = 440 * Math.pow(2, (this.song.rootMidi + 24 - 69) / 12);
    const sc = this.song.scale.map(d => root * Math.pow(2, d / 12));
    const s = this.synth, o = this.fx;
    switch (kind) {
      case 'dodgePerfect': s.tone(sc[4] * 2, t, 0.12, 0.25, 'sine', o); s.tone(sc[2] * 2, t + 0.04, 0.14, 0.2, 'sine', o); break;
      case 'dodgeNear': s.tone(sc[2] * 2, t, 0.1, 0.16, 'sine', o); break;
      case 'dodgeMiss': s.tone(sc[0] / 2, t, 0.08, 0.14, 'triangle', o); break;
      case 'hit': s.tone(70, t, 0.3, 0.6, 'sawtooth', o); s.tone(52, t, 0.4, 0.5, 'square', o); break;
      case 'collect': [0, 2, 4, 5].forEach((d, i) => s.tone((sc[d % 5] * (d >= 5 ? 2 : 1)), t + i * 0.07, 0.25, 0.25, 'triangle', o)); break;
      case 'fill': for (let i = 0; i < 4; i++) s.play('snare', 38, t + i * secPerStep(this.grid.bpm) / 2, 0.1, 0.4 + i * 0.15, o); break;
      case 'resolve': [0, 2, 3].forEach(d => s.tone(sc[d], t, 1.2, 0.2, 'triangle', o)); break;
      case 'victory': [0, 1, 2, 3, 4, 0].forEach((d, i) => s.tone(sc[d] * (i === 5 ? 2 : 1), t + i * 0.09, 0.5, 0.22, 'triangle', o)); break;
    }
  }

  suspend(): void { void this.ctx?.suspend(); }
  resume(): void { void this.ctx?.resume(); }
  stop(): void { if (this.timer) clearInterval(this.timer); }
}
