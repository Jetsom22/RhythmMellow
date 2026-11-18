import { contains, Shape } from './shapes';

/**
 * The ground as one soft lump: the shapes that make it up melt into each other where they meet.
 * It is a distance field: sd(x, y) is negative on the ground, zero on its edge, positive off it.
 * The same field decides where the player can stand and where the edge is drawn, so the two always agree.
 *
 * Order: ground shapes are joined, holes are cut out of that, and open ways (bridges) are laid over the holes.
 */
const RAD = Math.PI / 180;
const mod = (v: number, m: number): number => ((v % m) + m) % m;
/** A smooth minimum: where two shapes are closer than k, they flow into each other. */
const smin = (a: number, b: number, k: number): number => { if (k <= 0) return Math.min(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - (h * h * k) / 4; };
const seg = (px: number, py: number, x1: number, y1: number, x2: number, y2: number): number => {
  const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L)) : 0;
  return Math.hypot(px - x1 - dx * t, py - y1 - dy * t);
};

/** Signed distance from a point to a shape's edge (negative inside). */
export function sdShape(s: Shape, px: number, py: number): number {
  switch (s.kind) {
    case 'circle': return Math.hypot(px - s.x, py - s.y) - s.r;
    case 'capsule': return seg(px, py, s.x1, s.y1, s.x2, s.y2) - s.r;
    case 'rect': {
      const a = -(s.rot ?? 0) * RAD, c = Math.cos(a), n = Math.sin(a), dx = px - s.x, dy = py - s.y;
      const qx = Math.abs(dx * c - dy * n) - s.w / 2, qy = Math.abs(dx * n + dy * c) - s.h / 2;
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
    }
    case 'sector': {
      const dx = px - s.x, dy = py - s.y, r = Math.hypot(dx, dy), span = mod(s.a1 - s.a0, 360) || 360;
      const radial = Math.max(s.r0 - r, r - s.r1);
      if (span >= 360) return radial;
      const edge = (a: number): number => seg(px, py, s.x + Math.cos(a * RAD) * s.r0, s.y + Math.sin(a * RAD) * s.r0, s.x + Math.cos(a * RAD) * s.r1, s.y + Math.sin(a * RAD) * s.r1);
      const sides = Math.min(edge(s.a0), edge(s.a1));
      if (mod(Math.atan2(dy, dx) / RAD - s.a0, 360) <= span) return radial > 0 ? radial : Math.max(radial, -sides);
      return radial > 0 ? Math.min(sides, Math.hypot(radial, Math.min(sides, 1e9))) : sides;
    }
    case 'polygon': {
      let d = Infinity;
      const p = s.points;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) d = Math.min(d, seg(px, py, p[j][0], p[j][1], p[i][0], p[i][1]));
      return contains(s, px, py) ? -d : d;
    }
  }
}

const CELL = 256, HALF_DIAG = (CELL * Math.SQRT2) / 2;

export class GroundField {
  /** Bumped whenever the ground changes (a way opens), so drawings made from it can be redone. */
  version = 0;
  private ways: Shape[] = [];
  private buckets = new Map<string, { g: Shape[]; h: Shape[]; w: Shape[] }>();

  /** k is how far apart shapes start to melt together, in pixels. 0 is plain geometry. */
  constructor(readonly ground: Shape[], readonly holes: Shape[], readonly k: number) {}

  setWays(ways: Shape[]): void {
    if (ways.length === this.ways.length && ways.every((w, i) => w === this.ways[i])) return;
    this.ways = ways;
    this.buckets.clear();
    this.version++;
  }

  private bucket(px: number, py: number): { g: Shape[]; h: Shape[]; w: Shape[] } {
    const cx = Math.floor(px / CELL), cy = Math.floor(py / CELL), key = cx + ',' + cy;
    let b = this.buckets.get(key);
    if (!b) {
      const mx = (cx + .5) * CELL, my = (cy + .5) * CELL, near = (s: Shape): boolean => sdShape(s, mx, my) <= HALF_DIAG + 2 * this.k + 8;
      this.buckets.set(key, (b = { g: this.ground.filter(near), h: this.holes.filter(near), w: this.ways.filter(near) }));
    }
    return b;
  }

