import { PAD_RADIUS, Shape } from '../core/game/bossPatterns';
import { bassSounding, gimmickDeadly } from '../core/game/gimmicks';
import { GameEvent, GameState, Instrument, Room } from '../core/game/types';
import { LayerId } from '../core/music/song';
import { Palette, paletteOf } from './theme';

const TAU = Math.PI * 2;
const clamp = (v: number, a = 0, b = 1): number => Math.max(a, Math.min(b, v));
const easeOut = (t: number): number => 1 - (1 - t) ** 3;
type Pt = { x: number; y: number };

/** How an attack's echo spreads, by the layer it rides on. Lengths are in beats and pixels. */
const ECHO: Record<LayerId, { dist: number; lines: number; life: number; alpha: number; w: number; gap: number }> = {
  hat: { dist: 16, lines: 1, life: .6, alpha: .8, w: 1.2, gap: .15 },
  drum: { dist: 95, lines: 2, life: 1.3, alpha: .7, w: 1.3, gap: .2 },
  lead: { dist: 70, lines: 2, life: 1.1, alpha: .7, w: 1.3, gap: .2 },
  pad: { dist: 70, lines: 2, life: 1.1, alpha: .7, w: 1.3, gap: .2 },
  bass: { dist: 0, lines: 0, life: 3.4, alpha: .17, w: 0, gap: 0 },
};

/** A point on an attack's edge and the direction it travels as an echo. */
type Front = [number, number, number, number][];
interface Echo { shape: Shape; origin: Pt; boss: Pt; layer: LayerId; at: number; fronts: Front[] | null }
interface Flash { shape: Shape; origin: Pt; boss: Pt; layer: LayerId; at: number }
type PlayerFx =
  | { kind: 'dash'; at: number; x: number; y: number; x1: number; y1: number; strong: boolean }
  | { kind: 'drum'; at: number; x: number; y: number }
  | { kind: 'hat'; at: number; x: number; y: number; tx: number; ty: number }
  | { kind: 'ring'; at: number; x: number; y: number; color: string }
  | { kind: 'dust'; at: number; from: Pt; to: Pt; dur: number };

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
 * The look of the game. Rules it follows:
 *  - the ground has no colour: it is the background, bounded by one thin line
 *  - a filled plane is a sound happening now; a telegraph is the same plane, growing, its opacity rising in 16th steps
 *  - lines are what a sound leaves behind: echoes spread from a hit and bounce off the walls
 *  - red family is the enemy, blue family is the player
 *  - deadly ground shows as dots, only near the player
 */
export class Renderer {
  ctx: CanvasRenderingContext2D;
  pal: Palette = paletteOf(null);
  camX = 0; camY = 0;
  private echoes: Echo[] = [];
  private flashes: Flash[] = [];
  private pfx: PlayerFx[] = [];
  private bassLine = { until: -1, tx: 0, ty: 0 };
  private seenActive = new Map<object, { shape: Shape; origin: Pt; layer: LayerId; hitAbs: number }>();
  private seenZones = new Map<object, { shape: Shape; layer: LayerId }>();
  private lastPlayer: Pt = { x: 0, y: 0 };

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

  draw(s: GameState, beatPhase: number, stepF: number, events: GameEvent[]): void {
    const c = this.ctx, w = this.width, h = this.height, p = s.player;
    const pulse = Math.exp(-beatPhase * 5);
    this.collect(s, stepF, events);

    this.camX = p.x - w / 2;
    this.camY = p.y - h / 2;
    c.fillStyle = this.pal.bg;
    c.fillRect(0, 0, w, h);
    c.save();
    c.translate(-Math.round(this.camX), -Math.round(this.camY));

    this.drawGimmicks(s, stepF, pulse);
    this.drawBossField(s, stepF);
    this.drawGround(s, stepF);
    this.drawBoss(s, stepF, pulse);
    this.drawPlayerFx(s, stepF);
    this.drawPlayer(s, stepF, pulse);
    c.restore();
    this.drawHud(s, pulse);
    this.lastPlayer = { x: p.x, y: p.y };
  }

  /* ───────── events → effects ───────── */

