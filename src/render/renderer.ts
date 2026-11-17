import { bassSounding, gimmickDeadly } from '../core/game/gimmicks';
import { PAD_RADIUS, Shape } from '../core/game/bossPatterns';
import { GameEvent, GameState, Instrument } from '../core/game/types';

export const COLORS = {
  bg: '#0c0d10', floor: '#1b1d22', wall: '#2c2f38', chasm: '#060608', ink: '#e8e6df', dim: '#6b6a66',
  drum: '#ff5a4d', hat: '#ffd23f', bass: '#3fa7ff', lead: '#c77dff', pad: '#c77dff', danger: '#ff3d6e',
} as const;
export const instColor = (i: Instrument | null): string => (i ? COLORS[i] : COLORS.ink);

interface Fx { kind: string; x: number; y: number; x2?: number; y2?: number; color: string; t: number; life: number; shape?: Shape }

/** Placeholder look: flat shapes only. The one thing that is not placeholder is that the beat is visible. */
export class Renderer {
  ctx: CanvasRenderingContext2D;
  fx: Fx[] = [];
  private last = 0;
  camX = 0; camY = 0;

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

  draw(s: GameState, beatPhase: number, stepF: number, events: GameEvent[]): void {
    const c = this.ctx, w = this.width, h = this.height, p = s.player;
    const dt = Math.min(0.1, Math.max(0, s.time - this.last));
    this.last = s.time;
    const pulse = Math.exp(-beatPhase * 5);
    this.collect(s, events);

    this.camX = p.x - w / 2;
    this.camY = p.y - h / 2;
    c.fillStyle = COLORS.bg;
    c.fillRect(0, 0, w, h);
    c.save();
    c.translate(-Math.round(this.camX), -Math.round(this.camY));

    this.drawTiles(s, stepF, pulse);
    this.drawWorld(s, stepF, pulse);
    this.drawFx(dt);
    this.drawPlayer(s, pulse);
    c.restore();

    // The whole screen breathes on the beat.
    c.strokeStyle = COLORS.ink;
    c.globalAlpha = 0.05 + 0.2 * pulse;
    c.lineWidth = 2 + 6 * pulse;
    c.strokeRect(0, 0, w, h);
    c.globalAlpha = 1;
    this.drawHud(s, pulse);
  }

  protected collect(s: GameState, events: GameEvent[]): void {
    const p = s.player;
    for (const e of events) {
      if (e.type === 'dodge') {
        const color = e.grade === 'perfect' ? COLORS.ink : e.grade === 'near' ? COLORS.dim : '#3a3a3a';
        this.fx.push({ kind: 'ring', x: p.x, y: p.y, color, t: 0, life: 0.3 });
      } else if (e.type === 'collect') {
        this.fx.push({ kind: 'burst', x: p.x, y: p.y, color: COLORS[e.inst], t: 0, life: 0.6 });
      } else if (e.type === 'attack') {
        this.fx.push({ kind: 'atk-' + e.inst, x: e.x, y: e.y, x2: e.tx, y2: e.ty, color: COLORS[e.inst], t: 0, life: e.inst === 'drum' ? 0.18 : 0.12 });
      } else if (e.type === 'solved' || e.type === 'bossDefeated' || e.type === 'bossStart') {
        const room = s.world.rooms.boss!;
        this.fx.push({ kind: 'wave', x: room.x + room.w / 2, y: room.y + room.h / 2, color: e.type === 'bossStart' ? COLORS.lead : COLORS.ink, t: 0, life: 0.9 });
      } else if (e.type === 'hurt') {
        this.fx.push({ kind: 'burst', x: p.x, y: p.y, color: COLORS.danger, t: 0, life: 0.4 });
      }
    }
  }

  protected drawTiles(s: GameState, stepF: number, pulse: number): void {
    const c = this.ctx, wd = s.world, T = wd.tile;
    const c0 = Math.max(0, Math.floor(this.camX / T)), c1 = Math.min(wd.cols - 1, Math.floor((this.camX + this.width) / T));
    const r0 = Math.max(0, Math.floor(this.camY / T)), r1 = Math.min(wd.rows - 1, Math.floor((this.camY + this.height) / T));
    for (let r = r0; r <= r1; r++) {
      for (let col = c0; col <= c1; col++) {
        const ch = wd.cells[r][col];
        c.fillStyle = ch === '#' ? COLORS.wall : ch === '~' ? COLORS.chasm : COLORS.floor;
        c.fillRect(col * T, r * T, T + 0.5, T + 0.5);
        if (ch !== '#' && ch !== '.' && ch !== '~') this.drawTile(s, ch, col * T, r * T, T, stepF, pulse);
      }
    }
  }

