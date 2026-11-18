import { BeatGrid, rebase } from '../core/beat';
import { mulberry32 } from '../core/rng';
import {
  EqBand, instrumentOf, Layer, notesOf, sceneSteps, Score, ScoreNote, SCORE_LAYERS, secPerStepOf, stepsPerBar, Strip, SYNTH_PARAMS, filled,
} from '../core/music/score';
import { playVoice, VoiceKit } from './voices';

const db = (v: number): number => Math.pow(10, v / 20);
const EQ_TYPES: Record<string, BiquadFilterType> = { hp: 'highpass', lp: 'lowpass', peak: 'peaking', loshelf: 'lowshelf', hishelf: 'highshelf' };

/** One instrument on one layer: the nodes its notes pass through. */
interface StripNodes {
  layer: Layer; inst: string; bands: number;
  input: GainNode; echoSend: GainNode; echo: DelayNode; echoFb: GainNode;
  eq: BiquadFilterNode[]; level: GainNode; duck: GainNode; fader: GainNode; send: GainNode;
  duckDepth: number; duckRelease: number; last: number | undefined;
}

export interface Level { peak: number; rmsDb: number }

/**
 * Plays a score live. Every note is synthesised when its time comes, so a change to the score
 * is heard at once, and a scene (a state of the game) can take over exactly on a bar line,
 * from its first bar. The music runs on the audio clock; `grid` is the same beat grid the
 * game reads.
 *
 * It also runs inside an OfflineAudioContext, where a scene can be rendered and measured.
 */
export class ScorePlayer {
  grid: BeatGrid;
  scene: string;
  /** Called when a scene takes over: its name and the audio time it starts. */
  onScene: ((scene: string, time: number) => void) | null = null;

  private kit: VoiceKit;
  private strips = new Map<string, StripNodes>();
  private user: Record<Layer, number> = { drum: 1, hat: 1, bass: 1, lead: 1, pad: 1 };
  private bus: GainNode;
  private hp: BiquadFilterNode;
  private lp: BiquadFilterNode;
  private room: GainNode;
  private meters = {} as Record<Layer | 'master', AnalyserNode>;
  private scratch = new Float32Array(2048);
  private sceneStart = 0;
  private pending: { scene: string; now: boolean } | null = null;
  private next = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cache = new Map<string, Map<number, ScoreNote[]>>();
  private started = false;

  constructor(readonly ctx: BaseAudioContext, public score: Score, scene?: string) {
    this.scene = scene ?? Object.keys(score.scenes)[0];
    this.grid = { bpm: score.bpm, t0: 0 };
    this.kit = new VoiceKit(ctx);
    // Everything meets on one bus: the scene's filters, then gentle compression so the layers move as one.
    this.bus = ctx.createGain();
    this.hp = ctx.createBiquadFilter();
    this.hp.type = 'highpass';
    this.hp.frequency.value = 20;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 20000;
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -16; glue.knee.value = 10; glue.ratio.value = 3; glue.attack.value = 0.012; glue.release.value = 0.22;
    const master = ctx.createGain();
    master.gain.value = 0.85;
    this.bus.connect(this.hp).connect(this.lp).connect(glue).connect(master).connect(ctx.destination);
    // One room for every voice that takes a share of it. The lows stay dry.
    this.room = ctx.createGain();
    const hall = ctx.createConvolver();
    hall.buffer = this.impulse();
    const roomHp = ctx.createBiquadFilter();
    roomHp.type = 'highpass';
    roomHp.frequency.value = 350;
    const roomLp = ctx.createBiquadFilter();
    roomLp.type = 'lowpass';
    roomLp.frequency.value = 6500;
    this.room.connect(hall).connect(roomHp).connect(roomLp).connect(this.bus);
    for (const id of [...SCORE_LAYERS, 'master'] as (Layer | 'master')[]) {
      const a = (this.meters[id] = ctx.createAnalyser());
      a.fftSize = 2048;
    }
    master.connect(this.meters.master);
    this.sync();
  }

