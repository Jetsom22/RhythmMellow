import { paletteOf } from '../render/theme';
import { GroundShape, Pt, Stage } from './stage';
import { Live, liveAt, playingAt } from './timeline';

export interface ViewState {
  /** world px at the centre of the canvas */
  cx: number;
  cy: number;
  /** screen px per world px */
  scale: number;
  step: number;
  showAreas: boolean;
  showRoutes: boolean;
  padsLit: number;
  highlight: Pt[];
  selected: string | null;
}

export function colors(st: Stage) {
  const p = paletteOf(st.data.palette);
  const enemy = (layer: string): string => (p.enemy as Record<string, string>)[layer] ?? p.danger;
  return { ...p, enemyOf: enemy };
}

const mix = (c: string, a: number): string => {
  const n = parseInt(c.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export function draw(ctx: CanvasRenderingContext2D, w: number, h: number, st: Stage, v: ViewState): void {
  const c = colors(st), u = st.u, s = v.scale;
  const X = (x: number): number => w / 2 + (x - v.cx) * s;
  const Y = (y: number): number => h / 2 + (y - v.cy) * s;
  const P = (p: Pt): [number, number] => [X(p.x), Y(p.y)];

  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, w, h);
  // the void: faint dots everywhere, the ground is painted over them
  ctx.fillStyle = mix(c.danger, 0.2);
  for (let y = 4; y < h; y += 10) for (let x = 4 + ((y / 10) % 2) * 5; x < w; x += 10) ctx.fillRect(x, y, 1.4, 1.4);

  const EDGE = 1.3;
  const shapePath = (g: GroundShape, grow: number): void => {
    ctx.beginPath();
    if (g.type === 'circle') { const [x, y] = P(st.pos(g.at)); ctx.arc(x, y, g.radius * u * s + grow, 0, Math.PI * 2); }
    else if (g.type === 'ring') {
      const [x, y] = P(st.pos(g.at));
      ctx.arc(x, y, g.outer * u * s + grow, 0, Math.PI * 2);
      ctx.moveTo(x + g.inner * u * s - grow, y);
      ctx.arc(x, y, Math.max(0, g.inner * u * s - grow), 0, Math.PI * 2, true);
    }
  };
  const fillShape = (g: GroundShape, color: string, grow: number): void => {
    if (g.type === 'path') {
      ctx.strokeStyle = color; ctx.lineWidth = g.width * u * s + grow * 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); g.points.map(st.pos).forEach((p, i) => (i ? ctx.lineTo(...P(p)) : ctx.moveTo(...P(p)))); ctx.stroke();
    } else { ctx.fillStyle = color; shapePath(g, grow); ctx.fill('evenodd'); }
  };

  const f = st.data.field;
  f.ground.forEach(g => fillShape(g, c.ink, EDGE));
  f.ground.forEach(g => fillShape(g, c.bg, 0));
  // holes are clipped to the ground so cliffs end at the field's edge
  ctx.save();
  ctx.beginPath();
  for (const g of f.ground) if (g.type === 'circle') { const [x, y] = P(st.pos(g.at)); ctx.moveTo(x + g.radius * u * s, y); ctx.arc(x, y, g.radius * u * s, 0, Math.PI * 2); }
  ctx.clip('nonzero');
  f.holes.forEach(g => fillShape(g, c.ink, EDGE));
  f.holes.forEach(g => fillShape(g, c.bg, 0));
  f.holes.forEach(g => fillShape(g, mix(c.danger, 0.1), 0));
  ctx.restore();
  for (const b of f.bridges) {
    const open = v.padsLit >= b.opensWhen.padsLit;
    if (open) { fillShape(b, c.ink, EDGE); fillShape(b, c.bg, 0); }
    else if (b.type === 'path') {
      ctx.setLineDash([4, 4]); ctx.strokeStyle = mix(c.ink, 0.5); ctx.lineWidth = 1;
      const pts = b.points.map(st.pos), a = pts[0], z = pts[pts.length - 1], ang = Math.atan2(z.y - a.y, z.x - a.x) + Math.PI / 2, hw = (b.width / 2) * u;
      for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(...P({ x: a.x + side * hw * Math.cos(ang), y: a.y + side * hw * Math.sin(ang) })); ctx.lineTo(...P({ x: z.x + side * hw * Math.cos(ang), y: z.y + side * hw * Math.sin(ang) })); ctx.stroke(); }
      ctx.setLineDash([]);
    }
  }

  // areas and routes
  const areaCentre = (id: string): Pt => {
    const a = st.data.areas.find(x => x.id === id)!;
    if (a.shape.type === 'circle') return st.pos(a.shape.at);
    const span = (((a.shape.to - a.shape.from) % 360) + 360) % 360 || 360;
    if (span === 360) return { x: 0, y: ((a.shape.inner + a.shape.outer) / 2) * u };
    const mid = ((a.shape.from + span / 2) * Math.PI) / 180, r = ((a.shape.inner + a.shape.outer) / 2) * u;
    return { x: r * Math.cos(mid), y: r * Math.sin(mid) };
  };
  ctx.font = '11px Jost, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (v.showAreas) {
    ctx.strokeStyle = mix(c.ink, 0.25); ctx.setLineDash([2, 4]); ctx.lineWidth = 1;
    for (const a of st.data.areas) {
      ctx.beginPath();
      if (a.shape.type === 'circle') { const [x, y] = P(st.pos(a.shape.at)); ctx.arc(x, y, a.shape.radius * u * s, 0, Math.PI * 2); }
      else {
        const f0 = (a.shape.from * Math.PI) / 180, t0 = (a.shape.to * Math.PI) / 180, ox = X(0), oy = Y(0);
        ctx.arc(ox, oy, a.shape.outer * u * s, f0, t0); ctx.arc(ox, oy, a.shape.inner * u * s, t0, f0, true); ctx.closePath();
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = mix(c.ink, 0.55);
    for (const a of st.data.areas) { const [x, y] = P(areaCentre(a.id)); ctx.fillText(a.name.replace(/구역 /, ''), x, y - (a.id === 'center' ? 0 : 14)); }
  }
  if (v.showRoutes) {
    for (const r of st.data.routes) {
      const [x1, y1] = P(areaCentre(r.from)), [x2, y2] = P(areaCentre(r.to));
      ctx.strokeStyle = r.requires ? mix(c.player.drum, 0.8) : mix(c.ink, 0.45); ctx.lineWidth = 1.4;
      ctx.setLineDash(r.twoWay ? [] : [5, 4]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
      const a = Math.atan2(y2 - y1, x2 - x1), mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      ctx.beginPath(); ctx.moveTo(mx + 6 * Math.cos(a), my + 6 * Math.sin(a)); ctx.lineTo(mx + 6 * Math.cos(a + 2.5), my + 6 * Math.sin(a + 2.5)); ctx.lineTo(mx + 6 * Math.cos(a - 2.5), my + 6 * Math.sin(a - 2.5)); ctx.closePath();
      ctx.fillStyle = ctx.strokeStyle as string; ctx.fill();
    }
  }

  // live attacks under the emitters
  for (const e of st.data.emitters) for (const l of liveAt(st, e, v.step)) drawLive(ctx, l, c.enemyOf(l.layer), X, Y, s);

  // pads, parts, checkpoints, start
  const insts = st.data.pads;
  insts.forEach((pad, i) => {
    const [x, y] = P(st.pos(pad.at)), col = c.player[pad.instrument];
    ctx.strokeStyle = col; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.arc(x, y, Math.max(5, 40 * s), 0, Math.PI * 2); ctx.stroke();
    if (i < v.padsLit) { ctx.fillStyle = mix(col, 0.5); ctx.fill(); }
  });
  for (const p of st.data.parts) { const [x, y] = P(st.pos(p.at)); ctx.fillStyle = c.player[p.instrument]; ctx.beginPath(); ctx.arc(x, y, Math.max(6, 0.7 * u * s), 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = c.ink;
  for (const cp of st.data.checkpoints) { const [x, y] = P(st.pos(cp.at)); ctx.beginPath(); ctx.moveTo(x - 5, y + 4); ctx.lineTo(x + 5, y + 4); ctx.lineTo(x, y - 6); ctx.closePath(); ctx.fill(); }
  { const [x, y] = P(st.pos(st.data.start.at)); ctx.strokeStyle = c.ink; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke(); }

  // emitters on top
  for (const e of st.data.emitters) {
    const [x, y] = P(st.pos(e.at));
    const { pat } = playingAt(st, e, v.step);
    const col = c.enemyOf(pat.hits[0]?.layer ?? 'drum');
    ctx.fillStyle = col; ctx.strokeStyle = col;
    if (e.kind === 'monster') { ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 7, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 7, y); ctx.closePath(); ctx.fill(); }
    else if (e.kind === 'device') { ctx.fillRect(x - 5, y - 5, 10, 10); }
    else if (e.kind === 'guardian') { ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 1.5; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.arc(x, y, 4 * u * s, 0, Math.PI * 2); ctx.strokeStyle = mix(c.ink, 0.5); ctx.stroke(); ctx.setLineDash([]); }
    else { ctx.fillStyle = c.enemy.lead; ctx.beginPath(); ctx.arc(x, y, Math.max(10, 36 * s), 0, Math.PI * 2); ctx.fill(); }
    if (v.selected === e.id) { ctx.strokeStyle = c.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.stroke(); }
  }

  // things the report points at
  const pulse = 10 + 4 * Math.sin(performance.now() / 160);
  ctx.strokeStyle = c.danger; ctx.lineWidth = 2.5;
  for (const p of v.highlight) { const [x, y] = P(p); ctx.beginPath(); ctx.arc(x, y, pulse + 8, 0, Math.PI * 2); ctx.stroke(); }

  // scale bar
  const bar = u * s;
  ctx.strokeStyle = c.ink; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(16, h - 18); ctx.lineTo(16 + bar, h - 18); ctx.moveTo(16, h - 22); ctx.lineTo(16, h - 14); ctx.moveTo(16 + bar, h - 22); ctx.lineTo(16 + bar, h - 14); ctx.stroke();
  ctx.textAlign = 'left'; ctx.fillStyle = c.ink; ctx.fillText(`1U = ${u}px (한 박 걸음)`, 22 + bar, h - 18);
}

function drawLive(ctx: CanvasRenderingContext2D, l: Live, col: string, X: (x: number) => number, Y: (y: number) => number, s: number): void {
  const a = l.phase === 'tele' ? 0.1 + 0.42 * l.grow : l.phase === 'hit' ? 0.95 : l.phase === 'hold' ? 0.45 : 0;
  const g = l.phase === 'tele' ? 0.35 + 0.65 * l.grow : 1;
  const x = X(l.at.x), y = Y(l.at.y), sh = l.shape;
  ctx.save();
  if (l.phase === 'after') { ctx.strokeStyle = mix(col, 0.45); ctx.lineWidth = 1; }
  else ctx.fillStyle = mix(col, a);
  const paint = (): void => { if (l.phase === 'after') ctx.stroke(); else ctx.fill('evenodd'); };
  switch (sh.type) {
    case 'circle': ctx.beginPath(); ctx.arc(x, y, sh.radius * s * g, 0, Math.PI * 2); paint(); break;
    case 'ring': ctx.beginPath(); ctx.arc(x, y, sh.outer * s * (l.phase === 'tele' ? 0.88 + 0.12 * l.grow : 1), 0, Math.PI * 2); ctx.arc(x, y, sh.inner * s, 0, Math.PI * 2, true); paint(); break;
    case 'beam': {
      const len = (sh.length ?? l.beamLength ?? 400) * s;
      for (const deg of sh.angles) { ctx.save(); ctx.translate(x, y); ctx.rotate((deg * Math.PI) / 180); ctx.beginPath(); ctx.rect(0, (-sh.width / 2) * s, len * g, sh.width * s); paint(); ctx.restore(); }
      break;
    }
    case 'zone': ctx.beginPath(); ctx.rect(x - (sh.w / 2) * s * g, y - (sh.h / 2) * s * g, sh.w * s * g, sh.h * s * g); paint(); break;
  }
  ctx.restore();
}
