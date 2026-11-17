import { GameState } from '../game/types';
import { roomAt } from '../game/world';
import { LayerId } from './song';

/** What the game tells the music about itself. */
export interface MixState {
  owned: LayerId[];
  equipped: LayerId | null;
  /** Layer of the room the player stands in, heard faintly before it is owned. */
  previewLayer: LayerId | null;
  leadOn: boolean;
  harmony: number;
  harmonyMax: number;
  muffled: boolean;
  /** 0..1, grows as the boss fight deepens. */
  intensity: number;
  /** Layers the current boss phrase features; others step back. null outside a fight. */
  focus: LayerId[] | null;
}

export interface Mix { gain: Record<LayerId | 'tick', number>; cutoffHz: number; brightness: number }

export function computeMix(m: MixState): Mix {
  const body = (l: LayerId): number =>
    m.equipped === l ? 1.0 : m.owned.includes(l) ? (m.focus && !m.focus.includes(l) ? 0.25 : 0.8) : m.previewLayer === l ? 0.5 : 0;
  return {
    gain: {
      drum: body('drum'), hat: body('hat'), bass: body('bass'),
      lead: m.leadOn ? 0.9 : 0,
      pad: m.harmonyMax > 0 ? (m.harmony / m.harmonyMax) * 0.7 : 0,
      tick: m.owned.includes('drum') ? 0 : 0.35,
    },
    cutoffHz: m.muffled ? 700 : 18000,
    brightness: m.intensity,
  };
}

export function mixStateOf(s: GameState): MixState {
  const p = s.player;
  const room = roomAt(s.world, p.x, p.y);
  const roomLayer = room === 'drum' || room === 'hat' || room === 'bass' ? room : null;
  const b = s.boss;
  return {
    owned: p.owned.slice(),
    equipped: p.equipped,
    previewLayer: roomLayer && !p.owned.includes(roomLayer) ? roomLayer : null,
    leadOn: s.leadOwner !== null,
    harmony: b ? b.harmony : 0,
    harmonyMax: s.tun.harmonyMax,
    muffled: !!b && !b.defeated && s.step < b.muffleUntil,
    intensity: b ? (b.defeated ? 1 : b.conductor.index / 4) : 0,
    focus: b && !b.defeated ? b.conductor.current.layers : null,
  };
}