  private collect(s: GameState, stepF: number, events: GameEvent[]): void {
    const p = s.player, b = s.boss;
    for (const e of events) {
      if (e.type === 'dodge') {
        const d = p.dash;
        const len = d ? Math.hypot(d.vx, d.vy) * d.dur : 0;
        const ux = d && len ? d.vx * d.dur : 0, uy = d && len ? d.vy * d.dur : 0;
        this.pfx.push({ kind: 'dash', at: stepF, x: this.lastPlayer.x, y: this.lastPlayer.y, x1: this.lastPlayer.x + ux, y1: this.lastPlayer.y + uy, strong: e.grade !== 'miss' });
      } else if (e.type === 'attack') {
        if (e.inst === 'drum') this.pfx.push({ kind: 'drum', at: stepF, x: e.x, y: e.y });
        else if (e.inst === 'hat') this.pfx.push({ kind: 'hat', at: stepF, x: e.x, y: e.y, tx: e.tx, ty: e.ty });
        else this.bassLine = { until: stepF + 1.4, tx: e.tx, ty: e.ty };
      } else if (e.type === 'respawn' || e.type === 'death') {
        this.pfx.push({ kind: 'dust', at: stepF, from: e.from, to: e.to, dur: s.tun.reformSteps });
        this.pfx.push({ kind: 'ring', at: stepF, x: e.from.x, y: e.from.y, color: this.pal.danger });
        this.pfx.push({ kind: 'ring', at: stepF + s.tun.reformSteps, x: e.to.x, y: e.to.y, color: this.pal.player[p.equipped ?? 'drum'] });
      } else if (e.type === 'collect') {
        this.pfx.push({ kind: 'ring', at: stepF, x: p.x, y: p.y, color: this.pal.player[e.inst] });
      } else if (e.type === 'hurt') {
        this.pfx.push({ kind: 'ring', at: stepF, x: p.x, y: p.y, color: this.pal.danger });
      }
    }
    // An attack that was telegraphed last frame and is gone now has just landed: flash it and send out its echo.
    const bossPos = b ? { x: b.x, y: b.y } : null;
    const nowActive = new Map<object, { shape: Shape; origin: Pt; layer: LayerId; hitAbs: number }>();
    const nowZones = new Map<object, { shape: Shape; layer: LayerId }>();
    if (b && !b.defeated) {
      for (const a of b.active) nowActive.set(a, { shape: a.spec.shape, origin: a.origin, layer: a.spec.layer, hitAbs: a.hitAbs });
      for (const z of b.zones) nowZones.set(z, { shape: z.shape, layer: z.layer });
    }
    if (bossPos) {
      for (const [key, a] of this.seenActive) {
        if (nowActive.has(key) || a.hitAbs > stepF + .01) continue;
        this.flashes.push({ shape: a.shape, origin: a.origin, boss: bossPos, layer: a.layer, at: a.hitAbs });
        if (a.shape.kind !== 'zone') this.echoes.push({ shape: a.shape, origin: a.origin, boss: bossPos, layer: a.layer, at: a.hitAbs, fronts: null });
      }
      // A held zone leaves its wash when it finally lets go.
      for (const [key, z] of this.seenZones) {
        if (!nowZones.has(key)) this.echoes.push({ shape: z.shape, origin: bossPos, boss: bossPos, layer: z.layer, at: stepF, fronts: null });
      }
    } else {
      this.echoes = [];
      this.flashes = [];
    }
    this.seenActive = nowActive;
    this.seenZones = nowZones;
    this.echoes = this.echoes.filter(e => (stepF - e.at) / 4 < ECHO[e.layer].life + .8);
    this.flashes = this.flashes.filter(f => stepF - f.at < 2.6);
    this.pfx = this.pfx.filter(f => stepF - f.at < (f.kind === 'dust' ? f.dur + .5 : 6));
  }

  /* ───────── shapes ───────── */

