import { paletteOf } from '../render/theme';
import { outline, Shape } from '../core/stage/shapes';
import { bitsToKinds, Grid, KIND_BIT, Live, liveAt, Model } from './model';

export interface ViewState {
  /** world px at the centre of the canvas */
  cx: number;
  cy: number;
  /** screen px per world px */
  scale: number;
  step: number;
  gatesOpen: boolean;
  /** show where each attack can reach: one kind light, several kinds dark */
  reach: { grid: Grid; road: Uint8Array; enc: Uint8Array } | null;
  highlight: { x: number; y: number }[];
  selected: string | null;
}

const rgba = (c: string, a: number): string => {
  const n = parseInt(c.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export function palette(m: Model) {
  const p = paletteOf(m.data.palette);
  return { ...p, enemyOf: (layer: string): string => (p.enemy as Record<string, string>)[layer] ?? p.danger };
}

export function draw(ctx: CanvasRenderingContext2D, w: number, h: number, m: Model, v: ViewState): void {
  const c = palette(m), sim = m.sim, s = v.scale, u = m.u;
  const X = (x: number): number => w / 2 + (x - v.cx) * s;
  const Y = (y: number): number => h / 2 + (y - v.cy) * s;

  for (const g of sim.gates) g.open = v.gatesOpen || (!g.requires.layer && !g.requires.flag && !g.requires.flags && g.requires.parts === undefined);

  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = rgba(c.danger, 0.18);
  for (let y = 4; y < h; y += 10) for (let x = 4 + ((y / 10) % 2) * 5; x < w; x += 10) ctx.fillRect(x, y, 1.4, 1.4);

  const path = (sh: Shape): void => {
    ctx.beginPath();
    switch (sh.kind) {
      case 'circle': ctx.arc(X(sh.x), Y(sh.y), sh.r * s, 0, Math.PI * 2); break;
      case 'sector': {
        const span = (((sh.a1 - sh.a0) % 360) + 360) % 360 || 360, a0 = (sh.a0 * Math.PI) / 180, a1 = a0 + (span * Math.PI) / 180;
        ctx.arc(X(sh.x), Y(sh.y), sh.r1 * s, a0, a1);
        if (sh.r0 > 0) ctx.arc(X(sh.x), Y(sh.y), sh.r0 * s, a1, a0, true); else ctx.lineTo(X(sh.x), Y(sh.y));
        ctx.closePath();
        break;
      }
      case 'capsule': {
        const a = Math.atan2(sh.y2 - sh.y1, sh.x2 - sh.x1);
        ctx.arc(X(sh.x1), Y(sh.y1), sh.r * s, a + Math.PI / 2, a + (3 * Math.PI) / 2);
        ctx.arc(X(sh.x2), Y(sh.y2), sh.r * s, a - Math.PI / 2, a + Math.PI / 2);
        ctx.closePath();
        break;
      }
      case 'rect': {
        const r = ((sh.rot ?? 0) * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
        const pts: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        pts.forEach(([a, b], i) => {
          const px = sh.x + (a * sh.w) / 2 * cs - (b * sh.h) / 2 * sn, py = sh.y + (a * sh.w) / 2 * sn + (b * sh.h) / 2 * cs;
          if (i) ctx.lineTo(X(px), Y(py)); else ctx.moveTo(X(px), Y(py));
        });
        ctx.closePath();
        break;
      }
      case 'polygon': sh.points.forEach(([px, py], i) => (i ? ctx.lineTo(X(px), Y(py)) : ctx.moveTo(X(px), Y(py)))); ctx.closePath(); break;
    }
  };

  // ground, holes, open gates, then the edge line where ground meets the void
  ctx.fillStyle = c.bg;
  for (const g of sim.ground) { path(g); ctx.fill('evenodd'); }
  ctx.fillStyle = rgba(c.danger, 0.1);
  for (const hl of sim.holes) { path(hl); ctx.fill('evenodd'); }
  ctx.fillStyle = c.bg;
  for (const g of sim.gates) if (g.open) { path(g.shape); ctx.fill(); }
  // the edge: points of every outline where ground is on one side and void on the other, joined into lines
  ctx.strokeStyle = c.ink; ctx.lineWidth = 1.2;
  const eps = 3 / Math.max(s, 0.01);
  for (const sh of [...sim.ground, ...sim.holes, ...sim.gates.filter(g => g.open).map(g => g.shape)]) {
    const step = 5 / Math.max(s, 0.01), raw = outline(sh, step), pts: [number, number, number, number][] = [];
    // fill in straight runs (a sector's sides) so their edges are tested too
    for (let i = 0; i < raw.length; i++) {
      pts.push(raw[i]);
      const q = raw[i + 1];
      if (!q) break;
      const [x0, y0] = raw[i], dx = q[0] - x0, dy = q[1] - y0, L = Math.hypot(dx, dy);
      for (let t = step; t < L - step / 2; t += step) pts.push([x0 + (dx * t) / L, y0 + (dy * t) / L, -dy / L, dx / L]);
    }
    let prev: [number, number] | null = null;
    ctx.beginPath();
    for (const [x, y, nx, ny] of pts) {
      const edge = sim.isGround(x - nx * eps, y - ny * eps) !== sim.isGround(x + nx * eps, y + ny * eps);
      if (edge && prev) ctx.lineTo(X(x), Y(y)); else if (edge) ctx.moveTo(X(x), Y(y));
      prev = edge ? [x, y] : null;
    }
    ctx.stroke();
  }
  ctx.setLineDash([4, 4]); ctx.strokeStyle = rgba(c.ink, 0.45); ctx.lineWidth = 1;
  for (const g of sim.gates) if (!g.open) { path(g.shape); ctx.stroke(); }
  ctx.setLineDash([]);

  // where attacks can reach
  if (v.reach) {
    const { grid: g, road, enc } = v.reach, size = g.cell * s + 0.5;
    for (let k = 0; k < road.length; k++) {
      const b = road[k] | enc[k];
      if (!b) continue;
      const kinds = bitsToKinds(b);
      const i = k % g.n, j = (k - i) / g.n;
      ctx.fillStyle = kinds.length > 1 ? rgba(c.ink, 0.28) : rgba(c.enemyOf({ circle: 'lead', ring: 'drum', beam: 'hat', zone: 'bass' }[kinds[0]]), b === KIND_BIT.circle ? 0.12 : 0.18);
      ctx.fillRect(X(g.x(i)) - size / 2, Y(g.y(j)) - size / 2, size, size);
    }
  }

  // encounter circles
  ctx.setLineDash([1, 4]); ctx.lineCap = 'round'; ctx.strokeStyle = rgba(c.ink, 0.5); ctx.lineWidth = 1.6;
  for (const e of sim.encounters) { ctx.beginPath(); ctx.arc(X(e.x), Y(e.y), e.r * s, 0, Math.PI * 2); ctx.stroke(); }
  ctx.setLineDash([]); ctx.lineCap = 'butt';

  // attacks playing at this step
  for (const l of liveAt(m, v.step)) drawLive(ctx, l, c.enemyOf(l.inst.layer), X, Y, s);

  // plates, parts, checkpoints, start
  for (const p of sim.plates) {
    ctx.strokeStyle = c.player[p.layer]; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), Math.max(4, p.r * s), 0, Math.PI * 2); ctx.stroke();
    if (v.gatesOpen && !p.encounter) { ctx.fillStyle = rgba(c.player[p.layer], 0.5); ctx.fill(); }
  }
  for (const p of sim.parts) { ctx.fillStyle = c.player[p.layer]; ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), Math.max(6, 0.6 * u * s), 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = c.ink;
  for (const cp of sim.checkpoints) { const x = X(cp.x), y = Y(cp.y); ctx.beginPath(); ctx.moveTo(x - 5, y + 4); ctx.lineTo(x + 5, y + 4); ctx.lineTo(x, y - 6); ctx.closePath(); ctx.fill(); }
  { const x = X(m.data.start[0] * u), y = Y(m.data.start[1] * u); ctx.strokeStyle = c.ink; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke(); }

  // emitters
  for (const e of sim.emitters) {
    if (e.hidden) continue;
    const x = X(e.x), y = Y(e.y);
    const ev = e.follow ?? e.pattern.events[0];
    const col = e.kind === 'boss' ? c.enemy.lead : c.enemyOf(ev ? sim.attacks[ev.attack]?.layer ?? 'drum' : 'drum');
    ctx.fillStyle = col;
    if (e.kind === 'monster') { ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 7, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 7, y); ctx.closePath(); ctx.fill(); }
    else if (e.kind === 'device') ctx.fillRect(x - 5, y - 5, 10, 10);
    else { ctx.beginPath(); ctx.arc(x, y, Math.max(e.kind === 'boss' ? 10 : 8, e.body * s), 0, Math.PI * 2); ctx.fill(); }
    if (v.selected === e.id) { ctx.strokeStyle = c.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.stroke(); }
  }

  // what the report points at
  const pulse = 10 + 4 * Math.sin(performance.now() / 160);
  ctx.strokeStyle = c.danger; ctx.lineWidth = 2.5;
  for (const p of v.highlight) { ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), pulse + 8, 0, Math.PI * 2); ctx.stroke(); }

  // scale
  const bar = u * s;
  ctx.strokeStyle = c.ink; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(16, h - 18); ctx.lineTo(16 + bar, h - 18); ctx.moveTo(16, h - 22); ctx.lineTo(16, h - 14); ctx.moveTo(16 + bar, h - 22); ctx.lineTo(16 + bar, h - 14); ctx.stroke();
  ctx.font = '11px Jost, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillStyle = c.ink;
  ctx.fillText(`1U = ${Math.round(u)}px (한 박 동안 걷는 거리)`, 22 + bar, h - 18);
}

