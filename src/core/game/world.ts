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

const TILE = 32;
const COLS = 64, ROWS = 50;

/**
 * The one map of the validation build: a quiet hub, three rhythm rooms
 * (left: drum, top: hat, right: bass) and the boss room below.
 * Built in code so the room rectangles and the tiles cannot drift apart.
 */
export function buildWorld(): World {
  const g: string[][] = Array.from({ length: ROWS }, () => Array<string>(COLS).fill('#'));
  const fill = (c0: number, r0: number, c1: number, r1: number, ch: string): void => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) g[r][c] = ch;
  };
  const rect = (c0: number, r0: number, c1: number, r1: number, ec: number, er: number): Room => ({
    x: c0 * TILE, y: r0 * TILE, w: (c1 - c0 + 1) * TILE, h: (r1 - r0 + 1) * TILE,
    entry: { x: (ec + 0.5) * TILE, y: (er + 0.5) * TILE },
  });

  // Hub.
  fill(24, 16, 39, 27, '.');
  g[22][31] = 'P';
  g[26][36] = 'T';

  // Drum room (left): gates that slam on alternate beats, then a dodge gap.
  fill(23, 21, 23, 22, '.');
  fill(3, 19, 22, 24, '.');
  for (const c of [18, 15, 12, 9]) fill(c, 19, c, 24, 'g');
  fill(5, 19, 6, 24, '~');
  g[21][3] = 'd';

  // Hat room (top): platforms that trade places every 8th note, then a dodge gap.
  fill(31, 15, 32, 15, '.');
  fill(28, 1, 35, 14, '.');
  fill(28, 6, 35, 11, '~');
  fill(31, 10, 32, 11, 'p');
  fill(31, 8, 32, 9, 'q');
  fill(31, 6, 32, 7, 'p');
  fill(28, 3, 35, 4, '~');
  g[1][31] = 'h';

  // Bass room (right): a lane that floods while the bass sounds, with safe columns.
  fill(40, 21, 40, 22, '.');
  fill(41, 19, 60, 24, '.');
  fill(44, 19, 55, 24, 'w');
  for (const c of [47, 50, 53]) fill(c, 19, c, 24, 's');
  fill(57, 19, 58, 24, '~');
  g[21][60] = 'b';

  // Boss door, corridor and arena (below).
  fill(31, 28, 32, 28, 'D');
  fill(31, 29, 32, 30, '.');
  fill(20, 31, 43, 46, '.');

  return parseWorld(g.map(r => r.join('')), TILE, {
    hub: rect(24, 16, 39, 27, 31, 22),
    drum: rect(3, 19, 22, 24, 22, 21),
    hat: rect(28, 1, 35, 14, 31, 13),
    bass: rect(41, 19, 60, 24, 41, 21),
    boss: rect(20, 31, 43, 46, 31, 27),
  });
}
