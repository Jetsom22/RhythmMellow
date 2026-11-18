import { Song } from '../music/song';
import { Tunables } from '../tunables';
import { GameEvent, GameState, Instrument, World } from './types';
import { roomAt, tileAt } from './world';

const PICKUP: Record<string, Instrument> = { d: 'drum', h: 'hat', b: 'bass' };
const sounding = new WeakMap<Song, Set<number>>();

/** Is a bass note sounding during this loop step? */
export function bassSounding(song: Song, step: number): boolean {
  let set = sounding.get(song);
  if (!set) {
    set = new Set();
    for (const n of song.layers.bass) for (let i = 0; i < n.len; i++) set.add((n.step + i) % song.loopSteps);
    sounding.set(song, set);
  }
  return set.has(((Math.floor(step) % song.loopSteps) + song.loopSteps) % song.loopSteps);
}

/**
 * Does standing here, now, send the player back to the room entry?
 *  g  drum gate: shut on alternate quarter beats, neighbouring gates out of phase
 *  p  hat platform A: blinks out just before each beat, so it is solid on the beat
 *  q  hat platform B: the same, half a beat later, so it is solid on the off-beat
 *  w  bass lane: flooded while a bass note sounds
 */
export function gimmickDeadly(w: World, song: Song, stepF: number, x: number, y: number, tun: Tunables): boolean {
  const step = Math.floor(stepF);
  const phase = (((stepF / 4) % 1) + 1) % 1;
  const inGap = (offset: number): boolean => ((((phase - tun.hatGapStart - offset) % 1) + 1) % 1) < tun.hatGapLen;
  switch (tileAt(w, x, y)) {
    case 'g': return (((Math.floor(step / 4) + Math.floor(x / w.tile)) % 2) + 2) % 2 === 1;
    case 'p': return inGap(0);
    case 'q': return inGap(0.5);
    case 'w': return bassSounding(song, step);
    default: return false;
  }
}

function sendBack(s: GameState, ev: GameEvent[]): void {
  const p = s.player;
  const room = roomAt(s.world, p.x, p.y);
  const from = { x: p.x, y: p.y };
  p.x = p.respawn.x;
  p.y = p.respawn.y;
  p.dash = null;
  p.reform = { from, until: s.step + s.tun.reformSteps };
  ev.push({ type: 'respawn', room: room ?? '', from, to: { x: p.x, y: p.y } });
}

/** Room hazards, pickups and the boss door. Runs after every movement slice. */
export function stepGimmicks(s: GameState, stepF: number, ev: GameEvent[]): void {
  const p = s.player, w = s.world;
  if (p.reform) return;     // scattered: nothing on the floor can touch the player
  const room = roomAt(w, p.x, p.y);
  if (room && room !== 'boss') {
    const entry = w.rooms[room]!.entry;
    p.respawn = { x: entry.x, y: entry.y };
  }

  // A dash carries the player over anything on the floor.
  if (!p.dash && (tileAt(w, p.x, p.y) === '~' || gimmickDeadly(w, s.song, stepF, p.x, p.y, s.tun))) {
    sendBack(s, ev);
    return;
  }

  const inst = PICKUP[tileAt(w, p.x, p.y)];
  if (inst && !p.owned.includes(inst)) {
    p.owned.push(inst);
    if (p.equipped === null) p.equipped = inst;
    ev.push({ type: 'collect', inst });
    if (!s.doorOpen && p.owned.length === 3) {
      s.doorOpen = true;
      ev.push({ type: 'doorOpen' });
    }
  }
}
