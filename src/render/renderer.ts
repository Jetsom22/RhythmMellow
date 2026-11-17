import { bassSounding, gimmickDeadly } from '../core/game/gimmicks';
import { GameEvent, GameState, Instrument } from '../core/game/types';

export const COLORS = {
  bg: '#0c0d10', floor: '#1b1d22', wall: '#2c2f38', chasm: '#060608', ink: '#e8e6df', dim: '#6b6a66',
  drum: '#ff5a4d', hat: '#ffd23f', bass: '#3fa7ff', lead: '#c77dff', danger: '#ff3d6e',
} as const;
export const instColor = (i: Instrument | null): string => (i ? COLORS[i] : COLORS.ink);

interface Fx { kind: string; x: number; y: number; x2?: number; y2?: number; color: string; t: number; life: number }

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
  protected drawWorld(_s: GameState, _stepF: number, _pulse: number): void {}
  protected drawHud(_s: GameState, _pulse: number): void {}

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
