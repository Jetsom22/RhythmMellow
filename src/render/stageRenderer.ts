import { LayerId } from '../core/music/song';
import { centreOf, outline } from '../core/stage/shapes';
import { ATTACK_RANGE_U, Emitter, Inst, Instrument, SPECIAL, StageEvent, StageSim, V } from '../core/stage/sim';
import { Palette, paletteOf } from './theme';

const TAU = Math.PI * 2;
const clamp = (v: number, a = 0, b = 1): number => Math.max(a, Math.min(b, v));
const easeOut = (t: number): number => 1 - (1 - t) ** 3;
const PLAYER_R = 10;
const CHUNK = 256;
/** Each time an echo bounces off the edge of the ground it keeps this much of its strength. */
const BOUNCE = .62;
/** One turn of the clock's disc is this many bars. */
const REV_BARS = 2;

/** How an attack's echo spreads, by the layer it rides on. Lengths are in beats and pixels. */
const ECHO: Record<LayerId, { dist: number; lines: number; life: number; alpha: number; w: number; gap: number }> = {
  hat: { dist: 16, lines: 1, life: .6, alpha: .8, w: 1.2, gap: .15 },
  drum: { dist: 95, lines: 2, life: 1.3, alpha: .7, w: 1.3, gap: .2 },
  lead: { dist: 70, lines: 2, life: 1.1, alpha: .7, w: 1.3, gap: .2 },
  pad: { dist: 70, lines: 2, life: 1.1, alpha: .7, w: 1.3, gap: .2 },
  bass: { dist: 0, lines: 0, life: 3.4, alpha: .17, w: 0, gap: 0 },
};

interface Echo { inst: Inst; at: number }
interface Flash { inst: Inst; at: number }
type PlayerFx =
  | { kind: 'dash'; at: number; x: number; y: number; x1: number; y1: number; strong: boolean }
  | { kind: 'drum'; at: number; x: number; y: number }
  | { kind: 'hat'; at: number; x: number; y: number; tx: number; ty: number }
  | { kind: 'ring'; at: number; x: number; y: number; color: string }
  | { kind: 'special'; at: number; layer: Instrument; x: number; y: number; dx: number; dy: number }
  | { kind: 'dust'; at: number; from: V; to: V; dur: number };

/** Grains the player breaks into. Fixed, so the scatter looks the same every time. */
const GRAINS = (() => {
  const out: { ox: number; oy: number; dx: number; dy: number; far: number; size: number; lag: number; spin: number; drift: number; tw: boolean; sub: number; slot: number; amp: number }[] = [];
  let seed = 7;
  const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 130; i++) {
    const r = 8 * Math.sqrt((i + .5) / 130), a = i * 2.39996, dir = a + (rnd() - .5) * 1.1;
    out.push({
      ox: r * Math.cos(a), oy: r * Math.sin(a), dx: Math.cos(dir), dy: Math.sin(dir), far: 18 + rnd() * 62 + r * 3,
      size: .8 + rnd() * 1.5, lag: rnd() * .35, spin: (rnd() - .5) * 2.2, drift: rnd() * TAU,
      tw: rnd() < .36, sub: rnd() < .5 ? 2 : 4, slot: Math.floor(rnd() * 4), amp: .9 + rnd() * 1.5,
    });
  }
  return out;
})();

/**
 * The look of a stage. The same rules as the validation build's renderer, on a map made of shapes:
 *  - the ground has no colour: it is the background, bounded by one thin line
 *  - a filled plane is a sound happening now; a telegraph is the same plane, growing, its opacity rising in 16th steps
 *  - lines are what a sound leaves behind: echoes spread from a hit and bounce off the edge of the ground
 *  - red family is the enemy, blue family is the player
 *  - deadly ground shows as dots, only near the player
 */
export class StageRenderer {
  ctx: CanvasRenderingContext2D;
  pal: Palette = paletteOf(null);
  camX = 0; camY = 0;
  /** 1 in play. The workbench can pull back to look at the whole map. */
  zoom = 1;
  private echoes: Echo[] = [];
  private flashes: Flash[] = [];
  private pfx: PlayerFx[] = [];
  private bassLine = { until: -1, tx: 0, ty: 0 };
  /** Steps of the dodge beats that were answered with a just dodge, for the clock. */
  private justs: number[] = [];
  /** Line widths are given in screen pixels: this undoes the camera's zoom. */
  private lw = 1;
  /** How far the camera has pulled back toward the overview (0..1). Small things are drawn larger there. */
  private far = 0;
  private cam = { x: 0, y: 0, z: 1, set: false, last: 0 };
  /** Spans of song time (in steps) during which the camera pulls back to show the whole map. */
  private overviews: [number, number][] = [];
  /** Places the camera goes to look at and then comes back from: [from step, until step, x, y]. A way that opened. */
  private visits: [number, number, number, number][] = [];
  private bounds = { x: 0, y: 0, r: 1 };
  private chunks = new Map<string, number[][][] | null>();
  private chunkVersion = -1;
  private built: StageSim | null = null;
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    const fit = (): void => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.floor(innerWidth * dpr);
      canvas.height = Math.floor(innerHeight * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    addEventListener('resize', fit);
  }

  get width(): number { return this.canvas.clientWidth; }
  get height(): number { return this.canvas.clientHeight; }

  setPalette(name: string | null | undefined): void { this.pal = paletteOf(name); }

  draw(s: StageSim, beatPhase: number, stepF: number, events: StageEvent[]): void {
    const c = this.ctx, w = this.width, h = this.height;
    const pulse = Math.exp(-beatPhase * 5);
    if (this.built !== s) { this.measure(s); this.built = s; }
    this.collect(s, stepF, events);

    this.moveCamera(s, stepF);
    const z = this.cam.z;
    this.lw = 1 / z;
    this.camX = this.cam.x - w / 2 / z;
    this.camY = this.cam.y - h / 2 / z;
    c.fillStyle = this.pal.bg;
    c.fillRect(0, 0, w, h);
    c.save();
    c.scale(z, z);
    c.translate(-this.camX, -this.camY);

    this.drawThings(s, stepF, pulse);
    this.drawField(s, stepF);
    this.drawGround(s);
    this.drawEmitters(s, stepF, pulse);
    this.drawPlayerFx(s, stepF);
    this.drawPlayer(s, stepF, pulse);
    this.drawApproach(s, stepF);
    c.restore();
    this.lw = 1;
    this.drawHud(s, pulse);
    this.drawClock(s, stepF);
  }

  private visible(x: number, y: number, pad = 60): boolean {
    const z = this.cam.z;
    return x > this.camX - pad && x < this.camX + this.width / z + pad && y > this.camY - pad && y < this.camY + this.height / z + pad;
  }

  /* ───────── the camera ───────── */