  /** Gimmick tiles: everything here moves on the beat. */
  protected drawTile(s: GameState, ch: string, x: number, y: number, T: number, stepF: number, pulse: number): void {
    const c = this.ctx, cx = x + T / 2, cy = y + T / 2;
    const frac = stepF - Math.floor(stepF);
    const deadly = gimmickDeadly(s.world, s.song, stepF, cx, cy);
    const soon = !deadly && gimmickDeadly(s.world, s.song, Math.floor(stepF) + 1, cx, cy);
    if (ch === 'g') {
      if (deadly) {
        c.fillStyle = COLORS.drum;
        c.fillRect(x + 2, y, T - 4, T + 0.5);
      } else {
        // The gate closes in from both sides over the beat it is open.
        const k = ((stepF / 4) % 1 + 1) % 1;
        c.fillStyle = COLORS.drum;
        c.globalAlpha = 0.25 + 0.5 * k * k;
        const wdt = (T / 2 - 2) * k * k;
        c.fillRect(x, y, wdt, T + 0.5);
        c.fillRect(x + T - wdt, y, wdt, T + 0.5);
        c.globalAlpha = 1;
      }
    } else if (ch === 'p' || ch === 'q') {
      if (deadly) {
        c.fillStyle = COLORS.chasm;
        c.fillRect(x, y, T + 0.5, T + 0.5);
      } else {
        c.fillStyle = COLORS.floor;
        c.fillRect(x, y, T + 0.5, T + 0.5);
        c.fillStyle = COLORS.hat;
        c.globalAlpha = soon ? 0.9 * (1 - frac) : 0.75;
        const m = soon ? 3 + 9 * frac : 3;
        c.fillRect(x + m, y + m, T - 2 * m, T - 2 * m);
        c.globalAlpha = 1;
      }
    } else if (ch === 'w') {
      if (deadly) {
        c.fillStyle = COLORS.bass;
        c.globalAlpha = 0.75;
        c.fillRect(x, y, T + 0.5, T + 0.5);
      } else {
        // Count-in: the lane brightens during the last two 16ths of a rest.
        const in2 = bassSounding(s.song, Math.floor(stepF) + 2);
        c.fillStyle = COLORS.bass;
        c.globalAlpha = soon ? 0.2 + 0.3 * frac : in2 ? 0.08 + 0.12 * frac : 0.06;
        c.fillRect(x, y, T + 0.5, T + 0.5);
      }
      c.globalAlpha = 1;
    } else if (ch === 's') {
      c.strokeStyle = COLORS.bass;
      c.globalAlpha = 0.5;
      c.lineWidth = 1;
      c.strokeRect(x + 4.5, y + 4.5, T - 9, T - 9);
      c.globalAlpha = 1;
    } else if (ch === 'd' || ch === 'h' || ch === 'b') {
      const inst = ch === 'd' ? 'drum' : ch === 'h' ? 'hat' : 'bass';
      if (s.player.owned.includes(inst)) return;
      const r = 9 + 4 * pulse;
      c.fillStyle = COLORS[inst];
      c.beginPath();
      if (inst === 'drum') c.arc(cx, cy, r, 0, Math.PI * 2);
      else if (inst === 'hat') { c.moveTo(cx, cy - r); c.lineTo(cx + r, cy + r); c.lineTo(cx - r, cy + r); }
      else c.rect(cx - r * 1.3, cy - r * 0.6, r * 2.6, r * 1.2);
      c.fill();
    } else if (ch === 'D') {
      if (s.doorOpen) return;
      c.fillStyle = COLORS.wall;
      c.fillRect(x, y, T + 0.5, T + 0.5);
      (['drum', 'hat', 'bass'] as Instrument[]).forEach((inst, i) => {
        c.fillStyle = s.player.owned.includes(inst) ? COLORS[inst] : COLORS.bg;
        c.fillRect(x + 5 + i * 8, cy - 3, 6, 6);
      });
    } else if (ch === 'T') {
      c.strokeStyle = COLORS.dim;
      c.lineWidth = 2;
      c.beginPath(); c.arc(cx, cy, 12, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.arc(cx, cy, 4, 0, Math.PI * 2); c.stroke();
    }
  }
  /** Trace a boss attack shape as a path. */
  private shapePath(shape: Shape, origin: { x: number; y: number }, boss: { x: number; y: number }, grow = 1): void {
    const c = this.ctx;
    c.beginPath();
    if (shape.kind === 'circle') c.arc(origin.x, origin.y, shape.r * grow, 0, Math.PI * 2);
    else if (shape.kind === 'ring') {
      c.arc(boss.x, boss.y, shape.rOut, 0, Math.PI * 2);
      c.arc(boss.x, boss.y, shape.rIn, 0, Math.PI * 2, true);
    } else if (shape.kind === 'line') {
      const cx = Math.cos(shape.angle), cy = Math.sin(shape.angle), h = shape.width / 2, L = 900 * grow;
      c.moveTo(boss.x + cy * h, boss.y - cx * h);
      c.lineTo(boss.x + cx * L + cy * h, boss.y + cy * L - cx * h);
      c.lineTo(boss.x + cx * L - cy * h, boss.y + cy * L + cx * h);
      c.lineTo(boss.x - cy * h, boss.y + cx * h);
      c.closePath();
    } else c.rect(boss.x + shape.x, boss.y + shape.y, shape.w, shape.h);
  }

  private lastHit = new Set<object>();

  /** The boss, its telegraphs, pads and the harmony rings. */
  protected drawWorld(s: GameState, stepF: number, pulse: number): void {
    const c = this.ctx, b = s.boss;
    if (!b) return;
    const room = s.world.rooms.boss!;
    c.save();
    c.beginPath();
    c.rect(room.x, room.y, room.w, room.h);
    c.clip();

    // Harmony: one ring per level, breathing with the beat.
    for (let i = 0; i < b.harmony; i++) {
      c.strokeStyle = COLORS.lead;
      c.globalAlpha = 0.12 + 0.1 * pulse;
      c.lineWidth = 2;
      c.beginPath(); c.arc(b.x, b.y, 90 + i * 55 + 8 * pulse, 0, Math.PI * 2); c.stroke();
    }
    c.globalAlpha = 1;

    if (!b.defeated) {
      const pat = b.conductor.current;
      // Pads.
      if (pat.texture === 'resolve') {
        for (const pad of b.pads) {
          c.strokeStyle = c.fillStyle = COLORS[pad.inst];
          c.lineWidth = 2;
          c.globalAlpha = pad.locked ? 0.55 : 0.12;
          c.beginPath(); c.arc(pad.x, pad.y, PAD_RADIUS, 0, Math.PI * 2); c.fill();
          c.globalAlpha = 1;
          c.beginPath(); c.arc(pad.x, pad.y, PAD_RADIUS, 0, Math.PI * 2); c.stroke();
          if (!pad.locked && pad.progress > 0) {
            c.lineWidth = 6;
            c.beginPath(); c.arc(pad.x, pad.y, PAD_RADIUS + 7, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * pad.progress) / 16); c.stroke();
          }
        }
      }
      // Lingering zones.
      for (const z of b.zones) {
        c.fillStyle = COLORS[z.layer];
        c.globalAlpha = 0.45 + 0.25 * pulse;
        this.shapePath(z.shape, b, b);
        c.fill();
      }
      // Telegraphs fill up toward the beat they land on.
      for (const a of b.active) {
        const k = Math.max(0, Math.min(1, (stepF - a.startStep) / (a.hitAbs - a.startStep)));
        const color = a.evaded ? COLORS.dim : COLORS[a.spec.layer];
        c.strokeStyle = c.fillStyle = color;
        c.lineWidth = 2;
        c.globalAlpha = 0.35 + 0.5 * k;
        this.shapePath(a.spec.shape, a.origin, b);
        c.stroke();
        c.globalAlpha = 0.08 + 0.3 * k * k;
        if (a.spec.shape.kind === 'circle' || a.spec.shape.kind === 'line') this.shapePath(a.spec.shape, a.origin, b, k);
        else this.shapePath(a.spec.shape, a.origin, b);
        c.fill();
        if (k >= 0.97 && !this.lastHit.has(a)) {
          this.lastHit.add(a);
          this.fx.push({ kind: 'flash', x: a.origin.x, y: a.origin.y, x2: b.x, y2: b.y, color, t: 0, life: 0.18, shape: a.spec.shape });
        }
      }
      if (this.lastHit.size > 64) this.lastHit.clear();
      c.globalAlpha = 1;
    }

    // The boss: a polygon that gains a side with every phrase.
    const local = Math.floor(stepF) - b.phraseStart;
    const pat = b.conductor.current;
    const open = !b.defeated && pat.texture === 'call' && pat.openBars.includes(Math.floor(local / 16));
    const sides = 3 + b.conductor.index;
    const r = b.r * (1 + 0.12 * pulse) * (b.defeated ? 0.6 : 1);
    const rot = -Math.PI / 2 + (b.defeated ? 0 : stepF * 0.02);
    c.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = rot + (i / sides) * Math.PI * 2;
      c[i === 0 ? 'moveTo' : 'lineTo'](b.x + Math.cos(a) * r, b.y + Math.sin(a) * r);
    }
    c.closePath();
    c.fillStyle = c.strokeStyle = b.defeated ? COLORS.dim : COLORS.lead;
    c.lineWidth = 4;
    if (open || b.defeated) c.stroke(); else c.fill();
    if (b.shield) {
      c.strokeStyle = COLORS.ink;
      c.lineWidth = 3;
      c.setLineDash([6, 8]);
      c.beginPath(); c.arc(b.x, b.y, b.r + 16, 0, Math.PI * 2); c.stroke();
      c.setLineDash([]);
    }
    if (!b.defeated) {
      // Health as an arc; a tick marks the gate of this phrase.
      const frac = b.hp / s.tun.bossHp;
      c.strokeStyle = COLORS.wall;
      c.lineWidth = 5;
      c.beginPath(); c.arc(b.x, b.y, b.r + 30, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = pat.weakTo ? COLORS[pat.weakTo] : COLORS.ink;
      c.beginPath(); c.arc(b.x, b.y, b.r + 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); c.stroke();
      const gate = pat.advance.hpBelow;
      if (gate !== undefined && gate > 0) {
        const a = -Math.PI / 2 + Math.PI * 2 * gate;
        c.strokeStyle = COLORS.bg;
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(b.x + Math.cos(a) * (b.r + 24), b.y + Math.sin(a) * (b.r + 24));
        c.lineTo(b.x + Math.cos(a) * (b.r + 36), b.y + Math.sin(a) * (b.r + 36));
        c.stroke();
      }
    }
    c.restore();
  }

