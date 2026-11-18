import { AreaShape, GroundShape, Pt, Stage } from './stage';

/** Distance from p to the segment ab. */
export function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Is p inside the shape? Lengths in the shape are in U, p in px. */
export function inShape(st: Stage, s: GroundShape, p: Pt): boolean {
  const u = st.u;
  switch (s.type) {
    case 'circle': { const c = st.pos(s.at); return Math.hypot(p.x - c.x, p.y - c.y) <= s.radius * u; }
    case 'ring': { const c = st.pos(s.at), d = Math.hypot(p.x - c.x, p.y - c.y); return d >= s.inner * u && d <= s.outer * u; }
    case 'path': {
      const pts = s.points.map(st.pos);
      for (let i = 0; i + 1 < pts.length; i++) if (segDist(p, pts[i], pts[i + 1]) <= (s.width / 2) * u) return true;
      return false;
    }
  }
}

export function inArea(st: Stage, s: AreaShape, p: Pt): boolean {
  const u = st.u;
  if (s.type === 'circle') { const c = st.pos(s.at); return Math.hypot(p.x - c.x, p.y - c.y) <= s.radius * u; }
  const d = Math.hypot(p.x, p.y) / u;
  if (d < s.inner || d > s.outer) return false;
  const deg = (Math.atan2(p.y, p.x) * 180) / Math.PI;
  const span = (((s.to - s.from) % 360) + 360) % 360 || 360;
  const off = (((deg - s.from) % 360) + 360) % 360;
  return off <= span;
}

/** Can the player stand here? Bridges count as ground once they are open. */
export function onGround(st: Stage, p: Pt, padsLit = 0): boolean {
  const f = st.data.field;
  if (f.bridges.some(b => padsLit >= b.opensWhen.padsLit && inShape(st, b, p))) return true;
  if (!f.ground.some(g => inShape(st, g, p))) return false;
  return !f.holes.some(h => inShape(st, h, p));
}

export function areaAt(st: Stage, p: Pt): string | null {
  for (const a of st.data.areas) if (inArea(st, a.shape, p)) return a.id;
  return null;
}