  /** Trace a boss attack as a path. grow (0..1) is how far the plane has spread from where it starts. */
  private shapePath(shape: Shape, origin: Pt, boss: Pt, grow = 1): void {
    const c = this.ctx;
    c.beginPath();
    if (shape.kind === 'circle') c.arc(origin.x, origin.y, Math.max(.5, shape.r * grow), 0, TAU);
    else if (shape.kind === 'ring') {
      c.arc(boss.x, boss.y, shape.rIn + (shape.rOut - shape.rIn) * grow, 0, TAU);
      c.arc(boss.x, boss.y, shape.rIn, 0, TAU, true);
    } else if (shape.kind === 'line') {
      const cx = Math.cos(shape.angle), cy = Math.sin(shape.angle), hw = shape.width / 2, L = 1100 * grow;
      c.moveTo(boss.x + cy * hw, boss.y - cx * hw);
      c.lineTo(boss.x + cx * L + cy * hw, boss.y + cy * L - cx * hw);
      c.lineTo(boss.x + cx * L - cy * hw, boss.y + cy * L + cx * hw);
      c.lineTo(boss.x - cy * hw, boss.y + cx * hw);
      c.closePath();
    } else {
      // Zones spread from the side nearest the boss.
      const x = boss.x + shape.x, y = boss.y + shape.y, fromLeft = shape.x + shape.w / 2 >= 0;
      const w = shape.w * grow;
      c.rect(fromLeft ? x : x + shape.w - w, y, w, shape.h);
    }
  }

  private shapeOutline(shape: Shape, origin: Pt, boss: Pt): void {
    const c = this.ctx;
    if (shape.kind !== 'ring') { this.shapePath(shape, origin, boss); return; }
    c.beginPath();
    c.arc(boss.x, boss.y, shape.rOut, 0, TAU);
    c.moveTo(boss.x + shape.rIn, boss.y);
    c.arc(boss.x, boss.y, shape.rIn, 0, TAU);
  }

  private fronts(shape: Shape, origin: Pt, boss: Pt, wall: Room): Front[] {
    const out: Front[] = [];
    const circle = (cx: number, cy: number, r: number, sg: number): Front => {
      const f: Front = [];
      for (let i = 0; i <= 96; i++) { const a = (i / 96) * TAU; f.push([cx + r * Math.cos(a), cy + r * Math.sin(a), sg * Math.cos(a), sg * Math.sin(a)]); }
      return f;
    };
    if (shape.kind === 'circle') out.push(circle(origin.x, origin.y, shape.r, 1));
    else if (shape.kind === 'ring') out.push(circle(boss.x, boss.y, shape.rOut, 1), circle(boss.x, boss.y, shape.rIn, -1));
    else if (shape.kind === 'line') {
      const cx = Math.cos(shape.angle), cy = Math.sin(shape.angle);
      for (const sg of [1, -1]) {
        const f: Front = [];
        for (let t = 0; t <= 1100; t += 7) {
          const x = boss.x + cx * t + cy * sg * shape.width / 2, y = boss.y + cy * t - cx * sg * shape.width / 2;
          if (x > wall.x && x < wall.x + wall.w && y > wall.y && y < wall.y + wall.h) f.push([x, y, cy * sg, -cx * sg]);
        }
        out.push(f);
      }
    }
    return out;
  }

  /** Move a point d pixels; it bounces off the walls of the room. */
  private travel(x: number, y: number, vx: number, vy: number, d: number, wall: Room): [number, number] {
    const x0 = wall.x, x1 = wall.x + wall.w, y0 = wall.y, y1 = wall.y + wall.h;
    for (let i = 0; i < 8 && d > 0; i++) {
      const tx = vx > 0 ? (x1 - x) / vx : vx < 0 ? (x0 - x) / vx : Infinity;
      const ty = vy > 0 ? (y1 - y) / vy : vy < 0 ? (y0 - y) / vy : Infinity;
      const t = Math.max(0, Math.min(tx, ty));
      if (t >= d) { x += vx * d; y += vy * d; break; }
      x += vx * t; y += vy * t; d -= t;
      if (tx <= ty) vx = -vx; else vy = -vy;
    }
    return [x, y];
  }

  /* ───────── the ground ───────── */

  /** Is this tile something the player can stand on right now? */
  private isGround(s: GameState, col: number, row: number, stepF: number): boolean {
    const wd = s.world;
    if (col < 0 || row < 0 || col >= wd.cols || row >= wd.rows) return false;
    const ch = wd.cells[row][col];
    if (ch === '#' || ch === '~') return false;
    if (ch === 'D') return s.doorOpen;
    if (ch === 'p' || ch === 'q') return !gimmickDeadly(wd, s.song, stepF, (col + .5) * wd.tile, (row + .5) * wd.tile, s.tun);
    return true;
  }

