import { Room, RoomId, World } from './types';

/**
 * Tile legend: # wall, . floor, ~ chasm, D boss door, d/h/b instruments,
 * g drum gate, p/q hat platforms A/B, w bass wave lane, s bass safe cell,
 * T practice target, P player start.
 */
export function parseWorld(cells: string[], tile: number, rooms: Partial<Record<RoomId, Room>> = {}): World {
  const cols = cells[0].length;
  if (cells.some(r => r.length !== cols)) throw new Error('map rows differ in length');
  return { cols, rows: cells.length, tile, cells, rooms };
}

export function tileAt(w: World, x: number, y: number): string {
  const c = Math.floor(x / w.tile), r = Math.floor(y / w.tile);
  if (c < 0 || r < 0 || c >= w.cols || r >= w.rows) return '#';
  return w.cells[r][c];
}

export function isSolid(w: World, x: number, y: number, doorOpen = false): boolean {
  const t = tileAt(w, x, y);
  return t === '#' || (t === 'D' && !doorOpen);
}

export function roomAt(w: World, x: number, y: number): RoomId | null {
  for (const id of Object.keys(w.rooms) as RoomId[]) {
    const r = w.rooms[id]!;
    if (x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h) return id;
  }
  return null;
}

/** Centre of the first tile holding `ch`, or null. */
export function findTile(w: World, ch: string): { x: number; y: number } | null {
  for (let r = 0; r < w.rows; r++) {
    const c = w.cells[r].indexOf(ch);
    if (c >= 0) return { x: (c + 0.5) * w.tile, y: (r + 0.5) * w.tile };
  }
  return null;
}

/** Placeholder until the real map lands. */
export function buildWorld(): World {
  return parseWorld(['#####', '#.P.#', '#####'], 32);
}
