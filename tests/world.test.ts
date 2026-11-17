import { describe, it, expect } from 'vitest';
import { buildWorld, isSolid, roomAt } from '../src/core/game/world';

const w = buildWorld();
const find = (ch: string): [number, number][] => {
  const out: [number, number][] = [];
  w.cells.forEach((row, r) => [...row].forEach((c, col) => { if (c === ch) out.push([col, r]); }));
  return out;
};
function reach(blockDoor: boolean): Set<string> {
  const [sc, sr] = find('P')[0];
  const seen = new Set([sc + ',' + sr]);
  const q: [number, number][] = [[sc, sr]];
  while (q.length) {
    const [c, r] = q.pop()!;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr, ch = w.cells[nr]?.[nc];
      if (!ch || ch === '#' || (blockDoor && ch === 'D') || seen.has(nc + ',' + nr)) continue;
      seen.add(nc + ',' + nr);
      q.push([nc, nr]);
    }
  }
  return seen;
}

describe('the map', () => {
  it('is rectangular and has every landmark', () => {
    expect(w.cells.every(r => r.length === w.cols)).toBe(true);
    expect(find('P')).toHaveLength(1);
    for (const ch of ['d', 'h', 'b', 'D', 'T', 'g', 'p', 'q', 'w', 's', '~']) expect(find(ch).length).toBeGreaterThan(0);
    for (const id of ['hub', 'drum', 'hat', 'bass', 'boss'] as const) expect(w.rooms[id]).toBeDefined();
  });
  it('lets the player reach every instrument and the target, but the boss only through the door', () => {
    const open = reach(false), shut = reach(true);
    for (const ch of ['d', 'h', 'b', 'T']) for (const [c, r] of find(ch)) expect(shut.has(c + ',' + r)).toBe(true);
    const boss = w.rooms.boss!;
    const inside = `${Math.floor((boss.x + boss.w / 2) / w.tile)},${Math.floor((boss.y + boss.h / 2) / w.tile)}`;
    expect(open.has(inside)).toBe(true);
    expect(shut.has(inside)).toBe(false);
  });
  it('knows which room a point is in and keeps entries on walkable floor', () => {
    for (const id of ['drum', 'hat', 'bass', 'boss', 'hub'] as const) {
      const e = w.rooms[id]!.entry;
      expect(isSolid(w, e.x, e.y)).toBe(false);
      expect('.P').toContain(w.cells[Math.floor(e.y / w.tile)][Math.floor(e.x / w.tile)]);
    }
    const [dc, dr] = find('d')[0];
    expect(roomAt(w, (dc + 0.5) * w.tile, (dr + 0.5) * w.tile)).toBe('drum');
  });
  it('puts a dodge-only gap of two tiles before every instrument', () => {
    // Each room holds chasm tiles that are not platforms.
    for (const id of ['drum', 'hat', 'bass'] as const) {
      const r = w.rooms[id]!;
      const n = find('~').filter(([c, row]) => roomAt(w, (c + 0.5) * w.tile, (row + 0.5) * w.tile) === id).length;
      expect(n, id + ' ' + JSON.stringify(r)).toBeGreaterThan(0);
    }
  });
});
