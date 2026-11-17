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

  protected drawTiles(s: GameState, _stepF: number, _pulse: number): void {
    const c = this.ctx, wd = s.world, T = wd.tile;
    const c0 = Math.max(0, Math.floor(this.camX / T)), c1 = Math.min(wd.cols - 1, Math.floor((this.camX + this.width) / T));
    const r0 = Math.max(0, Math.floor(this.camY / T)), r1 = Math.min(wd.rows - 1, Math.floor((this.camY + this.height) / T));
    for (let r = r0; r <= r1; r++) {
      for (let col = c0; col <= c1; col++) {
        const ch = wd.cells[r][col];
        c.fillStyle = ch === '#' ? COLORS.wall : ch === '~' ? COLORS.chasm : COLORS.floor;
        c.fillRect(col * T, r * T, T + 0.5, T + 0.5);
        this.drawTile(s, ch, col * T, r * T, T, col, r);
      }
    }
  }

  /** Per-tile extras; filled in as gimmicks arrive. */
  protected drawTile(_s: GameState, _ch: string, _x: number, _y: number, _T: number, _col: number, _row: number): void {}
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