  sd(px: number, py: number): number {
    const b = this.bucket(px, py), k = this.k;
    let d = k + 8;                                    // nothing near: well off the ground
    for (const s of b.g) d = smin(d, sdShape(s, px, py), k);
    for (const s of b.h) d = -smin(-d, sdShape(s, px, py), k * .5);
    for (const s of b.w) d = smin(d, sdShape(s, px, py), k * .5);
    return d;
  }

  isGround(px: number, py: number): boolean { return this.sd(px, py) <= 0; }

  /** The direction that leads away from the ground. */
  grad(px: number, py: number): [number, number] {
    const e = 1.2, gx = this.sd(px + e, py) - this.sd(px - e, py), gy = this.sd(px, py + e) - this.sd(px, py - e), L = Math.hypot(gx, gy) || 1;
    return [gx / L, gy / L];
  }

  /** Move a point d pixels along (vx, vy); it bounces off the edge of the ground. Returns [x, y, bounces]. */
  travel(x: number, y: number, vx: number, vy: number, d: number): [number, number, number] {
    let hits = 0;
    for (let n = 0; n < 120 && d > 0; n++) {
      const s = Math.min(4, d), nx = x + vx * s, ny = y + vy * s;
      if (this.sd(nx, ny) > 0) {
        let lo = 0, hi = s;
        for (let i = 0; i < 6; i++) { const m = (lo + hi) / 2; if (this.sd(x + vx * m, y + vy * m) > 0) hi = m; else lo = m; }
        x += vx * lo; y += vy * lo; d -= lo;
        const [gx, gy] = this.grad(x, y), dot = vx * gx + vy * gy;
        if (dot > 0) { vx -= 2 * dot * gx; vy -= 2 * dot * gy; hits++; }
        x -= gx * .3; y -= gy * .3;
        if (lo < 1e-3 && dot <= 0) { x += vx * s; y += vy * s; d -= s; }    // already off the ground: keep going
        continue;
      }
      x = nx; y = ny; d -= s;
    }
    return [x, y, hits];
  }

  /**
   * The line where the field equals `level` inside a square, as segments [x0, y0, x1, y1].
   * Level 0 is the edge of the ground; negative levels lie inside it.
   */
  contour(x0: number, y0: number, size: number, levels: number[], step = 4): number[][][] {
    const n = Math.ceil(size / step), v = new Float32Array((n + 1) * (n + 1));
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) v[j * (n + 1) + i] = this.sd(x0 + i * step, y0 + j * step);
    return levels.map(lv => {
      const out: number[][] = [];
      const cross = (ax: number, ay: number, bx: number, by: number, va: number, vb: number): [number, number] => { const t = va / (va - vb); return [ax + (bx - ax) * t, ay + (by - ay) * t]; };
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const a = v[j * (n + 1) + i] - lv, b = v[j * (n + 1) + i + 1] - lv, c = v[(j + 1) * (n + 1) + i + 1] - lv, d = v[(j + 1) * (n + 1) + i] - lv;
        if ((a < 0) === (b < 0) && (b < 0) === (c < 0) && (c < 0) === (d < 0)) continue;
        const X = x0 + i * step, Y = y0 + j * step, pts: [number, number][] = [];
        if ((a < 0) !== (b < 0)) pts.push(cross(X, Y, X + step, Y, a, b));
        if ((b < 0) !== (c < 0)) pts.push(cross(X + step, Y, X + step, Y + step, b, c));
        if ((c < 0) !== (d < 0)) pts.push(cross(X + step, Y + step, X, Y + step, c, d));
        if ((d < 0) !== (a < 0)) pts.push(cross(X, Y + step, X, Y, d, a));
        if (pts.length >= 2) out.push([...pts[0], ...pts[1]]);
        if (pts.length === 4) out.push([...pts[2], ...pts[3]]);
      }
      return out;
    });
  }
}