  private drawGround(s: GameState, stepF: number): void {
    const c = this.ctx, wd = s.world, T = wd.tile, p = s.player;
    const c0 = Math.floor(this.camX / T) - 1, c1 = Math.floor((this.camX + this.width) / T) + 1;
    const r0 = Math.floor(this.camY / T) - 1, r1 = Math.floor((this.camY + this.height) / T) + 1;
    const REACH = 120;
    c.save();
    c.strokeStyle = this.pal.ink;
    c.lineWidth = 1;
    const edges: [number, number, number, number, number, number][] = [];   // x0,y0,x1,y1, inward nx,ny
    for (let r = r0; r <= r1; r++) for (let col = c0; col <= c1; col++) {
      if (!this.isGround(s, col, r, stepF)) continue;
      const x = col * T, y = r * T;
      if (!this.isGround(s, col, r - 1, stepF)) edges.push([x, y, x + T, y, 0, 1]);
      if (!this.isGround(s, col, r + 1, stepF)) edges.push([x, y + T, x + T, y + T, 0, -1]);
      if (!this.isGround(s, col - 1, r, stepF)) edges.push([x, y, x, y + T, 1, 0]);
      if (!this.isGround(s, col + 1, r, stepF)) edges.push([x + T, y, x + T, y + T, -1, 0]);
    }
    // The boundary itself: one thin line in the ordinary colour.
    c.globalAlpha = .75;
    c.beginPath();
    for (const [x0, y0, x1, y1] of edges) { c.moveTo(x0, y0); c.lineTo(x1, y1); }
    c.stroke();
    // Near the player, two faint lines appear just inside it.
    for (const [x0, y0, x1, y1, nx, ny] of edges) {
      const d = Math.hypot((x0 + x1) / 2 - p.x, (y0 + y1) / 2 - p.y);
      if (d > REACH) continue;
      const k = (1 - d / REACH) ** 1.6;
      for (let i = 1; i <= 2; i++) {
        c.globalAlpha = (.5 * k) / i;
        c.beginPath();
        c.moveTo(x0 + nx * i * 5, y0 + ny * i * 5);
        c.lineTo(x1 + nx * i * 5, y1 + ny * i * 5);
        c.stroke();
      }
    }
    // Deadly ground: dots, only where the player is close to it.
    c.fillStyle = this.pal.danger;
    const R = 150, gx = 16, gy = 13.9;
    for (let j = Math.floor((p.y - R) / gy); j * gy <= p.y + R; j++) for (let i = Math.floor((p.x - R) / gx); i * gx <= p.x + R; i++) {
      const x = i * gx + (j & 1 ? gx / 2 : 0), y = j * gy;
      const k = clamp(1 - Math.hypot(x - p.x, y - p.y) / R) ** 1.5;
      if (k < .03 || this.isGround(s, Math.floor(x / T), Math.floor(y / T), stepF)) continue;
      c.globalAlpha = .8 * k;
      c.beginPath(); c.arc(x, y, .5 + 3.2 * k, 0, TAU); c.fill();
    }
    c.restore();
  }

