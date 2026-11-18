import { LayerId } from '../core/music/song';
import { centreOf, outline } from '../core/stage/shapes';
import { ATTACK_RANGE_U, Emitter, Inst, Instrument, StageEvent, StageSim, V } from '../core/stage/sim';
import { Palette, paletteOf } from './theme';

const TAU = Math.PI * 2;
const clamp = (v: number, a = 0, b = 1): number => Math.max(a, Math.min(b, v));
const easeOut = (t: number): number => 1 - (1 - t) ** 3;
const PLAYER_R = 10;
const EDGE_STEP = 10;

/** How an attack's echo spreads, by the layer it rides on. Lengths are in beats and pixels. */
const ECHO: Record<LayerId, { dist: number; lines: number; life: number; alpha: number; w: number; gap: number }> = {
  hat: { dist: 16, lines: 1, life: .6, alpha: .8, w: 1.2, gap: .15 },
  drum: { dist: 95, lines: 2, life: 1.3, alpha: .7, w: 1.3, gap: .2 },
  lead: { dist: 70, lines: 2, life: 1.1, alpha: .7, w: 1.3, gap: .2 },
  pad: { dist: 70, lines: 2, life: 1.1, alpha: .7, w: 1.3, gap: .2 },
  bass: { dist: 0, lines: 0, life: 3.4, alpha: .17, w: 0, gap: 0 },
};

