import { LayerId } from '../music/song';
import { Instrument } from './types';

export type Section = 'gi' | 'seung' | 'jeon' | 'gyeol';
/** How a phrase is put together, musically and as a fight. */
export type Texture = 'call' | 'tutti' | 'resolve';

/** Coordinates are relative to the arena centre, where the boss stands. */
export type Shape =
  | { kind: 'circle'; at: 'player' | 'boss' | { x: number; y: number }; r: number }
  | { kind: 'ring'; rIn: number; rOut: number }
  | { kind: 'line'; angle: number; width: number }
  | { kind: 'zone'; x: number; y: number; w: number; h: number; holdSteps: number };

/** hitStep is inside the phrase and always on a quarter beat; telegraph is in 16th steps. */
export interface AttackSpec { hitStep: number; telegraph: number; shape: Shape; layer: LayerId }

export interface BossPattern {
  id: string;
  section: Section;
  texture: Texture;
  bars: 2 | 4;
  attacks: AttackSpec[];
  /** Bars in which the boss is open (call phrases only). */
  openBars: number[];
  weakTo: Instrument | null;
  /** Layers this phrase features. */
  layers: LayerId[];
  /** Leave the phrase when health is at or below this fraction, or when the puzzle is solved. */
  advance: { hpBelow?: number; solved?: boolean };
}

export const PADS: { x: number; y: number; inst: Instrument }[] = [
  { x: -230, y: 110, inst: 'drum' },
  { x: 0, y: -170, inst: 'hat' },
  { x: 230, y: 110, inst: 'bass' },
];
export const PAD_RADIUS = 40;

const PI = Math.PI;
const atPlayer = (hitStep: number, telegraph: number, layer: LayerId, r = 70): AttackSpec =>
  ({ hitStep, telegraph, layer, shape: { kind: 'circle', at: 'player', r } });
const ring = (hitStep: number, rIn: number, rOut: number): AttackSpec =>
  ({ hitStep, telegraph: 4, layer: 'drum', shape: { kind: 'ring', rIn, rOut } });
const sweep = (bar: number): AttackSpec[] =>
  [ring(bar * 16 + 4, 40, 150), ring(bar * 16 + 8, 150, 260), ring(bar * 16 + 12, 260, 400)];
const beams = (hitStep: number, angles: number[]): AttackSpec[] =>
  angles.map(angle => ({ hitStep, telegraph: 4, layer: 'hat' as LayerId, shape: { kind: 'line' as const, angle, width: 70 } }));
const overPad = (hitStep: number, i: number): AttackSpec =>
  ({ hitStep, telegraph: 8, layer: 'bass', shape: { kind: 'zone', x: PADS[i].x - 75, y: PADS[i].y - 75, w: 150, h: 150, holdSteps: 8 } });

export const BOSS_PATTERNS: BossPattern[] = [
  {
    // The lead enters alone and asks; the player's instrument answers.
    id: 'gi-solo', section: 'gi', texture: 'call', bars: 4,
    attacks: [atPlayer(8, 8, 'lead'), atPlayer(16, 8, 'lead'), atPlayer(24, 8, 'lead')],
    openBars: [2, 3], weakTo: null, layers: ['lead'], advance: { hpBelow: 0.85 },
  },
  {
    // Drums join: shockwaves roll outward on the beat, then the boss opens.
    id: 'seung-drum', section: 'seung', texture: 'call', bars: 4,
    attacks: [...sweep(0), ...sweep(2)],
    openBars: [1, 3], weakTo: 'hat', layers: ['lead', 'drum'], advance: { hpBelow: 0.65 },
  },
  {
    // Hats join: off-beat warnings, beams on the beat. No pause to answer in.
    id: 'seung-hat', section: 'seung', texture: 'tutti', bars: 2,
    attacks: [
      ...beams(4, [0, PI]), ...beams(8, [PI / 2, (3 * PI) / 2]), ...beams(12, [0, PI]),
      ...beams(20, [PI / 4, (3 * PI) / 4, (5 * PI) / 4, (7 * PI) / 4]), ...beams(24, [0, PI / 2, PI, (3 * PI) / 2]),
      atPlayer(28, 8, 'lead'),
    ],
    openBars: [], weakTo: 'drum', layers: ['lead', 'drum', 'hat'], advance: { hpBelow: 0.45 },
  },
  {
    // The song turns: the boss is shielded until each instrument holds its pad for a bar.
    id: 'jeon-resolve', section: 'jeon', texture: 'resolve', bars: 4,
    attacks: [
      { hitStep: 8, telegraph: 8, layer: 'lead', shape: { kind: 'circle', at: 'boss', r: 120 } },
      overPad(16, 0), overPad(32, 1),
      { hitStep: 40, telegraph: 8, layer: 'lead', shape: { kind: 'circle', at: 'boss', r: 120 } },
      overPad(48, 2),
    ],
    openBars: [], weakTo: null, layers: ['lead', 'bass'], advance: { solved: true },
  },
  {
    // Everything at once.
    id: 'gyeol-tutti', section: 'gyeol', texture: 'tutti', bars: 4,
    attacks: [
      ...sweep(0),
      ...beams(20, [0, PI]), ...beams(24, [PI / 2, (3 * PI) / 2]), ...beams(28, [PI / 4, (3 * PI) / 4, (5 * PI) / 4, (7 * PI) / 4]),
      atPlayer(36, 4, 'lead'), atPlayer(40, 4, 'lead'), atPlayer(44, 4, 'lead'),
      { hitStep: 48, telegraph: 8, layer: 'bass', shape: { kind: 'zone', x: -384, y: -256, w: 384, h: 512, holdSteps: 4 } },
      { hitStep: 56, telegraph: 8, layer: 'bass', shape: { kind: 'zone', x: 0, y: -256, w: 384, h: 512, holdSteps: 4 } },
    ],
    openBars: [], weakTo: null, layers: ['lead', 'drum', 'hat', 'bass'], advance: { hpBelow: 0 },
  },
];