function drawLive(ctx: CanvasRenderingContext2D, l: Live, col: string, X: (x: number) => number, Y: (y: number) => number, s: number): void {
  const a = l.phase === 'tele' ? 0.1 + 0.42 * l.grow : l.phase === 'hit' ? 0.95 : l.phase === 'hold' ? 0.45 : 0;
  const g = l.phase === 'tele' ? 0.35 + 0.65 * l.grow : 1;
  const sh = l.inst.def.shape, x = X(l.inst.x), y = Y(l.inst.y);
  ctx.save();
  if (l.phase === 'after') { ctx.strokeStyle = rgba(col, 0.45); ctx.lineWidth = 1; } else ctx.fillStyle = rgba(col, a);
  const paint = (): void => { if (l.phase === 'after') ctx.stroke(); else ctx.fill('evenodd'); };
  ctx.translate(x, y);
  ctx.rotate(l.inst.rot);
  ctx.beginPath();
  switch (sh.kind) {
    case 'circle': ctx.arc(0, 0, sh.r * s * g, 0, Math.PI * 2); break;
    case 'ring': ctx.arc(0, 0, sh.r1 * s * (l.phase === 'tele' ? 0.88 + 0.12 * l.grow : 1), 0, Math.PI * 2); ctx.arc(0, 0, sh.r0 * s, 0, Math.PI * 2, true); break;
    case 'beam': ctx.rect(0, (-sh.w / 2) * s, (sh.len ?? 5 * 120) * s * g, sh.w * s); break;
    case 'zone': ctx.rect((-sh.w / 2) * s * g, (-sh.h / 2) * s * g, sh.w * s * g, sh.h * s * g); break;
  }
  paint();
  ctx.restore();
}