  /** Screen-space: health pips and the instruments in hand. No words. */
  protected drawHud(s: GameState, pulse: number): void {
    const c = this.ctx, p = s.player;
    for (let i = 0; i < s.tun.playerHp; i++) {
      c.fillStyle = i < p.hp ? COLORS.ink : COLORS.wall;
      c.fillRect(20 + i * 18, 20, 12, 12);
    }
    (['drum', 'hat', 'bass'] as Instrument[]).forEach((inst, i) => {
      const owned = p.owned.includes(inst), eq = p.equipped === inst;
      const size = eq ? 16 + 4 * pulse : 12, x = 26 + i * 26, y = 58;
      c.fillStyle = owned ? COLORS[inst] : COLORS.wall;
      c.globalAlpha = owned && !eq ? 0.45 : 1;
      c.fillRect(x - size / 2, y - size / 2, size, size);
      c.globalAlpha = 1;
    });
  }

  private drawFx(dt: number): void {
    const c = this.ctx;
    this.fx = this.fx.filter(f => (f.t += dt) < f.life);
    for (const f of this.fx) {
      const k = f.t / f.life;
      c.globalAlpha = 1 - k;
      c.strokeStyle = c.fillStyle = f.color;
      if (f.kind === 'ring') {
        c.lineWidth = 3;
        c.beginPath(); c.arc(f.x, f.y, 14 + 26 * k, 0, Math.PI * 2); c.stroke();
      } else if (f.kind === 'wave') {
        c.lineWidth = 6 * (1 - k) + 1;
        c.beginPath(); c.arc(f.x, f.y, 40 + 420 * k, 0, Math.PI * 2); c.stroke();
      } else if (f.kind === 'flash') {
        c.globalAlpha = 0.5 * (1 - k);
        this.shapePath(f.shape!, { x: f.x, y: f.y }, { x: f.x2!, y: f.y2! });
        c.fill();
      } else if (f.kind === 'burst') {
        c.lineWidth = 4;
        c.beginPath(); c.arc(f.x, f.y, 10 + 60 * k, 0, Math.PI * 2); c.stroke();
      } else if (f.kind === 'atk-drum') {
        c.lineWidth = 6 * (1 - k) + 1;
        c.beginPath(); c.arc(f.x, f.y, 20 + 55 * k, 0, Math.PI * 2); c.stroke();
      } else if (f.kind === 'atk-hat') {
        const x = f.x + (f.x2! - f.x) * k, y = f.y + (f.y2! - f.y) * k;
        c.fillRect(x - 3, y - 3, 6, 6);
      } else if (f.kind === 'atk-bass') {
        c.lineWidth = 5;
        c.beginPath(); c.moveTo(f.x, f.y); c.lineTo(f.x2!, f.y2!); c.stroke();
      }
    }
    c.globalAlpha = 1;
  }

  private drawPlayer(s: GameState, pulse: number): void {
    const c = this.ctx, p = s.player;
    const r = s.tun.playerRadius * (1 + 0.25 * pulse);
    const blink = p.iframe > 0 && !p.dash && Math.floor(s.time * 20) % 2 === 0;
    c.fillStyle = instColor(p.equipped);
    c.globalAlpha = blink ? 0.4 : 1;
    if (p.dash) {
      c.globalAlpha = 0.35;
      c.fillRect(p.x - r - p.dash.vx * 0.03, p.y - r - p.dash.vy * 0.03, r * 2, r * 2);
      c.globalAlpha = 1;
    }
    c.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    c.globalAlpha = 1;
    c.fillStyle = COLORS.bg;
    c.fillRect(p.x + p.faceX * r * 0.5 - 2, p.y + p.faceY * r * 0.5 - 2, 4, 4);
  }
}
