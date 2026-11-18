import { LayerId } from '../core/music/song';
import { Instrument } from '../core/game/types';

/**
 * A palette is swapped per genre or stage group. Its structure never changes:
 * the enemy family (telegraphs and attacks), the player family (attacks and dash),
 * the ordinary line colour, the colour of deadly ground, and the just colour
 * (a green the body turns while a dodge makes it invulnerable).
 */
export interface Palette {
  bg: string;
  ink: string;
  danger: string;
  just: string;
  enemy: Record<LayerId, string>;
  player: Record<Instrument, string>;
}

const make = (bg: string, ink: string, danger: string, just: string, e: [string, string, string], p: [string, string, string]): Palette => ({
  bg, ink, danger, just,
  enemy: { drum: e[0], hat: e[1], bass: e[2], lead: e[0], pad: e[0] },
  player: { drum: p[0], hat: p[1], bass: p[2] },
});

export const PALETTES: Record<string, Palette> = {
  rust: make('#f1e9d8', '#232524', '#c4291c', '#5f8f2f', ['#c4291c', '#e0662a', '#8a1f33'], ['#2f6470', '#6f9a8f', '#3d4a6b']),
  mid: make('#efe3c2', '#0d0d12', '#d63a24', '#5e9431', ['#d63a24', '#ea7a3c', '#9c2740'], ['#2c6a66', '#7fb3a6', '#35507a']),
  navy: make('#12303f', '#f3ede0', '#ff4b5c', '#b7e35a', ['#ff4b5c', '#ff8a4a', '#c93a7a'], ['#4fd1c5', '#b5f0e0', '#5aa9ff']),
  ochre: make('#ead7ad', '#1a1a1a', '#b3261e', '#56802a', ['#b3261e', '#d05a1e', '#6e1622'], ['#1f4d4d', '#5e8a7a', '#2b3552']),
};

export const paletteOf = (name: string | null | undefined): Palette => PALETTES[name ?? ''] ?? PALETTES.rust;