  /** A short plate-like tail: noise that dies away, different in each ear. */
  private impulse(): AudioBuffer {
    const sr = this.ctx.sampleRate, n = Math.floor(sr * 1.3);
    const buf = this.ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const r = mulberry32(4242 + ch), d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        d[i] = t < 0.008 ? 0 : (r() * 2 - 1) * Math.exp(-t * 5.5) * 0.35;
      }
    }
    return buf;
  }

  // ---------------------------------------------------------------- strips

  private makeStrip(layer: Layer, inst: string, mix: Strip): StripNodes {
    const ctx = this.ctx;
    const s: StripNodes = {
      layer, inst, bands: mix.eq.length,
      input: ctx.createGain(), echoSend: ctx.createGain(), echo: ctx.createDelay(2), echoFb: ctx.createGain(),
      eq: mix.eq.map(() => ctx.createBiquadFilter()), level: ctx.createGain(), duck: ctx.createGain(), fader: ctx.createGain(), send: ctx.createGain(),
      duckDepth: 0, duckRelease: 0.16, last: undefined,
    };
    const head = ctx.createGain();
    s.input.connect(head);
    s.input.connect(s.echoSend).connect(s.echo).connect(head);
    s.echo.connect(s.echoFb).connect(s.echo);
    let node: AudioNode = head;
    for (const f of s.eq) { node.connect(f); node = f; }
    node.connect(s.level).connect(s.duck).connect(s.fader);
    s.fader.connect(this.bus);
    s.fader.connect(s.send).connect(this.room);
    s.fader.connect(this.meters[layer]);
    s.fader.gain.value = 0;
    return s;
  }

  private dropStrip(s: StripNodes): void {
    s.fader.disconnect();
    s.send.disconnect();
    s.echoFb.disconnect();
  }

  /** Bring the strips in line with the score: make the missing ones, retune the rest in place. */
  private sync(): void {
    const t = this.ctx.currentTime;
    const sps = secPerStepOf(this.score);
    const wanted = new Set<string>();
    for (const sceneId in this.score.scenes) for (const layer of SCORE_LAYERS) {
      const track = this.score.scenes[sceneId].tracks[layer];
      if (!track) continue;
      for (const name of typeof track.inst === 'string' ? [track.inst] : Object.values(track.inst)) {
        const inst = this.score.instruments[name];
        if (!inst) continue;
        const key = layer + '/' + name;
        wanted.add(key);
        let s = this.strips.get(key);
        if (s && s.bands !== inst.mix.eq.length) { this.dropStrip(s); s = undefined; }
        if (!s) this.strips.set(key, (s = this.makeStrip(layer, name, inst.mix)));
        inst.mix.eq.forEach((b: EqBand, i: number) => {
          const f = s!.eq[i];
          f.type = EQ_TYPES[b.type] ?? 'peaking';
          f.frequency.setTargetAtTime(Math.max(10, Math.min(b.hz, 20000)), t, 0.02);
          f.Q.setTargetAtTime(b.q, t, 0.02);
          f.gain.setTargetAtTime(b.gain, t, 0.02);
        });
        s.level.gain.setTargetAtTime(db(inst.mix.gain_db ?? 0), t, 0.02);
        s.send.gain.setTargetAtTime(inst.mix.room ?? 0, t, 0.02);
        s.duckDepth = inst.mix.duck ?? 0;
        s.duckRelease = inst.mix.duck_release ?? 0.16;
        const p = filled(SYNTH_PARAMS.tone, inst.synth === 'tone' ? inst.p : {});
        s.echoSend.gain.setTargetAtTime(inst.synth === 'tone' ? p.echo : 0, t, 0.02);
        s.echoFb.gain.setTargetAtTime(Math.min(p.echo_fb, 0.9), t, 0.02);
        s.echo.delayTime.setTargetAtTime(Math.min(p.echo_steps * sps, 1.9), t, 0.02);
      }
    }
    for (const [key, s] of this.strips) if (!wanted.has(key)) { this.dropStrip(s); this.strips.delete(key); }
    this.faders(t);
  }

  /** A layer is heard through the strips of the scene that is playing; the others fade out with their tails. */
  private faders(t: number): void {
    const scene = this.score.scenes[this.scene];
    for (const s of this.strips.values()) {
      const track = scene?.tracks[s.layer];
      const mine = !!track && (typeof track.inst === 'string' ? track.inst === s.inst : Object.values(track.inst).includes(s.inst));
      s.fader.gain.setTargetAtTime(mine ? this.user[s.layer] * db(track!.gain_db ?? 0) : 0, t, mine ? 0.03 : 0.25);
    }
  }

  private filters(t: number, snap: boolean): void {
    const scene = this.score.scenes[this.scene];
    const lp = Math.min(scene?.lp ?? 20000, 20000), hp = Math.max(scene?.hp ?? 20, 10);
    for (const [param, v, moving] of [[this.lp.frequency, lp, scene?.lp_to !== undefined], [this.hp.frequency, hp, scene?.hp_to !== undefined]] as [AudioParam, number, boolean][]) {
      if (moving && !snap) continue;          // a filter in the middle of its sweep is left alone
      param.cancelScheduledValues(t);
      param.setTargetAtTime(v, t, snap ? 0.01 : 0.05);
    }
  }

  // ---------------------------------------------------------------- what the game and the studio call

  /** Use a changed score from now on. Sliders call this on every move. */
  setScore(score: Score): void {
    const t = this.ctx.currentTime;
    if (score.bpm !== this.grid.bpm && this.started) { this.grid = rebase(this.grid, score.bpm, t); this.next = Math.max(0, Math.ceil((t - this.grid.t0) / secPerStepOf(score))); }
    this.score = score;
    if (!this.started) this.grid = { bpm: score.bpm, t0: this.grid.t0 };
    this.cache.clear();
    if (!score.scenes[this.scene]) this.scene = Object.keys(score.scenes)[0];
    this.sync();
    this.filters(t, false);
  }

  /** Move to another scene: on the next bar line (the default), or at once. It starts from its first bar. */
  setScene(scene: string, when: 'bar' | 'now' = 'bar'): void {
    if (!this.score.scenes[scene]) return;
    if (!this.started) { this.scene = scene; this.sync(); this.filters(this.ctx.currentTime, true); return; }
    this.pending = { scene, now: when === 'now' };
  }

  /** The scene waiting for the next bar line, if any. */
  queued(): string | null { return this.pending ? this.pending.scene : null; }

  /** How loud the game wants a layer (0 when it is not owned yet, and so on). */
  setLayerGain(layer: Layer, gain: number): void {
    this.user[layer] = gain;
    this.faders(this.ctx.currentTime);
  }

  /** Must follow a user gesture when the context is a live one. */
  start(delay = 0.12): void {
    if (this.started) return;
    this.begin(this.ctx.currentTime + delay);
    this.timer = setInterval(() => this.pump(), 25);
    this.pump();
  }

  /** Put step 0 at audio time `t0`. start() does this for a live context; a render calls it directly. */
  begin(t0: number): void {
    this.started = true;
    this.grid = { bpm: this.score.bpm, t0 };
    this.next = 0;
    this.sceneStart = 0;
    this.filters(this.ctx.currentTime, true);
    this.faders(this.ctx.currentTime);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private pump(): void {
    if (this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const sps = secPerStepOf(this.score);
    // Far behind (a hidden tab): drop the stale steps instead of playing them in a burst.
    if (this.grid.t0 + this.next * sps < now - 0.25) this.next = Math.ceil((now - this.grid.t0) / sps);
    this.scheduleUntil(now + 0.12);
  }

  /** Schedule every step that starts before `time`. The live player calls this on a timer; a render calls it once. */
  scheduleUntil(time: number): void {
    const sps = secPerStepOf(this.score);
    while (this.grid.t0 + this.next * sps < time) {
      this.step(this.next, Math.max(this.grid.t0 + this.next * sps, this.ctx.currentTime));
      this.next++;
    }
  }

  private enter(scene: string, abs: number, time: number): void {
    this.scene = scene;
    this.sceneStart = abs;
    this.faders(time);
    this.filters(time, true);
    this.onScene?.(scene, time);
  }

  private step(abs: number, time: number): void {
    const bar = stepsPerBar(this.score);
    if (this.pending && (this.pending.now || (abs - this.sceneStart) % bar === 0)) {
      const to = this.pending.scene;
      this.pending = null;
      this.enter(to, abs, time);
    }
    let scene = this.score.scenes[this.scene];
    if (!scene) return;
    let len = sceneSteps(this.score, this.scene);
    let local = abs - this.sceneStart;
    if (local >= len) {
      if (scene.once && scene.next && this.score.scenes[scene.next]) {
        this.enter(scene.next, abs, time);
        scene = this.score.scenes[this.scene];
        len = sceneSteps(this.score, this.scene);
        local = 0;
      } else {
        this.sceneStart += Math.floor(local / len) * len;
        local = abs - this.sceneStart;
      }
    }
    const sps = secPerStepOf(this.score);
    if (local === 0) {
      // A scene whose filters move: from the first value to the second over its length, every lap.
      const moves: [AudioParam, number | undefined, number | undefined, number][] = [[this.lp.frequency, scene.lp, scene.lp_to, 20000], [this.hp.frequency, scene.hp, scene.hp_to, 20]];
      for (const [param, from, to, open] of moves) {
        if (to === undefined) continue;
        param.cancelScheduledValues(time);
        param.setValueAtTime(Math.max(10, Math.min(from ?? open, 20000)), time);
        param.exponentialRampToValueAtTime(Math.max(10, Math.min(to, 20000)), time + len * sps);
      }
    }
    for (const layer of SCORE_LAYERS) {
      const track = scene.tracks[layer];
      if (!track) continue;
      for (const n of this.notesAt(layer, local)) {
        const name = instrumentOf(this.score, track, n.voice);
        const inst = this.score.instruments[name];
        const strip = this.strips.get(layer + '/' + name);
        if (!inst || !strip) continue;
        const at = time + (n.step - Math.floor(n.step)) * sps;
        playVoice(this.kit, inst, { midi: n.midi, vel: n.vel, acc: n.acc, slideFrom: n.slide ? strip.last : undefined }, at, n.len * sps, strip.input);
        strip.last = n.midi;
        if (n.voice === 'kick' && n.vel > 0.7) this.duckAt(at);
      }
    }
  }

  /** The kick gets the low end to itself for a moment: every strip that ducks gives way and comes back. */
  private duckAt(time: number): void {
    for (const s of this.strips.values()) {
      if (s.duckDepth <= 0) continue;
      s.duck.gain.setTargetAtTime(1 - s.duckDepth, time, 0.002);
      s.duck.gain.setTargetAtTime(1, time + 0.012, s.duckRelease / 3);
    }
  }

  private notesAt(layer: Layer, local: number): ScoreNote[] {
    const key = this.scene + '/' + layer;
    let byStep = this.cache.get(key);
    if (!byStep) {
      byStep = new Map();
      for (const n of notesOf(this.score, this.scene, layer)) {
        const st = Math.floor(n.step);
        if (!byStep.has(st)) byStep.set(st, []);
        byStep.get(st)!.push(n);
      }
      this.cache.set(key, byStep);
    }
    return byStep.get(local) ?? [];
  }

  // ---------------------------------------------------------------- reading it back

  /** Where the music is: the scene, and the step inside it that is sounding now. */
  position(): { scene: string; step: number; steps: number } {
    const steps = sceneSteps(this.score, this.scene);
    if (!this.started) return { scene: this.scene, step: 0, steps };
    const abs = (this.ctx.currentTime - this.grid.t0) / secPerStepOf(this.score);
    return { scene: this.scene, step: (((abs - this.sceneStart) % steps) + steps) % steps, steps };
  }

  /** How loud a layer (or the whole mix) is right now. */
  level(id: Layer | 'master'): Level {
    const d = this.scratch;
    this.meters[id].getFloatTimeDomainData(d);
    let peak = 0, sq = 0;
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; sq += a * a; }
    return { peak, rmsDb: 10 * Math.log10(sq / d.length + 1e-12) };
  }
}

/** Render a scene without playing it, for measuring. `solo` leaves one layer on. */
export async function renderScene(score: Score, scene: string, laps = 1, solo?: Layer, sampleRate = 44100): Promise<AudioBuffer> {
  const seconds = sceneSteps(score, scene) * secPerStepOf(score) * laps;
  const ctx = new OfflineAudioContext(2, Math.ceil((seconds + 0.05) * sampleRate), sampleRate);
  const player = new ScorePlayer(ctx, score, scene);
  if (solo) for (const l of SCORE_LAYERS) if (l !== solo) player.setLayerGain(l, 0);
  player.begin(0.02);
  player.scheduleUntil(seconds + 0.02);
  return ctx.startRendering();
}