  /** Room machinery and pickups. Everything here moves on the beat. */
  private drawGimmicks(s: GameState, stepF: number, pulse: number): void {
    const c = this.ctx, wd = s.world, T = wd.tile, pal = this.pal;
    const c0 = Math.max(0, Math.floor(this.camX / T)), c1 = Math.min(wd.cols - 1, Math.floor((this.camX + this.width) / T));
    const r0 = Math.max(0, Math.floor(this.camY / T)), r1 = Math.min(wd.rows - 1, Math.floor((this.camY + this.height) / T));
    const beatU = ((stepF / 4) % 1 + 1) % 1, k4 = Math.floor(beatU * 4) + 1;
    c.save();
    for (let r = r0; r <= r1; r++) for (let col = c0; col <= c1; col++) {
      const ch = wd.cells[r][col];
      if (ch === '#' || ch === '.' || ch === '~' || ch === 'P') continue;
      const x = col * T, y = r * T, cx = x + T / 2, cy = y + T / 2;
      const deadly = gimmickDeadly(wd, s.song, stepF, cx, cy, s.tun);
      c.globalAlpha = 1;
      if (ch === 'g') {
        // A gate is an attack: it telegraphs through the beat it is open, then lands.
        c.fillStyle = pal.enemy.drum;
        if (deadly) { c.globalAlpha = beatU < .1 ? 1 : .88; c.fillRect(x + 3, y, T - 6, T); }
        else {
          c.globalAlpha = .1; c.fillRect(x + 3, y, T - 6, T);
          c.globalAlpha = .16 + .44 * (k4 / 4); c.fillRect(x + 3, y, (T - 6) * beatU, T);
        }
      } else if (ch === 'p' || ch === 'q') {
        // A platform about to blink out warns in the hat colour.
        if (!deadly && gimmickDeadly(wd, s.song, stepF + .9, cx, cy, s.tun)) { c.fillStyle = pal.enemy.hat; c.globalAlpha = .45; c.fillRect(x + 4, y + 4, T - 8, T - 8); }
      } else if (ch === 'w') {
        c.fillStyle = pal.enemy.bass;
        if (deadly) { c.globalAlpha = beatU < .1 ? 1 : .34 + .12 * k4; c.fillRect(x, y, T, T); }
        else {
          // Count-in: the lane fills in over the last beat of a rest.
          let n = 0;
          for (let i = 1; i <= 4; i++) if (bassSounding(s.song, Math.floor(stepF) + i)) { n = i; break; }
          if (n) { c.globalAlpha = .1 + .11 * (5 - n); c.fillRect(x, y, T, T); }
        }
      } else if (ch === 's') {
        c.strokeStyle = pal.ink; c.lineWidth = 1; c.globalAlpha = .35; c.setLineDash([2, 4]);
        c.strokeRect(x + 5.5, y + 5.5, T - 11, T - 11); c.setLineDash([]);
      } else if (ch === 'd' || ch === 'h' || ch === 'b') {
        const inst: Instrument = ch === 'd' ? 'drum' : ch === 'h' ? 'hat' : 'bass';
        if (s.player.owned.includes(inst)) continue;
        c.fillStyle = c.strokeStyle = pal.player[inst];
        c.beginPath(); c.arc(cx, cy, 11 * (1 + .1 * pulse), 0, TAU); c.fill();
        c.lineWidth = 1; c.globalAlpha = .5 * (1 - beatU);
        c.beginPath(); c.arc(cx, cy, 14 + 14 * easeOut(beatU), 0, TAU); c.stroke();
      } else if (ch === 'D') {
        if (s.doorOpen) continue;
        (['drum', 'hat', 'bass'] as Instrument[]).forEach((inst, i) => {
          const owned = s.player.owned.includes(inst);
          c.globalAlpha = owned ? 1 : .35;
          c.fillStyle = c.strokeStyle = owned ? pal.player[inst] : pal.ink;
          c.lineWidth = 1;
          c.beginPath(); c.arc(x + 7 + i * 9, cy, 3, 0, TAU);
          if (owned) c.fill(); else c.stroke();
        });
      } else if (ch === 'T') {
        c.strokeStyle = pal.ink; c.lineWidth = 1; c.globalAlpha = .6;
        c.beginPath(); c.arc(cx, cy, 12, 0, TAU); c.stroke();
        c.beginPath(); c.arc(cx, cy, 4, 0, TAU); c.stroke();
      }
    }
    c.restore();
  }

  /* ───────── the boss fight ───────── */