  /** Where the map is and how big, so the overview can hold all of it. */
  private measure(s: StageSim): void {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const sh of s.field.ground) for (const [x, y] of outline(sh, 40)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    this.bounds = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, r: Math.max(x1 - x0, y1 - y0) / 2 };
    this.chunks.clear();
    this.cam.set = false;
  }

  /**
   * Usually the camera follows the player. In a fight it holds the whole arena.
   * When a way opens, the camera goes to where it opened, stays a moment and comes back.
   * Only after the lives run out (starting again from the save) does it pull back to show the whole map.
   */
  private moveCamera(s: StageSim, stepF: number): void {
    const w = this.width, h = this.height, cam = this.cam, fight = s.fight;
    let tx = s.x, ty = s.y, tz = this.zoom;
    this.overviews = this.overviews.filter(o => stepF < o[1]);
    this.visits = this.visits.filter(v => stepF < v[1]);
    const visit = this.visits.find(v => stepF >= v[0]);
    if (this.overviews.some(o => stepF >= o[0])) {
      tx = this.bounds.x; ty = this.bounds.y; tz = Math.min(this.zoom, Math.min(w, h) / (this.bounds.r * 2.1));
    } else if (visit) {
      tx = visit[2]; ty = visit[3];
    } else if (fight) {
      tx = fight.x; ty = fight.y; tz = Math.min(this.zoom, Math.min(w, h) / (fight.r * 2.3));
    }
    const now = performance.now(), dt = cam.set ? Math.min(.1, (now - cam.last) / 1000) : 1;
    cam.last = now;
    const k = cam.set ? 1 - Math.exp(-dt * 3.2) : 1;
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k;
    cam.z = Math.exp(Math.log(cam.z) + (Math.log(tz) - Math.log(cam.z)) * k);
    cam.set = true;
    this.far = clamp((this.zoom / cam.z - 1.8) / 2.5);
  }

  /** How much larger than life a small thing is drawn while the camera is far away. */
  private get big(): number { return 1 + (.42 / this.cam.z - 1) * this.far; }

  /* ───────── events → effects ───────── */

  private collect(s: StageSim, stepF: number, events: StageEvent[]): void {
    const eq = this.pal.player[s.equipped ?? 'drum'];
    for (const e of events) {
      if (e.type === 'dash') {
        this.pfx.push({ kind: 'dash', at: stepF, x: e.from.x, y: e.from.y, x1: e.to.x, y1: e.to.y, strong: true });
        if (e.just) this.justs.push(Math.round(stepF - (e.offsetMs / 1000) / s.meter.secPerStep));
      } else if (e.type === 'special') {
        this.pfx.push({ kind: 'special', at: stepF, layer: e.layer, x: e.from.x, y: e.from.y, dx: e.dirX, dy: e.dirY });
      } else if (e.type === 'trigger') {
        this.pfx.push({ kind: 'ring', at: stepF, x: e.pos.x, y: e.pos.y, color: this.pal.just });
      } else if (e.type === 'absorb') {
        this.pfx.push({ kind: 'ring', at: stepF, x: s.x, y: s.y, color: eq });
      } else if (e.type === 'attack') {
        // A whiff is still shown, reaching only as far as the instrument can.
        const d = Math.hypot(e.to.x - e.from.x, e.to.y - e.from.y) || 1, k = e.hit ? 1 : Math.min(1, (ATTACK_RANGE_U[e.layer] * s.u) / d);
        const tx = e.from.x + (e.to.x - e.from.x) * k, ty = e.from.y + (e.to.y - e.from.y) * k;
        if (e.layer === 'drum') this.pfx.push({ kind: 'drum', at: stepF, x: e.from.x, y: e.from.y });
        else if (e.layer === 'hat') this.pfx.push({ kind: 'hat', at: stepF, x: e.from.x, y: e.from.y, tx, ty });
        else this.bassLine = { until: stepF + 1.4, tx, ty };
      } else if (e.type === 'hurt' || e.type === 'gameover') {
        // The camera pulls back to the whole map only when the lives ran out and the player starts again from the save.
        // A hit with lives left re-forms at a checkpoint and the camera keeps following.
        const spb = s.meter.stepsPerBeat;
        if (e.type === 'gameover') this.overviews.push([stepF + .3 * spb, stepF + 8 + .8 * spb]);
        this.pfx.push({ kind: 'dust', at: stepF, from: e.from, to: e.to, dur: 8 });
        this.pfx.push({ kind: 'ring', at: stepF, x: e.from.x, y: e.from.y, color: this.pal.danger });
        this.pfx.push({ kind: 'ring', at: stepF + 8, x: e.to.x, y: e.to.y, color: eq });
      } else if (e.type === 'part' || e.type === 'plate') {
        this.pfx.push({ kind: 'ring', at: stepF, x: s.x, y: s.y, color: this.pal.player[e.layer] });
      } else if (e.type === 'broken') {
        this.pfx.push({ kind: 'ring', at: stepF, x: e.pos.x, y: e.pos.y, color: this.pal.ink });
      } else if (e.type === 'gate') {
        // A way has opened: the camera goes there, stays a moment and comes back. A ring marks the place as it arrives.
        const g = s.gates.find(q => q.id === e.id);
        if (g) {
          const q = centreOf(g.shape), spb = s.meter.stepsPerBeat, color = g.requires.layer ? this.pal.player[g.requires.layer] : this.pal.ink;
          this.visits.push([stepF + .25 * spb, stepF + 4.25 * spb, q.x, q.y]);
          this.pfx.push({ kind: 'ring', at: stepF + 1.1 * spb, x: q.x, y: q.y, color });
          this.pfx.push({ kind: 'ring', at: stepF + 1.6 * spb, x: q.x, y: q.y, color });
        }
      } else if (e.type === 'strike') {
        // An attack has just landed: flash it and send out its echo.
        const a = e.inst;
        if (Math.hypot(a.x - s.x, a.y - s.y) > 1200) continue;
        if (e.step === a.hitStep) {
          this.flashes.push({ inst: a, at: e.step });
          if (a.def.shape.kind !== 'zone') this.echoes.push({ inst: a, at: e.step });
        }
        // A held zone leaves its wash when it finally lets go.
        if (a.def.shape.kind === 'zone' && e.step >= a.hitStep + a.hold) this.echoes.push({ inst: a, at: e.step });
      }
    }
    this.echoes = this.echoes.filter(e => (stepF - e.at) / 4 < ECHO[e.inst.layer].life + .8);
    this.flashes = this.flashes.filter(f => stepF - f.at < 2.6);
    this.pfx = this.pfx.filter(f => stepF - f.at < (f.kind === 'dust' ? f.dur + .5 : 6));
    this.justs = this.justs.filter(j => stepF - j < 8);
  }

  /* ───────── shapes ───────── */

  /** Trace an attack as a path. grow (0..1) is how far the plane has spread from where it starts. */
  private shapePath(a: Inst, grow = 1, pad = 0): void {
    const c = this.ctx, s = a.def.shape;
    c.beginPath();
    if (s.kind === 'circle') c.arc(a.x, a.y, Math.max(.5, s.r * grow), 0, TAU);
    else if (s.kind === 'ring') {
      c.arc(a.x, a.y, s.r0 + (s.r1 - s.r0) * grow, 0, TAU);
      c.arc(a.x, a.y, s.r0, 0, TAU, true);
    } else {
      const cx = Math.cos(a.rot), cy = Math.sin(a.rot);
      let x0: number, x1: number, hh: number;
      if (s.kind === 'beam') { x0 = 0; x1 = Math.min(s.len ?? 1100, 1100) * grow; hh = s.w / 2; }
      else {
        // Zones spread from the side nearest whatever made them.
        const lx = (a.x - a.sx) * cx + (a.y - a.sy) * cy, w = s.w * grow;
        if (lx >= 0) { x0 = -s.w / 2; x1 = x0 + w; } else { x1 = s.w / 2; x0 = x1 - w; }
        hh = s.h / 2;
        x0 -= pad; x1 += pad; hh += pad;
      }
      const pt = (x: number, y: number): [number, number] => [a.x + cx * x - cy * y, a.y + cy * x + cx * y];
      c.moveTo(...pt(x0, -hh)); c.lineTo(...pt(x1, -hh)); c.lineTo(...pt(x1, hh)); c.lineTo(...pt(x0, hh)); c.closePath();
    }
  }

  private shapeOutline(a: Inst): void {
    const c = this.ctx, s = a.def.shape;
    if (s.kind !== 'ring') { this.shapePath(a); return; }
    c.beginPath();
    c.arc(a.x, a.y, s.r1, 0, TAU);
    c.moveTo(a.x + s.r0, a.y);
    c.arc(a.x, a.y, s.r0, 0, TAU);
  }

  /**
   * One wave front of an echo, d pixels out from the attack's edge. It bounces off the edge of the ground like sound:
   * the front is never broken, it thins where it has been stretched around a corner, and every bounce weakens it.
   */
  private wave(sim: StageSim, a: Inst, d: number, alpha: number, width: number): void {
    const c = this.ctx, s = a.def.shape, f = sim.field;
    const fronts: { pts: [number, number, number][]; s0: number; closed: boolean }[] = [];
    const circle = (r: number, sg: number): void => {
      const N = Math.max(48, Math.min(200, Math.round((TAU * r) / 9))), pts: [number, number, number][] = [];
      for (let i = 0; i < N; i++) { const t = (i / N) * TAU; pts.push(f.travel(a.x + r * Math.cos(t), a.y + r * Math.sin(t), sg * Math.cos(t), sg * Math.sin(t), d)); }
      fronts.push({ pts, s0: (TAU * Math.max(6, Math.abs(r + sg * d))) / N, closed: true });
    };
    if (s.kind === 'circle') circle(s.r, 1);
    else if (s.kind === 'ring') { circle(s.r1, 1); circle(s.r0, -1); }
    else if (s.kind === 'beam') {
      const cx = Math.cos(a.rot), cy = Math.sin(a.rot);
      for (const sg of [1, -1]) {
        const pts: [number, number, number][] = [];
        for (let t = 0; t <= Math.min(s.len ?? 1100, 1100); t += 9) {
          const x = a.x + cx * t + cy * sg * s.w / 2, y = a.y + cy * t - cx * sg * s.w / 2;
          if (f.sd(x, y) <= 0) pts.push(f.travel(x, y, cy * sg, -cx * sg, d));
        }
        fronts.push({ pts, s0: 9, closed: false });
      }
    }
    const buckets = new Map<number, Path2D>();
    for (const fr of fronts) {
      const n = fr.pts.length, last = fr.closed ? n : n - 1;
      for (let i = 0; i < last; i++) {
        const p = fr.pts[i], q = fr.pts[(i + 1) % n], stretch = Math.hypot(q[0] - p[0], q[1] - p[1]) / fr.s0;
        if (stretch > 14) continue;       // split far apart around an obstacle: not joined (it would be all but invisible anyway)
        const k = Math.round(alpha * Math.min(1, 1.3 / Math.max(stretch, .01)) * BOUNCE ** Math.max(p[2], q[2]) * 40);
        if (k <= 0) continue;
        let path = buckets.get(k);
        if (!path) buckets.set(k, (path = new Path2D()));
        path.moveTo(p[0], p[1]); path.lineTo(q[0], q[1]);
      }
    }
    c.lineCap = 'round'; c.lineWidth = width * this.lw;
    for (const [k, path] of buckets) { c.globalAlpha = k / 40; c.stroke(path); }
  }

  /* ───────── the ground ───────── */

  /** The edge of the ground in one square of the map: the edge itself and two lines just inside it. Worked out once and kept. */
  private chunk(s: StageSim, cx: number, cy: number): number[][][] | null {
    const key = cx + ',' + cy;
    let ch = this.chunks.get(key);
    if (ch === undefined) {
      const x0 = cx * CHUNK, y0 = cy * CHUNK, mid = s.field.sd(x0 + CHUNK / 2, y0 + CHUNK / 2);
      // Far from any edge: nothing to draw here.
      ch = Math.abs(mid) > CHUNK * .75 + s.field.k + 12 ? null : s.field.contour(x0, y0, CHUNK, [0, -5, -10]);
      if (ch && !ch[0].length && !ch[2].length) ch = null;
      this.chunks.set(key, ch);
    }
    return ch;
  }

  private drawGround(s: StageSim): void {
    const c = this.ctx, px = s.x, py = s.y, z = this.cam.z;
    if (this.chunkVersion !== s.field.version) { this.chunks.clear(); this.chunkVersion = s.field.version; }
    const cx0 = Math.floor(this.camX / CHUNK), cy0 = Math.floor(this.camY / CHUNK);
    const cx1 = Math.floor((this.camX + this.width / z) / CHUNK), cy1 = Math.floor((this.camY + this.height / z) / CHUNK);
    const REACH = 120;
    c.save();
    c.strokeStyle = this.pal.ink;
    c.lineWidth = this.lw;
    c.lineCap = 'round';
    // The edge itself: one thin line in the ordinary colour.
    c.globalAlpha = .75;
    c.beginPath();
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const ch = this.chunk(s, cx, cy);
      if (ch) for (const g of ch[0]) { c.moveTo(g[0], g[1]); c.lineTo(g[2], g[3]); }
    }
    c.stroke();
    if (!s.reform && this.far < .5) {
      // Near the player, two faint lines appear just inside it.
      for (let cy = Math.floor((py - REACH) / CHUNK); cy <= Math.floor((py + REACH) / CHUNK); cy++) for (let cx = Math.floor((px - REACH) / CHUNK); cx <= Math.floor((px + REACH) / CHUNK); cx++) {
        const ch = this.chunk(s, cx, cy);
        if (!ch) continue;
        for (let i = 1; i <= 2; i++) for (const g of ch[i]) {
          const d = Math.hypot((g[0] + g[2]) / 2 - px, (g[1] + g[3]) / 2 - py);
          if (d > REACH) continue;
          c.globalAlpha = (.5 * (1 - d / REACH) ** 1.6) / i;
          c.beginPath(); c.moveTo(g[0], g[1]); c.lineTo(g[2], g[3]); c.stroke();
        }
      }
      // Deadly ground: dots, only where the player is close to it.
      c.fillStyle = this.pal.danger;
      const R = 150, gx = 16, gy = 13.9;
      for (let j = Math.floor((py - R) / gy); j * gy <= py + R; j++) for (let i = Math.floor((px - R) / gx); i * gx <= px + R; i++) {
        const x = i * gx + (j & 1 ? gx / 2 : 0), y = j * gy;
        const k = clamp(1 - Math.hypot(x - px, y - py) / R) ** 1.5;
        if (k < .03 || s.field.sd(x, y) < 4) continue;
        c.globalAlpha = .8 * k;
        c.beginPath(); c.arc(x, y, .5 + 3.2 * k, 0, TAU); c.fill();
      }
    }
    c.restore();
  }

  /** Pickups, plates, checkpoints, closed ways. Everything here moves on the beat. */
  private drawThings(s: StageSim, stepF: number, pulse: number): void {
    const c = this.ctx, pal = this.pal;
    const beatU = ((stepF / 4) % 1 + 1) % 1;
    c.save();
    for (const cp of s.checkpoints) {
      if (!this.visible(cp.x, cp.y)) continue;
      c.strokeStyle = pal.ink; c.lineWidth = (1) * this.lw; c.globalAlpha = .35; c.setLineDash([2, 4]);
      c.strokeRect(cp.x - 10.5, cp.y - 10.5, 21, 21); c.setLineDash([]);
    }
    for (const pad of s.plates) {
      if (!this.visible(pad.x, pad.y)) continue;
      // The boss's plates show only in the phrase that needs them.
      const enc = s.encounters.find(e => e.id === pad.encounter);
      if (enc && !(enc.running && enc.phrases[enc.index].shield)) continue;
      c.strokeStyle = c.fillStyle = pal.player[pad.layer];
      c.lineWidth = (1.25) * this.lw;
      c.globalAlpha = pad.lit ? .5 : .1;
      c.beginPath(); c.arc(pad.x, pad.y, pad.r, 0, TAU); c.fill();
      c.globalAlpha = 1;
      c.beginPath(); c.arc(pad.x, pad.y, pad.r, 0, TAU); c.stroke();
      if (!pad.lit && pad.count > 0) {
        c.lineWidth = (4) * this.lw;
        c.beginPath(); c.arc(pad.x, pad.y, pad.r + 7, -Math.PI / 2, -Math.PI / 2 + (TAU * pad.count) / s.meter.stepsPerBar); c.stroke();
      }
    }
    // A closed way shows what it is waiting for, as small marks.
    for (const g of s.gates) {
      if (g.open) continue;
      const marks: [string | null, boolean][] = [];
      for (const f of g.requires.flags ?? []) marks.push([s.plates.find(p => p.flag === f)?.layer ?? null, !!s.flags[f]]);
      if (g.requires.layer) marks.push([g.requires.layer, s.owned.includes(g.requires.layer)]);
      const q = centreOf(g.shape);
      if (!marks.length || !this.visible(q.x, q.y)) continue;
      marks.forEach(([layer, on], i) => {
        c.globalAlpha = on ? 1 : .35;
        c.fillStyle = c.strokeStyle = on && layer ? pal.player[layer as Instrument] : pal.ink;
        c.lineWidth = (1) * this.lw;
        c.beginPath(); c.arc(q.x + (i - (marks.length - 1) / 2) * 9, q.y, 3, 0, TAU);
        if (on) c.fill(); else c.stroke();
      });
    }
    for (const part of s.parts) {
      if (part.taken || !this.visible(part.x, part.y)) continue;
      const k = s.guardCleared(part) ? 1 : .35;
      c.fillStyle = c.strokeStyle = pal.player[part.layer];
      c.globalAlpha = k;
      c.beginPath(); c.arc(part.x, part.y, 11 * (1 + .1 * pulse) * this.big, 0, TAU); c.fill();
      c.lineWidth = (1) * this.lw; c.globalAlpha = .5 * (1 - beatU) * k;
      c.beginPath(); c.arc(part.x, part.y, (14 + 14 * easeOut(beatU)) * this.big, 0, TAU); c.stroke();
    }
    // From far away, the place the player returns to is marked.
    if (this.far > .3) {
      c.strokeStyle = pal.ink; c.globalAlpha = .8 * this.far; c.lineWidth = 1.2 * this.lw;
      const r = 13 * this.big;
      c.strokeRect(s.checkpoint.x - r, s.checkpoint.y - r, r * 2, r * 2);
    }
    c.restore();
  }

  /* ───────── attacks ───────── */

  /** Telegraphs, hits, held zones and echoes. */
  private drawField(s: StageSim, stepF: number): void {
    const c = this.ctx, pal = this.pal;
    c.save();
    for (const a of s.active) {
      if (!this.visible(a.x, a.y, 560)) continue;
      const color = pal.enemy[a.layer];
      c.fillStyle = c.strokeStyle = color;
      if (stepF < a.hitStep) {
        // Telegraph: the plane spreads steadily; its opacity climbs one step per 16th.
        const span = a.hitStep - a.start, pr = clamp((stepF - a.start) / span);
        const k = Math.min(span, Math.floor(pr * span) + 1);
        c.globalAlpha = .1; this.shapePath(a); c.fill('evenodd');
        c.globalAlpha = .16 + .44 * (k / span); this.shapePath(a, pr); c.fill('evenodd');
        // A strike that does not fall on a dodge beat cannot be dodged: its outline is dotted, walk out of it.
        const bar = s.meter.stepsPerBar, off = !s.meter.dodgeSteps.includes(((a.hitStep % bar) + bar) % bar);
        if (off) c.setLineDash([3, 4]);
        c.globalAlpha = off ? .9 : .5; c.lineWidth = (off ? 1.3 : 1.25) * this.lw; this.shapeOutline(a); c.stroke();
        c.setLineDash([]);
      } else if (a.hold > 0) {
        // Held zones do not just sit there: they dip, then climb again toward the next beat, when they strike again.
        const u = (((stepF - a.hitStep) / 4) % 1 + 1) % 1, k = Math.floor(u * 4) + 1;
        c.globalAlpha = u < .1 ? 1 : .34 + .12 * k; this.shapePath(a); c.fill();
        c.globalAlpha = .9; c.lineWidth = (1.5) * this.lw; this.shapePath(a); c.stroke();
      }
    }
    // The hit itself: the plane, full, then gone.
    for (const f of this.flashes) {
      const x = (stepF - f.at) / 4;
      if (x < 0 || x > .6 || (f.inst.def.shape.kind === 'zone' && x > .05)) continue;
      c.fillStyle = pal.enemy[f.inst.layer];
      c.globalAlpha = x < .1 ? 1 : .88 * (1 - clamp((x - .1) / .5));
      this.shapePath(f.inst); c.fill('evenodd');
    }
    // Echoes.
    for (const e of this.echoes) {
      const a = e.inst, E = ECHO[a.layer], age = (stepF - e.at) / 4;
      if (age < 0) continue;
      if (a.def.shape.kind === 'zone') {
        // Bass leaves no lines: the whole area stays as a very faint tint whose edge dissolves outward.
        const B = ECHO.bass, te = age / B.life;
        if (te >= 1) continue;
        const d = 16 + te ** .9 * 260;
        c.fillStyle = pal.enemy[a.layer];
        const al = B.alpha * Math.min(1, te / .12) * (1 - te) ** 1.4;
        c.globalAlpha = al; this.shapePath(a); c.fill();
        for (let i = 1; i <= 10; i++) {
          c.globalAlpha = (al * (1 - i / 11) ** 1.6) / 2.2;
          this.shapePath(a, 1, (d * i) / 10); c.fill();
        }
        continue;
      }
      if (!E.lines) continue;
      if (!this.visible(a.x, a.y, 700)) continue;
      c.strokeStyle = pal.enemy[a.layer];
      for (let k = 0; k < E.lines; k++) {
        const te = (age - k * E.gap) / E.life;
        if (te <= 0 || te >= 1) continue;
        this.wave(s, a, 2 + easeOut(te) * E.dist * (1 + k * .12), E.alpha * (1 - te) ** 1.4, E.w * (1 - te * .35));
      }
    }
    c.restore();
  }

  /** A closed lump whose radius differs a little at every angle. amp is how much it sways, t how far it has flowed. */
  private blobPath(x: number, y: number, R: number, seed: number, t: number, amp: number): void {
    const c = this.ctx, N = 72, pts: [number, number][] = [];
    const rnd = (a: number, b: number): number => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };
    for (let i = 0; i < N; i++) {
      const th = (i / N) * TAU;
      let r = 1;
      for (let k = 2; k <= 5; k++) r += ((amp * (rnd(seed, k) - .3) * .55) / (k - 1)) * Math.sin(k * th + rnd(seed, k + 9) * TAU + t * (.25 + .12 * k) * (rnd(seed, k + 3) < .5 ? 1 : -1));
      pts.push([x + Math.cos(th) * R * r, y + Math.sin(th) * R * r]);
    }
    const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    c.beginPath();
    c.moveTo(...mid(pts[N - 1], pts[0]));
    for (let i = 0; i < N; i++) { const q = mid(pts[i], pts[(i + 1) % N]); c.quadraticCurveTo(pts[i][0], pts[i][1], q[0], q[1]); }
    c.closePath();
  }

  /**
   * Everything that attacks. Guardians and the boss are overlapping planes: soft lumps in the enemy's colours and in ink,
   * flowing over each other, with small discs drifting around. The body breathes on the beat, draws in just before an attack and sways after it.
   */
  private drawEmitters(s: StageSim, stepF: number, pulse: number): void {
    const c = this.ctx, pal = this.pal, spb = s.meter.stepsPerBeat, b = stepF / spb;
    c.save();
    for (const em of s.emitters) {
      if (em.broken || em.hidden || !this.visible(em.x, em.y, 120)) continue;
      c.globalAlpha = 1; c.setLineDash([]);
      const enc = s.encounterOf(em);
      if (!enc) { this.drawSmall(em, pulse); continue; }
      const ph = enc.phrases[enc.index], awake = enc.running;
      const open = awake && !!ph.openBars?.includes(Math.floor((Math.floor(stepF) - enc.phraseStart) / s.meter.stepsPerBar));
      let gather = 0, wob = 0;
      for (const a of s.active) {
        if (a.src !== em.id) continue;
        const d = (a.hitStep - stepF) / spb;
        if (d > 0 && d < .25) gather = Math.max(gather, 1 - d / .25);
      }
      for (const f of this.flashes) { const e = (stepF - f.at) / spb; if (f.inst.src === em.id && e >= 0 && e < 1.2) wob = Math.max(wob, Math.exp(-e * 3.5)); }
      const R = em.body * 1.45, scale = 1 + .02 * pulse - .035 * gather + .025 * wob, amp = awake ? .55 - .3 * gather + .5 * wob : .3, t = b * .35;
      const colour = { e1: pal.enemy.drum, e2: pal.enemy.hat, e3: pal.enemy.bass, ink: pal.ink };
      const layers: [keyof typeof colour, number, number, number, number][] = [['e3', -.22, -.16, 1, 11], ['e1', .12, .05, .86, 12], ['e2', .3, .3, .5, 13], ['ink', -.1, .38, .62, 14]];
      // While it can be hurt more, it thins out; asleep, it is fainter still.
      const body = !awake ? .55 : open ? .7 : 1;
      for (const [col, ox, oy, rr, seed] of layers) {
        c.fillStyle = colour[col]; c.globalAlpha = body;
        this.blobPath(em.x + ox * R, em.y + oy * R, R * rr * scale, seed + em.id.length, t, amp);
        c.fill();
      }
      (['ink', 'e3', 'e2', 'ink'] as const).forEach((col, i) => {
        const a = t * .4 + i * 1.7, d = R * (1.35 + .15 * Math.sin(t + i));
        c.fillStyle = colour[col]; c.globalAlpha = body;
        c.beginPath(); c.arc(em.x + Math.cos(a) * d, em.y + Math.sin(a) * d, R * [.13, .07, .05, .09][i], 0, TAU); c.fill();
      });
      // Health: a thin arc around it. A notch marks where this phrase ends.
      const H = R * 1.75;
      c.strokeStyle = pal.ink;
      c.globalAlpha = .18; c.lineWidth = 2 * this.lw; c.beginPath(); c.arc(em.x, em.y, H, 0, TAU); c.stroke();
      c.globalAlpha = awake ? 1 : .5; c.beginPath(); c.arc(em.x, em.y, H, -Math.PI / 2, -Math.PI / 2 + TAU * (em.hp / Math.max(1, em.maxHp))); c.stroke();
      const gate = ph.advance?.hpBelow;
      if (gate !== undefined && gate > 0) {
        const a = -Math.PI / 2 + TAU * gate;
        c.strokeStyle = pal.bg; c.globalAlpha = 1; c.lineWidth = 2.5 * this.lw;
        c.beginPath(); c.moveTo(em.x + Math.cos(a) * (H - 5), em.y + Math.sin(a) * (H - 5)); c.lineTo(em.x + Math.cos(a) * (H + 5), em.y + Math.sin(a) * (H + 5)); c.stroke();
        c.strokeStyle = pal.ink;
      }
      if (awake && ph.shield && !s.solved(enc)) { c.globalAlpha = 1; c.lineWidth = 1.25 * this.lw; c.setLineDash([3, 5]); c.beginPath(); c.arc(em.x, em.y, H + 10, 0, TAU); c.stroke(); c.setLineDash([]); }
      // The instrument this phrase is weak to, in the player's colour.
      if (ph.weakTo) { c.globalAlpha = 1; c.fillStyle = pal.player[ph.weakTo]; c.beginPath(); c.arc(em.x, em.y - H - 14, 3.5, 0, TAU); c.fill(); }
      // Just dodges answered in a row, for a guardian that can be passed that way.
      const need = ph.advance?.answered ?? 0;
      for (let i = 0; i < need; i++) {
        const on = awake && i < s.streak;
        c.fillStyle = c.strokeStyle = on ? pal.just : pal.ink; c.lineWidth = this.lw; c.globalAlpha = on ? 1 : .45;
        c.beginPath(); c.arc(em.x + (i - (need - 1) / 2) * 10, em.y + H + 16, 3, 0, TAU);
        if (on) c.fill(); else c.stroke();
      }
    }
    c.restore();
  }

  /** Devices and monsters. New here (the validation build had neither): kept to the same few marks. */
  private drawSmall(em: Emitter, pulse: number): void {
    const c = this.ctx, pal = this.pal;
    if (em.kind === 'device') {
      c.strokeStyle = pal.ink; c.lineWidth = (1) * this.lw; c.globalAlpha = .6;
      c.beginPath(); c.arc(em.x, em.y, 12, 0, TAU); c.stroke();
      c.beginPath(); c.arc(em.x, em.y, 4, 0, TAU); c.stroke();
    } else {
      const r = 9 * (1 + .09 * pulse);
      c.fillStyle = pal.ink; c.beginPath(); c.arc(em.x, em.y, r, 0, TAU); c.fill();
      c.fillStyle = pal.enemy.drum; c.beginPath(); c.moveTo(em.x, em.y); c.arc(em.x, em.y, r, -Math.PI / 2, 0); c.closePath(); c.fill();
    }
  }

  /* ───────── the player ───────── */

  private drawPlayerFx(s: StageSim, stepF: number): void {
    const c = this.ctx, pal = this.pal, eq = pal.player[s.equipped ?? 'drum'];
    c.save();
    for (const f of this.pfx) {
      const age = (stepF - f.at) / 4;       // beats
      if (age < 0) continue;
      c.globalAlpha = 1; c.setLineDash([]);
      if (f.kind === 'dash') {
        if (age > 1.2) continue;
        const dx = f.x1 - f.x, dy = f.y1 - f.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, k = age / 1.2, st = f.strong ? 1 : .45;
        c.strokeStyle = c.fillStyle = eq;
        c.globalAlpha = .8 * st * (1 - k) ** 1.5; c.lineWidth = (1.5 - k) * this.lw;
        c.beginPath(); c.arc(f.x, f.y, 12 + 34 * st * easeOut(k), 0, TAU); c.stroke();
        for (let i = 1; i <= 5; i++) { const t = i / 6; c.globalAlpha = .34 * st * t * (1 - clamp(age / .7)) ** 1.2; c.beginPath(); c.arc(f.x + dx * t, f.y + dy * t, PLAYER_R * .8 * (.55 + .45 * t), 0, TAU); c.fill(); }
        c.lineWidth = (1) * this.lw; c.globalAlpha = .55 * st * (1 - clamp(age / .6));
        if (L > 30) for (const o of [-9, 0, 9]) { c.beginPath(); c.moveTo(f.x - uy * o + ux * 6, f.y + ux * o + uy * 6); c.lineTo(f.x1 - uy * o - ux * 14, f.y1 + ux * o - uy * 14); c.stroke(); }
      } else if (f.kind === 'drum') {
        if (age > .9) continue;
        const k = age / .9, R = ATTACK_RANGE_U.drum * s.u * easeOut(clamp(age / .25));
        c.strokeStyle = c.fillStyle = pal.player.drum;
        c.globalAlpha = .22 * (1 - k) ** 2; c.beginPath(); c.arc(f.x, f.y, R, 0, TAU); c.fill();
        c.globalAlpha = .9 * (1 - k) ** 1.3; c.lineWidth = (2.2 - 1.4 * k) * this.lw; c.beginPath(); c.arc(f.x, f.y, R + 10 * k, 0, TAU); c.stroke();
      } else if (f.kind === 'hat') {
        if (age > .6) continue;
        const dx = f.tx - f.x, dy = f.ty - f.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
        const head = Math.min(L, L * (age / .22)), tail = Math.max(0, head - 38);
        c.strokeStyle = pal.player.hat; c.lineCap = 'round';
        if (age < .22) { c.globalAlpha = .95; c.lineWidth = (2) * this.lw; c.beginPath(); c.moveTo(f.x + ux * tail, f.y + uy * tail); c.lineTo(f.x + ux * head, f.y + uy * head); c.stroke(); }
        else {
          const k = (age - .22) / .38; c.globalAlpha = .8 * (1 - k); c.lineWidth = (1.2) * this.lw;
          for (const a of [-1.1, 0, 1.1]) { const cc = Math.cos(a) * -ux - Math.sin(a) * -uy, ss = Math.sin(a) * -ux + Math.cos(a) * -uy; c.beginPath(); c.moveTo(f.tx + cc * 4, f.ty + ss * 4); c.lineTo(f.tx + cc * (6 + 12 * k), f.ty + ss * (6 + 12 * k)); c.stroke(); }
        }
      } else if (f.kind === 'special') {
        // The special attack: the instrument's own shape, large, in the player's colour with a just-coloured edge.
        if (age > 1.2) continue;
        const k = age / 1.2, col = pal.player[f.layer];
        c.fillStyle = col; c.strokeStyle = pal.just;
        if (f.layer === 'drum') {
          const R = SPECIAL.drum.r * s.u * easeOut(clamp(age / .2));
          c.globalAlpha = .4 * (1 - k) ** 2; c.beginPath(); c.arc(f.x, f.y, R, 0, TAU); c.fill();
          c.globalAlpha = (1 - k) ** 1.3; c.lineWidth = (3 - 2 * k) * this.lw; c.beginPath(); c.arc(f.x, f.y, R + 14 * k, 0, TAU); c.stroke();
        } else if (f.layer === 'hat') {
          const L = SPECIAL.hat.len * s.u * easeOut(clamp(age / .15)), hw = (SPECIAL.hat.w / 2) * s.u * (1 - k);
          c.globalAlpha = .7 * (1 - k) ** 1.5;
          c.beginPath(); c.moveTo(f.x - f.dy * hw, f.y + f.dx * hw); c.lineTo(f.x + f.dx * L, f.y + f.dy * L); c.lineTo(f.x + f.dy * hw, f.y - f.dx * hw); c.closePath(); c.fill();
          c.globalAlpha = (1 - k) ** 1.3; c.lineWidth = 2 * this.lw; c.beginPath(); c.moveTo(f.x, f.y); c.lineTo(f.x + f.dx * L, f.y + f.dy * L); c.stroke();
        }
      } else if (f.kind === 'ring') {
        if (age > .9) continue;
        c.strokeStyle = f.color; c.lineWidth = (2 - 1.4 * (age / .9)) * this.lw; c.globalAlpha = .9 * (1 - age / .9) ** 1.4;
        c.beginPath(); c.arc(f.x, f.y, 12 + 40 * easeOut(age / .9), 0, TAU); c.stroke();
      } else {
        this.drawDust(f.from, f.to, age, f.dur / 4, stepF / 4);
      }
    }
    // The bass special: a pool that dips and climbs back to each beat, when it strikes again.
    for (const p of s.pools) {
      const u = ((stepF / s.meter.stepsPerBeat) % 1 + 1) % 1, left = clamp((p.until - stepF) / s.meter.stepsPerBeat);
      c.fillStyle = pal.player.bass; c.strokeStyle = pal.just; c.setLineDash([]);
      c.globalAlpha = (u < .1 ? .5 : .14 + .05 * (Math.floor(u * 4) + 1)) * Math.min(1, left * 2);
      c.beginPath(); c.arc(p.x, p.y, p.r, 0, TAU); c.fill();
      c.globalAlpha = .8 * Math.min(1, left * 2); c.lineWidth = 1.4 * this.lw; c.beginPath(); c.arc(p.x, p.y, p.r, 0, TAU); c.stroke();
    }
    // The bass attack is a held string, trembling for as long as the note sounds.
    if (stepF < this.bassLine.until && s.equipped === 'bass' && !s.reform) {
      const on = clamp((this.bassLine.until - stepF) / 1.2), dx = this.bassLine.tx - s.x, dy = this.bassLine.ty - s.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
      c.strokeStyle = pal.player.bass; c.lineCap = 'round';
      for (const [amp, a, w] of [[5, .85, 1.6], [9, .4, 1], [13, .22, 1]]) {
        c.globalAlpha = a * on; c.lineWidth = (w) * this.lw; c.beginPath();
        for (let i = 0; i <= 40; i++) { const u = i / 40, o = Math.sin(u * 16 - s.time * 9) * amp * Math.sin(u * Math.PI); const px = s.x + dx * u - uy * o, py = s.y + dy * u + ux * o; if (i) c.lineTo(px, py); else c.moveTo(px, py); }
        c.stroke();
      }
    }
    c.restore();
  }

  /**
   * The player as dust. Scatter and gather are one movement: fast out, slowing,
   * then gathering speed and arriving fast. It never stands still.
   */
  private drawDust(from: V, to: V, age: number, dur: number, beat: number): void {
    const c = this.ctx;
    const bump = (x: number): number => (x < .22 ? Math.sin((x / .22) * Math.PI / 2) : Math.exp(-(x - .22) * 5.5));
    c.fillStyle = this.pal.ink;
    for (const g of GRAINS) {
      const u = clamp(age / (dur * (1 + g.lag * .22) / 1.09));
      const out = (1 - (1 - clamp(u / .55)) ** 4) * 1.45, pull = u ** 2.6;
      const pos = beat * g.sub, tick = g.tw && Math.floor(pos) % g.sub === g.slot % g.sub ? bump(pos - Math.floor(pos)) * g.amp * Math.min(1, out) * (1 - pull) : 0;
      const fx = from.x + g.ox + g.dx * g.far * out + Math.cos(beat * 2.4 + g.drift) * 2.2 * Math.min(1, out) + g.dx * tick;
      const fy = from.y + g.oy + g.dy * g.far * out + Math.sin(beat * 2 + g.drift) * 2.2 * Math.min(1, out) + g.dy * tick;
      const tx = to.x + g.ox, ty = to.y + g.oy, vx = fx - tx, vy = fy - ty;
      const ang = g.spin * pull * (1 - pull) * .55, cs = Math.cos(ang), sn = Math.sin(ang);
      const loose = Math.min(1, out) * (1 - pull);
      c.globalAlpha = 1 - .4 * loose;
      c.beginPath(); c.arc(tx + (vx * cs - vy * sn) * (1 - pull), ty + (vx * sn + vy * cs) * (1 - pull), g.size * (1 - .22 * loose), 0, TAU); c.fill();
    }
    c.globalAlpha = 1;
  }

  private drawPlayer(s: StageSim, _stepF: number, pulse: number): void {
    const c = this.ctx, pal = this.pal;
    if (s.reform) return;       // scattered: the dust is the player
    const m = this.big, r = PLAYER_R * .8 * (1 + .12 * pulse) * m, R = (PLAYER_R + 4) * m;
    const ring = s.equipped ? pal.player[s.equipped] : pal.ink;
    c.save();
    if (s.dash?.just) {
      // A just dodge: the body goes transparent and takes the just colour for the whole dash.
      c.strokeStyle = c.fillStyle = pal.just;
      c.lineWidth = 1.6 * this.lw; c.beginPath(); c.arc(s.x, s.y, R, 0, TAU); c.stroke();
      c.globalAlpha = .22; c.beginPath(); c.arc(s.x, s.y, r, 0, TAU); c.fill();
      c.globalAlpha = .9; c.lineWidth = 1.2 * this.lw; c.beginPath(); c.arc(s.x, s.y, r, 0, TAU); c.stroke();
    } else {
      c.strokeStyle = ring;
      c.lineWidth = (s.equipped ? 1.5 : 1) * this.lw;
      c.beginPath(); c.arc(s.x, s.y, R, 0, TAU); c.stroke();
      if (s.dash) {
        // Invulnerable for the length of the dash: the body empties, only its outline is left.
        c.strokeStyle = pal.ink; c.lineWidth = 1.3 * this.lw; c.beginPath(); c.arc(s.x, s.y, r, 0, TAU); c.stroke();
      } else { c.fillStyle = pal.ink; c.beginPath(); c.arc(s.x, s.y, r, 0, TAU); c.fill(); }
    }
    if (s.charged) {
      // A special attack is charged and waiting for its key.
      c.strokeStyle = pal.just; c.globalAlpha = .9; c.lineWidth = 1.4 * this.lw;
      c.beginPath(); c.arc(s.x, s.y, R + 4 * m + 1.5 * pulse, 0, TAU); c.stroke();
    }
    c.restore();
  }

  /* ───────── the beat ───────── */

  /** Dodge beats near step b: the one just passed and those within the next beat. */
  private dodgeBeats(s: StageSim, from: number, to: number): number[] {
    const bar = s.meter.stepsPerBar, out: number[] = [];
    for (let k = Math.floor(from / bar) - 1; k <= Math.floor(to / bar) + 1; k++) for (const d of s.meter.dodgeSteps) { const t = k * bar + d; if (t > from && t <= to) out.push(t); }
    return out;
  }

  /** Around the body: for every dodge beat a ring closes in from one beat away, darkening one step per 16th. The enemy spreads as planes; the player's beat closes in as a line. */
  private drawApproach(s: StageSim, stepF: number): void {
    if (s.reform) return;
    const c = this.ctx, spb = s.meter.stepsPerBeat, R = PLAYER_R + 5;
    c.save();
    c.strokeStyle = this.pal.player[s.equipped ?? 'drum'];
    for (const t of this.dodgeBeats(s, stepF, stepF + spb)) {
      const left = (t - stepF) / spb, k = Math.floor((1 - left) * 4) + 1;
      c.globalAlpha = .12 + (.5 * k) / 4; c.lineWidth = (1.1) * this.lw;
      c.beginPath(); c.arc(s.x, s.y, R + 44 * left, 0, TAU); c.stroke();
    }
    const prev = this.dodgeBeats(s, stepF - spb, stepF).pop();
    if (prev !== undefined) {
      const since = (stepF - prev) / spb;
      if (since < .3) { c.globalAlpha = .85 * (1 - since / .3); c.lineWidth = (2) * this.lw; c.beginPath(); c.arc(s.x, s.y, R + 10 * easeOut(since / .3), 0, TAU); c.stroke(); }
    }
    c.restore();
  }

  /**
   * Bottom centre: the arch clock. The line at twelve o'clock never moves; the disc turns under it.
   * Dodge beats are dots on the disc, and a dot crossing the line is the beat. One answered with a just dodge stays green for a moment.
   */
  private drawClock(s: StageSim, stepF: number): void {
    const c = this.ctx, pal = this.pal, m = s.meter, spb = m.stepsPerBeat, w = this.width, h = this.height;
    const k = Math.max(1.4, Math.min(2.2, Math.min(w / 640, h / 360)));     // drawn in the mock-up's units, then scaled
    const REV = m.stepsPerBar * REV_BARS, y = 2, R = 50, p1 = pal.player[s.equipped ?? 'drum'];
    const ang = (t: number): number => -Math.PI / 2 + ((t - stepF) / REV) * TAU;       // what is coming is on the right, what has passed on the left
    c.save();
    c.translate(w / 2, h);
    c.scale(k, k);
    c.lineWidth = 1; c.strokeStyle = c.fillStyle = pal.ink;
    // The disc: three arches, and beat marks that turn with it.
    for (const [r, a] of [[R, .6], [R - 7, .2], [R - 14, .12]]) { c.globalAlpha = a; c.beginPath(); c.arc(0, y, r, Math.PI, TAU); c.stroke(); }
    for (let t = Math.ceil((stepF - REV / 2) / spb) * spb; t <= stepF + REV / 2; t += spb) {
      const a = ang(t);
      if (Math.sin(a) > 0) continue;
      const bar = ((t % m.stepsPerBar) + m.stepsPerBar) % m.stepsPerBar === 0, len = bar ? 14 : 7;
      c.globalAlpha = bar ? .5 : .25;
      c.beginPath(); c.moveTo(Math.cos(a) * (R - len), y + Math.sin(a) * (R - len)); c.lineTo(Math.cos(a) * R, y + Math.sin(a) * R); c.stroke();
    }
    for (const t of this.dodgeBeats(s, stepF - REV / 2, stepF + REV / 2)) {
      const a = ang(t);
      if (Math.sin(a) > 0) continue;
      const px = Math.cos(a) * R, py = y + Math.sin(a) * R;
      const j = this.justs.find(q => q === t), f = j === undefined ? 0 : Math.max(0, 1 - (stepF - j) / (1.5 * spb));
      c.globalAlpha = 1; c.fillStyle = pal.bg; c.beginPath(); c.arc(px, py, 4.5, 0, TAU); c.fill();
      c.fillStyle = f > 0 ? pal.just : p1; c.globalAlpha = f > 0 ? .4 + .6 * f : t < stepF ? .3 : .9;
      c.beginPath(); c.arc(px, py, f > 0 ? 4.2 : 3.2, 0, TAU); c.fill();
    }
    // The line at twelve o'clock: it does not move.
    c.strokeStyle = pal.ink; c.globalAlpha = .9; c.lineWidth = 1.4;
    c.beginPath(); c.moveTo(0, y - R - 7); c.lineTo(0, y - R + 9); c.stroke();
    c.restore();
  }

  /** Screen space: lives and the instruments in hand. No words. */
  private drawHud(s: StageSim, pulse: number): void {
    const c = this.ctx, pal = this.pal;
    c.save();
    c.fillStyle = c.strokeStyle = pal.ink; c.lineWidth = 1.25;
    for (let i = 0; i < s.maxLives; i++) {
      c.globalAlpha = i < s.lives ? 1 : .45;
      c.beginPath(); c.arc(30 + i * 16, 30, 4.5, 0, TAU);
      if (i < s.lives) c.fill(); else c.stroke();
    }
    (['drum', 'hat', 'bass'] as Instrument[]).forEach((inst, i) => {
      const owned = s.owned.includes(inst), eq = s.equipped === inst, x = 31 + i * 20, y = 56;
      c.globalAlpha = owned ? 1 : .35;
      c.fillStyle = c.strokeStyle = owned ? pal.player[inst] : pal.ink;
      c.beginPath(); c.arc(x, y, eq ? 6.5 + pulse : 5, 0, TAU);
      if (owned) c.fill(); else c.stroke();
      if (eq) { c.strokeStyle = pal.ink; c.globalAlpha = .8; c.beginPath(); c.moveTo(x - 6, y + 12); c.lineTo(x + 6, y + 12); c.stroke(); }
    });
    c.restore();
  }
}
