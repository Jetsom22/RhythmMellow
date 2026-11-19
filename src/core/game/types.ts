import { Grade } from '../judge';
import { Song } from '../music/song';
import { Tunables } from '../tunables';

export type Instrument = 'drum' | 'hat' | 'bass';
export const INSTRUMENTS: Instrument[] = ['drum', 'hat', 'bass'];
export type RoomId = 'hub' | 'drum' | 'hat' | 'bass' | 'boss';

export interface Input {
  moveX: number;
  moveY: number;
  /** Audio clock time of the key press (uncorrected), or null. */
  dodgeAt: number | null;
  switchDir: -1 | 0 | 1;
  switchTo: Instrument | null;
  /** Audio clock time of the special-attack key press (stage build), or null. */
  specialAt?: number | null;
}

export interface Dash { t: number; dur: number; vx: number; vy: number; grade: Grade }

export interface Player {
  x: number; y: number;
  faceX: number; faceY: number;
  hp: number;
  owned: Instrument[];
  equipped: Instrument | null;
  dash: Dash | null;
  /** Seconds of invulnerability left. */
  iframe: number;
  cooldown: number;
  respawn: { x: number; y: number };
  /** Set while the player is scattered: no input, no hazards, no attacks until step `until`. */
  reform: { from: { x: number; y: number }; until: number } | null;
}

export interface Room { x: number; y: number; w: number; h: number; entry: { x: number; y: number } }

export interface World {
  cols: number; rows: number; tile: number;
  cells: string[];
  rooms: Partial<Record<RoomId, Room>>;
}

export type GameEvent =
  | { type: 'dodge'; grade: Grade; offsetMs: number; beat: number }
  | { type: 'collect'; inst: Instrument }
  | { type: 'respawn'; room: string; from: { x: number; y: number }; to: { x: number; y: number } }
  | { type: 'hurt'; hp: number }
  | { type: 'death'; from: { x: number; y: number }; to: { x: number; y: number } }
  | { type: 'attack'; inst: Instrument; x: number; y: number; tx: number; ty: number; hit: boolean }
  | { type: 'doorOpen' }
  | { type: 'bossStart' }
  | { type: 'phrase'; id: string; repeat: number; advanced: boolean }
  | { type: 'solved' }
  | { type: 'bossDefeated' };

type Pt = { x: number; y: number };

export interface BossState {
  x: number; y: number; r: number;
  hp: number;
  conductor: import('./conductor').Conductor;
  /** Absolute step at which the current phrase began. */
  phraseStart: number;
  /** Telegraphed attacks that have not landed yet. */
  active: { spec: import('./bossPatterns').AttackSpec; startStep: number; hitAbs: number; origin: Pt; evaded: boolean }[];
  /** Zones that linger after landing. */
  zones: { shape: import('./bossPatterns').Shape; untilStep: number; layer: import('../music/song').LayerId }[];
  /** Hits that landed and can still be answered by a slightly late dodge. */
  pending: { hitAbs: number; due: number }[];
  pads: { x: number; y: number; inst: Instrument; progress: number; locked: boolean }[];
  shield: boolean;
  solved: boolean;
  /** 0..harmonyMax: how full the chords are. Rises with absorbed hits, drops to 0 when hurt. */
  harmony: number;
  muffleUntil: number;
  defeated: boolean;
}

export interface GameState {
  tun: Tunables;
  song: Song;
  world: World;
  player: Player;
  started: boolean;
  /** Last whole 16th step that has been processed. */
  step: number;
  /** Song time (as heard) of the last update. */
  time: number;
  doorOpen: boolean;
  boss: BossState | null;
  leadOwner: 'boss' | 'player' | null;
  /** Offsets (ms) of the most recent dodges, for the debug view. */
  dodgeLog: number[];
  flags: { god: boolean };
  attack: import('./attack').AttackModule;
}