  /** Telegraphs, hits, held zones and echoes: all clipped to the arena, where the echoes bounce. */
  private drawBossField(s: GameState, stepF: number): void {
    const c = this.ctx, b = s.boss, room = s.world.rooms.boss;
    if (!b || !room) return;
    const boss = { x: b.x, y: b.y }, pal = this.pal;
    c.save();
    c.beginPath(); c.rect(room.x, room.y, room.w, room.h); c.clip();

    if (!b.defeated) {
      // Pads the player must hold in the puzzle phrase.
      if (b.conductor.current.texture === 'resolve') {
        for (const pad of b.pads) {
          c.strokeStyle = c.fillStyle = pal.player[pad.inst];
          c.lineWidth = 1.25;
          c.globalAlpha = pad.locked ? .5 : .1;
          c.beginPath(); c.arc(pad.x, pad.y, PAD_RADIUS, 0, TAU); c.fill();
          c.globalAlpha = 1;
          c.beginPath(); c.arc(pad.x, pad.y, PAD_RADIUS, 0, TAU); c.stroke();
          if (!pad.locked && pad.progress > 0) {
            c.lineWidth = 4;
            c.beginPath(); c.arc(pad.x, pad.y, PAD_RADIUS + 7, -Math.PI / 2, -Math.PI / 2 + (TAU * pad.progress) / 16); c.stroke();
          }
        }
      }
      // Telegraph: the plane spreads steadily; its opacity climbs one step per 16th.
      for (const a of b.active) {
        const span = a.hitAbs - a.startStep, pr = clamp((stepF - a.startStep) / span);
        const k = Math.min(span, Math.floor(pr * span) + 1), color = a.evaded ? pal.ink : pal.enemy[a.spec.layer];
        c.fillStyle = c.strokeStyle = color;
        c.globalAlpha = a.evaded ? .05 : .1; this.shapePath(a.spec.shape, a.origin, boss); c.fill('evenodd');
        c.globalAlpha = (a.evaded ? .5 : 1) * (.16 + .44 * (k / span)); this.shapePath(a.spec.shape, a.origin, boss, pr); c.fill('evenodd');
        c.globalAlpha = .5; c.lineWidth = 1.25; this.shapeOutline(a.spec.shape, a.origin, boss); c.stroke();
      }
      // Held zones do not just sit there: they dip, then climb again toward the next beat, when they strike again.
      for (const z of b.zones) {
        if (z.shape.kind !== 'zone') continue;
        const e = stepF - (z.untilStep - z.shape.holdSteps), u = ((e / 4) % 1 + 1) % 1, k = Math.floor(u * 4) + 1;
        c.fillStyle = c.strokeStyle = pal.enemy[z.layer];
        c.globalAlpha = u < .1 ? 1 : .34 + .12 * k; this.shapePath(z.shape, boss, boss); c.fill();
        c.globalAlpha = .9; c.lineWidth = 1.5; this.shapePath(z.shape, boss, boss); c.stroke();
      }
    }
    // The hit itself: the plane, full, then gone.
    for (const f of this.flashes) {
      const x = (stepF - f.at) / 4;
      if (x < 0 || x > .6 || (f.shape.kind === 'zone' && x > .05)) continue;
      c.fillStyle = pal.enemy[f.layer];
      c.globalAlpha = x < .1 ? 1 : .88 * (1 - clamp((x - .1) / .5));
      this.shapePath(f.shape, f.origin, f.boss); c.fill('evenodd');
    }
    // Echoes.
    for (const e of this.echoes) {
      const E = ECHO[e.layer], age = (stepF - e.at) / 4;
      if (age < 0) continue;
      if (e.shape.kind === 'zone') {
        // Bass leaves no lines: the whole area stays as a very faint tint whose edge dissolves outward.
        const te = age / E.life;
        if (te >= 1) continue;
        const d = 16 + te ** .9 * 260, x = e.boss.x + e.shape.x, y = e.boss.y + e.shape.y;
        c.fillStyle = pal.enemy[e.layer];
        const a = E.alpha * Math.min(1, te / .12) * (1 - te) ** 1.4;
        c.globalAlpha = a; c.fillRect(x, y, e.shape.w, e.shape.h);
        for (let i = 1; i <= 10; i++) {
          c.globalAlpha = (a * (1 - i / 11) ** 1.6) / 2.2;
          const o = (d * i) / 10;
          c.fillRect(x - o, y - o, e.shape.w + o * 2, e.shape.h + o * 2);
        }
        continue;
      }
      if (!E.lines) continue;
      const fr = e.fronts ?? (e.fronts = this.fronts(e.shape, e.origin, e.boss, room));
      c.strokeStyle = pal.enemy[e.layer]; c.lineJoin = 'round';
      for (let k = 0; k < E.lines; k++) {
        const te = (age - k * E.gap) / E.life;
        if (te <= 0 || te >= 1) continue;
        const d = 2 + easeOut(te) * E.dist * (1 + k * .12);
        c.globalAlpha = E.alpha * (1 - te) ** 1.4;
        c.lineWidth = E.w * (1 - te * .35);
        c.beginPath();
        for (const f of fr) {
          let lx = 0, ly = 0, pen = false;
          for (const [x, y, vx, vy] of f) {
            const [qx, qy] = this.travel(x, y, vx, vy, d, room);
            if (pen && Math.hypot(qx - lx, qy - ly) < 26) c.lineTo(qx, qy); else c.moveTo(qx, qy);
            lx = qx; ly = qy; pen = true;
          }
        }
        c.stroke();
      }
    }
    c.restore();
  }