/** A point on an attack's edge, the way it travels, how far until it meets the edge of the ground, and the way it bounces. null breaks the line. */
type FrontPt = [number, number, number, number, number, number, number] | null;
interface Echo { inst: Inst; at: number; fronts: FrontPt[][] | null }
interface Flash { inst: Inst; at: number }
type PlayerFx =
  | { kind: 'dash'; at: number; x: number; y: number; x1: number; y1: number; strong: boolean }
  | { kind: 'drum'; at: number; x: number; y: number }
  | { kind: 'hat'; at: number; x: number; y: number; tx: number; ty: number }
  | { kind: 'ring'; at: number; x: number; y: number; color: string }
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
  /** The edge of the ground as long lines, and as points with the direction that leads into the ground. */
  private runs: { x0: number; y0: number; x1: number; y1: number; pts: number[] }[] = [];
  private edgePts: [number, number, number, number][] = [];
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
    if (this.built !== s) { this.buildEdges(s); this.built = s; }
    this.collect(s, stepF, events);

    this.camX = s.x - w / 2 / this.zoom;
    this.camY = s.y - h / 2 / this.zoom;
    c.fillStyle = this.pal.bg;
    c.fillRect(0, 0, w, h);
    c.save();
    c.scale(this.zoom, this.zoom);
    c.translate(-Math.round(this.camX), -Math.round(this.camY));

    this.drawThings(s, stepF, pulse);
    this.drawField(s, stepF);
    this.drawGround(s);
    this.drawEmitters(s, stepF, pulse);
    this.drawPlayerFx(s, stepF);
    this.drawPlayer(s, stepF, pulse);
    c.restore();
    this.drawHud(s, pulse);
  }

  private visible(x: number, y: number, pad = 60): boolean {
    return x > this.camX - pad && x < this.camX + this.width / this.zoom + pad && y > this.camY - pad && y < this.camY + this.height / this.zoom + pad;
  }

  /* ───────── events → effects ───────── */

  private collect(s: StageSim, stepF: number, events: StageEvent[]): void {
    const eq = this.pal.player[s.equipped ?? 'drum'];
    for (const e of events) {
      if (e.type === 'dash') {
        this.pfx.push({ kind: 'dash', at: stepF, x: e.from.x, y: e.from.y, x1: e.to.x, y1: e.to.y, strong: true });
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
        this.pfx.push({ kind: 'dust', at: stepF, from: e.from, to: e.to, dur: 8 });
        this.pfx.push({ kind: 'ring', at: stepF, x: e.from.x, y: e.from.y, color: this.pal.danger });
        this.pfx.push({ kind: 'ring', at: stepF + 8, x: e.to.x, y: e.to.y, color: eq });
      } else if (e.type === 'part' || e.type === 'plate') {
        this.pfx.push({ kind: 'ring', at: stepF, x: s.x, y: s.y, color: this.pal.player[e.layer] });
      } else if (e.type === 'broken') {
        this.pfx.push({ kind: 'ring', at: stepF, x: e.pos.x, y: e.pos.y, color: this.pal.ink });
      } else if (e.type === 'gate') {
        this.buildEdges(s);
      } else if (e.type === 'strike') {
        // An attack has just landed: flash it and send out its echo.
        const a = e.inst;
        if (Math.hypot(a.x - s.x, a.y - s.y) > 1200) continue;
        if (e.step === a.hitStep) {
          this.flashes.push({ inst: a, at: e.step });
          if (a.def.shape.kind !== 'zone') this.echoes.push({ inst: a, at: e.step, fronts: null });
        }
        // A held zone leaves its wash when it finally lets go.
        if (a.def.shape.kind === 'zone' && e.step >= a.hitStep + a.hold) this.echoes.push({ inst: a, at: e.step, fronts: null });
      }
    }
    this.echoes = this.echoes.filter(e => (stepF - e.at) / 4 < ECHO[e.inst.layer].life + .8);
    this.flashes = this.flashes.filter(f => stepF - f.at < 2.6);
    this.pfx = this.pfx.filter(f => stepF - f.at < (f.kind === 'dust' ? f.dur + .5 : 6));
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

  /** Points on an attack's edge and the way each travels. A point that meets the edge of the ground bounces off it. */
  private fronts(sim: StageSim, a: Inst): FrontPt[][] {
    const s = a.def.shape, raw: [number, number, number, number][][] = [];
    const circle = (r: number, sg: number): [number, number, number, number][] => {
      const f: [number, number, number, number][] = [];
      for (let i = 0; i <= 96; i++) { const t = (i / 96) * TAU; f.push([a.x + r * Math.cos(t), a.y + r * Math.sin(t), sg * Math.cos(t), sg * Math.sin(t)]); }
      return f;
    };
    if (s.kind === 'circle') raw.push(circle(s.r, 1));
    else if (s.kind === 'ring') raw.push(circle(s.r1, 1), circle(s.r0, -1));
    else if (s.kind === 'beam') {
      const cx = Math.cos(a.rot), cy = Math.sin(a.rot);
      for (const sg of [1, -1]) {
        const f: [number, number, number, number][] = [];
        for (let t = 0; t <= Math.min(s.len ?? 1100, 1100); t += 7) f.push([a.x + cx * t + cy * sg * s.w / 2, a.y + cy * t - cx * sg * s.w / 2, cy * sg, -cx * sg]);
        raw.push(f);
      }
    }
    const E = ECHO[a.layer], far = 2 + E.dist * (1 + E.lines * .12) + 4;
    return raw.map(f => f.map(([x, y, vx, vy]): FrontPt => {
      if (!sim.isGround(x, y)) return null;
      for (let d = 4; d <= far; d += 4) {
        if (sim.isGround(x + vx * d, y + vy * d)) continue;
        // Which way is ground, seen from the place it met the edge.
        const hit = d - 4, hx = x + vx * hit, hy = y + vy * hit;
        let nx = 0, ny = 0;
        for (let i = 0; i < 12; i++) { const t = (i * TAU) / 12; if (sim.isGround(hx + Math.cos(t) * 9, hy + Math.sin(t) * 9)) { nx += Math.cos(t); ny += Math.sin(t); } }
        const L = Math.hypot(nx, ny);
        if (L < .01) return [x, y, vx, vy, hit, -vx, -vy];
        nx /= L; ny /= L;
        const dot = Math.min(0, vx * nx + vy * ny);
        return [x, y, vx, vy, hit, vx - 2 * dot * nx, vy - 2 * dot * ny];
      }
      return [x, y, vx, vy, Infinity, vx, vy];
    }));
  }

  /* ───────── the ground ───────── */

  /** Sample every shape's outline and keep the points that really are the border between ground and nothing. */
  private buildEdges(s: StageSim): void {
    this.runs = [];
    this.edgePts = [];
    const shapes = [...s.ground, ...s.holes, ...s.gates.filter(g => g.open).map(g => g.shape)];
    for (const sh of shapes) {
      let run: number[] = [];
      const end = (): void => {
        if (run.length >= 4) {
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (let i = 0; i < run.length; i += 2) { x0 = Math.min(x0, run[i]); x1 = Math.max(x1, run[i]); y0 = Math.min(y0, run[i + 1]); y1 = Math.max(y1, run[i + 1]); }
          this.runs.push({ x0, y0, x1, y1, pts: run });
        }
        run = [];
      };
      for (const [x, y, nx, ny] of outline(sh, EDGE_STEP)) {
        const a = s.isGround(x + nx * 2, y + ny * 2), b = s.isGround(x - nx * 2, y - ny * 2);
        if (a === b) { end(); continue; }
        if (run.length && Math.hypot(x - run[run.length - 2], y - run[run.length - 1]) > EDGE_STEP * 2.5) end();
        run.push(x, y);
        this.edgePts.push(b ? [x, y, -nx, -ny] : [x, y, nx, ny]);
      }
      end();
    }
  }

  private drawGround(s: StageSim): void {
    const c = this.ctx, px = s.x, py = s.y;
    const vx0 = this.camX - 40, vy0 = this.camY - 40, vx1 = this.camX + this.width / this.zoom + 40, vy1 = this.camY + this.height / this.zoom + 40;
    const REACH = 120;
    c.save();
    c.strokeStyle = this.pal.ink;
    c.lineWidth = 1;
    c.lineJoin = 'round';
    // The boundary itself: one thin line in the ordinary colour.
    c.globalAlpha = .75;
    c.beginPath();
    for (const r of this.runs) {
      if (r.x1 < vx0 || r.x0 > vx1 || r.y1 < vy0 || r.y0 > vy1) continue;
      c.moveTo(r.pts[0], r.pts[1]);
      for (let i = 2; i < r.pts.length; i += 2) c.lineTo(r.pts[i], r.pts[i + 1]);
    }
    c.stroke();
    if (!s.reform) {
      // Near the player, two faint lines appear just inside it.
      const half = EDGE_STEP / 2 + .5;
      for (const [x, y, nx, ny] of this.edgePts) {
        if (Math.abs(x - px) > REACH || Math.abs(y - py) > REACH) continue;
        const d = Math.hypot(x - px, y - py);
        if (d > REACH) continue;
        const k = (1 - d / REACH) ** 1.6, tx = -ny * half, ty = nx * half;
        for (let i = 1; i <= 2; i++) {
          c.globalAlpha = (.5 * k) / i;
          c.beginPath();
          c.moveTo(x + nx * i * 5 - tx, y + ny * i * 5 - ty);
          c.lineTo(x + nx * i * 5 + tx, y + ny * i * 5 + ty);
          c.stroke();
        }
      }
      // Deadly ground: dots, only where the player is close to it.
      c.fillStyle = this.pal.danger;
      const R = 150, gx = 16, gy = 13.9;
      for (let j = Math.floor((py - R) / gy); j * gy <= py + R; j++) for (let i = Math.floor((px - R) / gx); i * gx <= px + R; i++) {
        const x = i * gx + (j & 1 ? gx / 2 : 0), y = j * gy;
        const k = clamp(1 - Math.hypot(x - px, y - py) / R) ** 1.5;
        if (k < .03 || s.isGround(x, y)) continue;
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
      c.strokeStyle = pal.ink; c.lineWidth = 1; c.globalAlpha = .35; c.setLineDash([2, 4]);
      c.strokeRect(cp.x - 10.5, cp.y - 10.5, 21, 21); c.setLineDash([]);
    }
    for (const pad of s.plates) {
      if (!this.visible(pad.x, pad.y)) continue;
      // The boss's plates show only in the phrase that needs them.
      const enc = s.encounters.find(e => e.id === pad.encounter);
      if (enc && !(enc.running && enc.phrases[enc.index].shield)) continue;
      c.strokeStyle = c.fillStyle = pal.player[pad.layer];
      c.lineWidth = 1.25;
      c.globalAlpha = pad.lit ? .5 : .1;
      c.beginPath(); c.arc(pad.x, pad.y, pad.r, 0, TAU); c.fill();
      c.globalAlpha = 1;
      c.beginPath(); c.arc(pad.x, pad.y, pad.r, 0, TAU); c.stroke();
      if (!pad.lit && pad.count > 0) {
        c.lineWidth = 4;
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
        c.lineWidth = 1;
        c.beginPath(); c.arc(q.x + (i - (marks.length - 1) / 2) * 9, q.y, 3, 0, TAU);
        if (on) c.fill(); else c.stroke();
      });
    }
    for (const part of s.parts) {
      if (part.taken || !this.visible(part.x, part.y)) continue;
      const k = s.guardCleared(part) ? 1 : .35;
      c.fillStyle = c.strokeStyle = pal.player[part.layer];
      c.globalAlpha = k;
      c.beginPath(); c.arc(part.x, part.y, 11 * (1 + .1 * pulse), 0, TAU); c.fill();
      c.lineWidth = 1; c.globalAlpha = .5 * (1 - beatU) * k;
      c.beginPath(); c.arc(part.x, part.y, 14 + 14 * easeOut(beatU), 0, TAU); c.stroke();
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
        c.globalAlpha = .5; c.lineWidth = 1.25; this.shapeOutline(a); c.stroke();
      } else if (a.hold > 0) {
        // Held zones do not just sit there: they dip, then climb again toward the next beat, when they strike again.
        const u = (((stepF - a.hitStep) / 4) % 1 + 1) % 1, k = Math.floor(u * 4) + 1;
        c.globalAlpha = u < .1 ? 1 : .34 + .12 * k; this.shapePath(a); c.fill();
        c.globalAlpha = .9; c.lineWidth = 1.5; this.shapePath(a); c.stroke();
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
      const fr = e.fronts ?? (e.fronts = this.fronts(s, a));
      c.strokeStyle = pal.enemy[a.layer]; c.lineJoin = 'round';
      for (let k = 0; k < E.lines; k++) {
        const te = (age - k * E.gap) / E.life;
        if (te <= 0 || te >= 1) continue;
        const d = 2 + easeOut(te) * E.dist * (1 + k * .12);
        c.globalAlpha = E.alpha * (1 - te) ** 1.4;
        c.lineWidth = E.w * (1 - te * .35);
        c.beginPath();
        for (const f of fr) {
          let lx = 0, ly = 0, pen = false;
          for (const p of f) {
            if (!p) { pen = false; continue; }
            const [x, y, vx, vy, hit, wx, wy] = p;
            const qx = d <= hit ? x + vx * d : x + vx * hit + wx * (d - hit), qy = d <= hit ? y + vy * d : y + vy * hit + wy * (d - hit);
            if (pen && Math.hypot(qx - lx, qy - ly) < 26) c.lineTo(qx, qy); else c.moveTo(qx, qy);
            lx = qx; ly = qy; pen = true;
          }
        }
        c.stroke();
      }
    }
    c.restore();
  }

  /** Everything that attacks. A fight is drawn as the validation build drew its boss: an ink disc with a red quarter. */
  private drawEmitters(s: StageSim, stepF: number, pulse: number): void {
    const c = this.ctx, pal = this.pal;
    c.save();
    for (const em of s.emitters) {
      if (em.broken || em.hidden || !this.visible(em.x, em.y)) continue;
      c.globalAlpha = 1; c.setLineDash([]);
      const enc = s.encounterOf(em);
      if (!enc) { this.drawSmall(em, pulse); continue; }
      const ph = enc.phrases[enc.index], awake = enc.running;
      const open = awake && !!ph.openBars?.includes(Math.floor((Math.floor(stepF) - enc.phraseStart) / s.meter.stepsPerBar));
      const r = (em.body - 8) * (1 + .09 * pulse);
      c.strokeStyle = pal.ink;
      // Health: a thick arc. A notch marks where this phrase ends.
      c.globalAlpha = .18; c.lineWidth = 6; c.beginPath(); c.arc(em.x, em.y, em.body + 9, 0, TAU); c.stroke();
      c.globalAlpha = 1; c.beginPath(); c.arc(em.x, em.y, em.body + 9, -Math.PI / 2, -Math.PI / 2 + TAU * (em.hp / Math.max(1, em.maxHp))); c.stroke();
      const gate = ph.advance?.hpBelow;
      if (gate !== undefined && gate > 0) {
        const a = -Math.PI / 2 + TAU * gate;
        c.strokeStyle = pal.bg; c.lineWidth = 2.5;
        c.beginPath(); c.moveTo(em.x + Math.cos(a) * (em.body + 4), em.y + Math.sin(a) * (em.body + 4)); c.lineTo(em.x + Math.cos(a) * (em.body + 14), em.y + Math.sin(a) * (em.body + 14)); c.stroke();
        c.strokeStyle = pal.ink;
      }
      if (awake && ph.shield && !s.solved(enc)) { c.lineWidth = 1.25; c.setLineDash([3, 5]); c.beginPath(); c.arc(em.x, em.y, em.body + 20, 0, TAU); c.stroke(); c.setLineDash([]); }
      // The instrument this phrase is weak to, in the player's colour.
      if (ph.weakTo) { c.fillStyle = pal.player[ph.weakTo]; c.beginPath(); c.arc(em.x, em.y - em.body - 24, 3.5, 0, TAU); c.fill(); }
      // Just dodges answered in a row, for a guardian that can be passed that way.
      const need = ph.advance?.answered ?? 0;
      for (let i = 0; i < need; i++) {
        const on = awake && i < s.streak;
        c.fillStyle = c.strokeStyle = pal.ink; c.lineWidth = 1; c.globalAlpha = on ? 1 : .45;
        c.beginPath(); c.arc(em.x + (i - (need - 1) / 2) * 10, em.y + em.body + 26, 3, 0, TAU);
        if (on) c.fill(); else c.stroke();
      }
      c.globalAlpha = 1;
      c.fillStyle = pal.ink; c.strokeStyle = pal.ink; c.lineWidth = 2;
      c.beginPath(); c.arc(em.x, em.y, r, 0, TAU);
      if (open) c.stroke(); else c.fill();
      c.fillStyle = pal.enemy.drum; c.globalAlpha = open ? .9 : 1;
      c.beginPath(); c.moveTo(em.x, em.y); c.arc(em.x, em.y, r, -Math.PI / 2, 0); c.closePath(); c.fill();
    }
    c.restore();
  }

  /** Devices and monsters. New here (the validation build had neither): kept to the same few marks. */
  private drawSmall(em: Emitter, pulse: number): void {
    const c = this.ctx, pal = this.pal;
    if (em.kind === 'device') {
      c.strokeStyle = pal.ink; c.lineWidth = 1; c.globalAlpha = .6;
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
        c.globalAlpha = .8 * st * (1 - k) ** 1.5; c.lineWidth = 1.5 - k;
        c.beginPath(); c.arc(f.x, f.y, 12 + 34 * st * easeOut(k), 0, TAU); c.stroke();
        for (let i = 1; i <= 5; i++) { const t = i / 6; c.globalAlpha = .34 * st * t * (1 - clamp(age / .7)) ** 1.2; c.beginPath(); c.arc(f.x + dx * t, f.y + dy * t, PLAYER_R * .8 * (.55 + .45 * t), 0, TAU); c.fill(); }
        c.lineWidth = 1; c.globalAlpha = .55 * st * (1 - clamp(age / .6));
        if (L > 30) for (const o of [-9, 0, 9]) { c.beginPath(); c.moveTo(f.x - uy * o + ux * 6, f.y + ux * o + uy * 6); c.lineTo(f.x1 - uy * o - ux * 14, f.y1 + ux * o - uy * 14); c.stroke(); }
      } else if (f.kind === 'drum') {
        if (age > .9) continue;
        const k = age / .9, R = ATTACK_RANGE_U.drum * s.u * easeOut(clamp(age / .25));
        c.strokeStyle = c.fillStyle = pal.player.drum;
        c.globalAlpha = .22 * (1 - k) ** 2; c.beginPath(); c.arc(f.x, f.y, R, 0, TAU); c.fill();
        c.globalAlpha = .9 * (1 - k) ** 1.3; c.lineWidth = 2.2 - 1.4 * k; c.beginPath(); c.arc(f.x, f.y, R + 10 * k, 0, TAU); c.stroke();
      } else if (f.kind === 'hat') {
        if (age > .6) continue;
        const dx = f.tx - f.x, dy = f.ty - f.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
        const head = Math.min(L, L * (age / .22)), tail = Math.max(0, head - 38);
        c.strokeStyle = pal.player.hat; c.lineCap = 'round';
        if (age < .22) { c.globalAlpha = .95; c.lineWidth = 2; c.beginPath(); c.moveTo(f.x + ux * tail, f.y + uy * tail); c.lineTo(f.x + ux * head, f.y + uy * head); c.stroke(); }
        else {
          const k = (age - .22) / .38; c.globalAlpha = .8 * (1 - k); c.lineWidth = 1.2;
          for (const a of [-1.1, 0, 1.1]) { const cc = Math.cos(a) * -ux - Math.sin(a) * -uy, ss = Math.sin(a) * -ux + Math.cos(a) * -uy; c.beginPath(); c.moveTo(f.tx + cc * 4, f.ty + ss * 4); c.lineTo(f.tx + cc * (6 + 12 * k), f.ty + ss * (6 + 12 * k)); c.stroke(); }
        }
      } else if (f.kind === 'ring') {
        if (age > .9) continue;
        c.strokeStyle = f.color; c.lineWidth = 2 - 1.4 * (age / .9); c.globalAlpha = .9 * (1 - age / .9) ** 1.4;
        c.beginPath(); c.arc(f.x, f.y, 12 + 40 * easeOut(age / .9), 0, TAU); c.stroke();
      } else {
        this.drawDust(f.from, f.to, age, f.dur / 4, stepF / 4);
      }
    }
    // The bass attack is a held string, trembling for as long as the note sounds.
    if (stepF < this.bassLine.until && s.equipped === 'bass' && !s.reform) {
      const on = clamp((this.bassLine.until - stepF) / 1.2), dx = this.bassLine.tx - s.x, dy = this.bassLine.ty - s.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
      c.strokeStyle = pal.player.bass; c.lineCap = 'round';
      for (const [amp, a, w] of [[5, .85, 1.6], [9, .4, 1], [13, .22, 1]]) {
        c.globalAlpha = a * on; c.lineWidth = w; c.beginPath();
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

  private drawPlayer(s: StageSim, stepF: number, pulse: number): void {
    const c = this.ctx, pal = this.pal;
    if (s.reform) return;       // scattered: the dust is the player
    const r = PLAYER_R * .8 * (1 + .12 * pulse);
    c.save();
    c.globalAlpha = (s.iframe > 0 || s.step < s.graceUntil) && !s.dash && Math.floor(stepF * 2) % 2 === 0 ? .4 : 1;
    c.strokeStyle = s.equipped ? pal.player[s.equipped] : pal.ink;
    c.lineWidth = s.equipped ? 1.5 : 1;
    c.beginPath(); c.arc(s.x, s.y, PLAYER_R + 4, 0, TAU); c.stroke();
    c.fillStyle = pal.ink;
    c.beginPath(); c.arc(s.x, s.y, r, 0, TAU); c.fill();
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
