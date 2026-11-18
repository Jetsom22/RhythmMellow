/**
 * The ground, as shapes rather than tiles. Ground is the union of ground shapes minus holes.
 * There are no walls: everything that is not ground is deadly.
 * Stage data is written in U (the distance walked in one beat) and scaled to pixels when loaded.
 * Angles are degrees, y points down.
 */
export type Shape =
  | { kind: 'circle'; x: number; y: number; r: number }
  | { kind: 'capsule'; x1: number; y1: number; x2: number; y2: number; r: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; rot?: number }
  | { kind: 'sector'; x: number; y: number; r0: number; r1: number; a0: number; a1: number }
  | { kind: 'polygon'; points: [number, number][] };

const RAD = Math.PI / 180;
const mod = (v: number, m: number): number => ((v % m) + m) % m;
const span = (s: { a0: number; a1: number }): number => mod(s.a1 - s.a0, 360) || 360;

export function contains(s: Shape, px: number, py: number): boolean {
  switch (s.kind) {
    case 'circle': return (px - s.x) ** 2 + (py - s.y) ** 2 <= s.r * s.r;
    case 'capsule': {
      const dx = s.x2 - s.x1, dy = s.y2 - s.y1, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / L)) : 0;
      return (px - s.x1 - dx * t) ** 2 + (py - s.y1 - dy * t) ** 2 <= s.r * s.r;
    }
    case 'rect': {
      const a = -(s.rot ?? 0) * RAD, c = Math.cos(a), n = Math.sin(a), dx = px - s.x, dy = py - s.y;
      return Math.abs(dx * c - dy * n) <= s.w / 2 && Math.abs(dx * n + dy * c) <= s.h / 2;
    }
    case 'sector': {
      const dx = px - s.x, dy = py - s.y, r = Math.hypot(dx, dy);
      if (r < s.r0 || r > s.r1) return false;
      return mod(Math.atan2(dy, dx) / RAD - s.a0, 360) <= span(s);
    }
    case 'polygon': {
      let inside = false;
      const p = s.points;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        if ((p[i][1] > py) !== (p[j][1] > py) && px < ((p[j][0] - p[i][0]) * (py - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) inside = !inside;
      }
      return inside;
    }
  }
}

/** Points along a shape's edge, each with its outward normal: [x, y, nx, ny]. */
export function outline(s: Shape, spacing: number): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const arc = (cx: number, cy: number, r: number, a0: number, a1: number, sg: number, min: number): void => {
    const n = Math.max(min, Math.floor((Math.abs(a1 - a0) * r) / spacing));
    for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, sg * Math.cos(a), sg * Math.sin(a)]); }
  };
  const edge = (x0: number, y0: number, x1: number, y1: number, nx: number, ny: number): void => {
    const n = Math.max(1, Math.floor(Math.hypot(x1 - x0, y1 - y0) / spacing));
    for (let i = 0; i <= n; i++) out.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, nx, ny]);
  };
  switch (s.kind) {
    case 'circle': arc(s.x, s.y, s.r, 0, Math.PI * 2, 1, 24); break;
    case 'capsule': {
      const base = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
      arc(s.x1, s.y1, s.r, base + Math.PI / 2, base + Math.PI * 1.5, 1, 8);
      arc(s.x2, s.y2, s.r, base - Math.PI / 2, base + Math.PI / 2, 1, 8);
      out.push(out[0]);
      break;
    }
    case 'rect': {
      const a = (s.rot ?? 0) * RAD, c = Math.cos(a), n = Math.sin(a), hw = s.w / 2, hh = s.h / 2;
      const at = (x: number, y: number): [number, number] => [s.x + x * c - y * n, s.y + x * n + y * c];
      const corners: [number, number][] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
      const normals: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
      for (let k = 0; k < 4; k++) {
        const [x0, y0] = at(...corners[k]), [x1, y1] = at(...corners[(k + 1) % 4]);
        edge(x0, y0, x1, y1, normals[k][0] * c - normals[k][1] * n, normals[k][0] * n + normals[k][1] * c);
      }
      break;
    }
    case 'sector': {
      const a0 = s.a0 * RAD, sp = span(s) * RAD;
      arc(s.x, s.y, s.r1, a0, a0 + sp, 1, 8);
      if (sp < Math.PI * 2 - 1e-9 || s.r0 > 0) { arc(s.x, s.y, s.r0, a0 + sp, a0, -1, 4); out.push(out[0]); }
      break;
    }
    case 'polygon': {
      const p = s.points;
      for (let k = 0; k < p.length; k++) {
        const [x0, y0] = p[k], [x1, y1] = p[(k + 1) % p.length], L = Math.hypot(x1 - x0, y1 - y0) || 1;
        edge(x0, y0, x1, y1, (y1 - y0) / L, -(x1 - x0) / L);
      }
      break;
    }
  }
  return out;
}

/** Turn a shape written in U into pixels. */
export function scaled(s: Shape, u: number): Shape {
  switch (s.kind) {
    case 'circle': return { kind: 'circle', x: s.x * u, y: s.y * u, r: s.r * u };
    case 'capsule': return { kind: 'capsule', x1: s.x1 * u, y1: s.y1 * u, x2: s.x2 * u, y2: s.y2 * u, r: s.r * u };
    case 'rect': return { kind: 'rect', x: s.x * u, y: s.y * u, w: s.w * u, h: s.h * u, rot: s.rot ?? 0 };
    case 'sector': return { kind: 'sector', x: s.x * u, y: s.y * u, r0: s.r0 * u, r1: s.r1 * u, a0: s.a0, a1: s.a1 };
    case 'polygon': return { kind: 'polygon', points: s.points.map(([x, y]) => [x * u, y * u]) };
  }
}

/** Where a shape sits, for placing marks on it. */
export function centreOf(s: Shape): { x: number; y: number } {
  switch (s.kind) {
    case 'capsule': return { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
    case 'polygon': return { x: s.points.reduce((a, p) => a + p[0], 0) / s.points.length, y: s.points.reduce((a, p) => a + p[1], 0) / s.points.length };
    case 'sector': { const a = (s.a0 + (mod(s.a1 - s.a0, 360) || 360) / 2) * RAD, r = (s.r0 + s.r1) / 2; return { x: s.x + Math.cos(a) * r, y: s.y + Math.sin(a) * r }; }
    default: return { x: s.x, y: s.y };
  }
}