  private drawBoss(s: GameState, stepF: number, pulse: number): void {
    const c = this.ctx, b = s.boss, pal = this.pal;
    if (!b) return;
    c.save();
    // Harmony: one thin ring per level.
    c.strokeStyle = pal.ink; c.lineWidth = 1;
    for (let i = 0; i < b.harmony; i++) { c.globalAlpha = .42 - i * .1; c.beginPath(); c.arc(b.x, b.y, 56 + i * 8 + pulse * 2, 0, TAU); c.stroke(); }
    const pat = b.conductor.current;
    const open = !b.defeated && pat.texture === 'call' && pat.openBars.includes(Math.floor((Math.floor(stepF) - b.phraseStart) / 16));
    const r = (b.r - 8) * (1 + .09 * pulse) * (b.defeated ? .7 : 1);
    if (!b.defeated) {
      // Health: a thick arc. A notch marks where this phrase ends.
      c.globalAlpha = .18; c.lineWidth = 6; c.beginPath(); c.arc(b.x, b.y, b.r + 9, 0, TAU); c.stroke();
      c.globalAlpha = 1; c.beginPath(); c.arc(b.x, b.y, b.r + 9, -Math.PI / 2, -Math.PI / 2 + TAU * (b.hp / s.tun.bossHp)); c.stroke();
      const gate = pat.advance.hpBelow;
      if (gate !== undefined && gate > 0) {
        const a = -Math.PI / 2 + TAU * gate;
        c.strokeStyle = pal.bg; c.lineWidth = 2.5;
        c.beginPath(); c.moveTo(b.x + Math.cos(a) * (b.r + 4), b.y + Math.sin(a) * (b.r + 4)); c.lineTo(b.x + Math.cos(a) * (b.r + 14), b.y + Math.sin(a) * (b.r + 14)); c.stroke();
        c.strokeStyle = pal.ink;
      }
      if (b.shield) { c.lineWidth = 1.25; c.setLineDash([3, 5]); c.beginPath(); c.arc(b.x, b.y, b.r + 20, 0, TAU); c.stroke(); c.setLineDash([]); }
      // The instrument this phrase is weak to, in the player's colour.
      if (pat.weakTo) { c.fillStyle = pal.player[pat.weakTo]; c.beginPath(); c.arc(b.x, b.y - b.r - 24, 3.5, 0, TAU); c.fill(); }
    }
    c.globalAlpha = 1;
    c.fillStyle = pal.ink; c.strokeStyle = pal.ink; c.lineWidth = 2;
    c.beginPath(); c.arc(b.x, b.y, r, 0, TAU);
    if (open || b.defeated) c.stroke(); else c.fill();
    if (!b.defeated) {
      c.fillStyle = pal.enemy.drum; c.globalAlpha = open ? .9 : 1;
      c.beginPath(); c.moveTo(b.x, b.y); c.arc(b.x, b.y, r, -Math.PI / 2, 0); c.closePath(); c.fill();
    }
    c.restore();
  }

  /* ───────── the player ───────── */

  private drawPlayerFx(s: GameState, stepF: number): void {
    const c = this.ctx, pal = this.pal, p = s.player, eq = pal.player[p.equipped ?? 'drum'];
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
        for (let i = 1; i <= 5; i++) { const t = i / 6; c.globalAlpha = .34 * st * t * (1 - clamp(age / .7)) ** 1.2; c.beginPath(); c.arc(f.x + dx * t, f.y + dy * t, s.tun.playerRadius * .8 * (.55 + .45 * t), 0, TAU); c.fill(); }
        c.lineWidth = 1; c.globalAlpha = .55 * st * (1 - clamp(age / .6));
        if (L > 30) for (const o of [-9, 0, 9]) { c.beginPath(); c.moveTo(f.x - uy * o + ux * 6, f.y + ux * o + uy * 6); c.lineTo(f.x1 - uy * o - ux * 14, f.y1 + ux * o - uy * 14); c.stroke(); }
      } else if (f.kind === 'drum') {
        if (age > .9) continue;
        const k = age / .9, R = s.tun.rangeDrum * easeOut(clamp(age / .25));
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
    if (stepF < this.bassLine.until && p.equipped === 'bass' && !p.reform) {
      const on = clamp((this.bassLine.until - stepF) / 1.2), dx = this.bassLine.tx - p.x, dy = this.bassLine.ty - p.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
      c.strokeStyle = pal.player.bass; c.lineCap = 'round';
      for (const [amp, a, w] of [[5, .85, 1.6], [9, .4, 1], [13, .22, 1]]) {
        c.globalAlpha = a * on; c.lineWidth = w; c.beginPath();
        for (let i = 0; i <= 40; i++) { const u = i / 40, o = Math.sin(u * 16 - s.time * 9) * amp * Math.sin(u * Math.PI); const px = p.x + dx * u - uy * o, py = p.y + dy * u + ux * o; if (i) c.lineTo(px, py); else c.moveTo(px, py); }
        c.stroke();
      }
    }
    c.restore();
  }

  /**
   * The player as dust. Scatter and gather are one movement: fast out, slowing,
   * then gathering speed and arriving fast. It never stands still.
   */
  private drawDust(from: Pt, to: Pt, age: number, dur: number, beat: number): void {
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

  private drawPlayer(s: GameState, stepF: number, pulse: number): void {
    const c = this.ctx, p = s.player, pal = this.pal;
    if (p.reform) return;       // scattered: the dust is the player
    const r = s.tun.playerRadius * .8 * (1 + .12 * pulse);
    c.save();
    c.globalAlpha = p.iframe > 0 && !p.dash && Math.floor(stepF * 2) % 2 === 0 ? .4 : 1;
    c.strokeStyle = p.equipped ? pal.player[p.equipped] : pal.ink;
    c.lineWidth = p.equipped ? 1.5 : 1;
    c.beginPath(); c.arc(p.x, p.y, s.tun.playerRadius + 4, 0, TAU); c.stroke();
    c.fillStyle = pal.ink;
    c.beginPath(); c.arc(p.x, p.y, r, 0, TAU); c.fill();
    c.restore();
  }

  /** Screen space: health and the instruments in hand. No words. */
  private drawHud(s: GameState, pulse: number): void {
    const c = this.ctx, p = s.player, pal = this.pal;
    c.save();
    c.fillStyle = c.strokeStyle = pal.ink; c.lineWidth = 1.25;
    for (let i = 0; i < s.tun.playerHp; i++) {
      c.globalAlpha = i < p.hp ? 1 : .45;
      c.beginPath(); c.arc(30 + i * 16, 30, 4.5, 0, TAU);
      if (i < p.hp) c.fill(); else c.stroke();
    }
    (['drum', 'hat', 'bass'] as Instrument[]).forEach((inst, i) => {
      const owned = p.owned.includes(inst), eq = p.equipped === inst, x = 31 + i * 20, y = 56;
      c.globalAlpha = owned ? 1 : .35;
      c.fillStyle = c.strokeStyle = owned ? pal.player[inst] : pal.ink;
      c.beginPath(); c.arc(x, y, eq ? 6.5 + pulse : 5, 0, TAU);
      if (owned) c.fill(); else c.stroke();
      if (eq) { c.strokeStyle = pal.ink; c.globalAlpha = .8; c.beginPath(); c.moveTo(x - 6, y + 12); c.lineTo(x + 6, y + 12); c.stroke(); }
    });
    c.restore();
  }
}
