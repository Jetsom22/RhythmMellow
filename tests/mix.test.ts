import { describe, it, expect } from 'vitest';
import { computeMix, MixState } from '../src/core/music/mix';

const base: MixState = { owned: [], equipped: null, previewLayer: null, leadOn: false, harmony: 0, harmonyMax: 3, muffled: false, intensity: 0, focus: null };

describe('mix', () => {
  it('plays only the base pulse when nothing is owned', () => {
    expect(computeMix(base).gain).toMatchObject({ drum: 0, hat: 0, bass: 0, lead: 0, pad: 0, tick: 0.35 });
  });
  it('brings the equipped layer forward and previews the room layer', () => {
    const m = computeMix({ ...base, owned: ['drum', 'hat'], equipped: 'hat', previewLayer: 'bass' });
    expect(m.gain).toMatchObject({ drum: 0.8, hat: 1.0, bass: 0.5, tick: 0 });
  });
  it('scales the pad with harmony and plays lead only when on', () => {
    expect(computeMix({ ...base, harmony: 3 }).gain.pad).toBeCloseTo(0.7);
    expect(computeMix({ ...base, leadOn: true }).gain.lead).toBeCloseTo(0.9);
  });
  it('muffles the master when hurt', () => {
    expect(computeMix({ ...base, muffled: true }).cutoffHz).toBe(700);
    expect(computeMix(base).cutoffHz).toBe(18000);
    expect(computeMix({ ...base, intensity: 0.5 }).brightness).toBe(0.5);
  });
});

import { mixStateOf } from '../src/core/music/mix';
import { createGame } from '../src/core/game/sim';
import { parseWorld } from '../src/core/game/world';
import { defaultTunables } from '../src/core/tunables';

describe('mix state from the game', () => {
  const world = () => parseWorld(['######', '#P...#', '######'], 32, { drum: { x: 96, y: 32, w: 64, h: 32, entry: { x: 112, y: 48 } } });
  it('previews the layer of the room the player is in until it is owned', () => {
    const s = createGame(7, defaultTunables(), world());
    expect(mixStateOf(s).previewLayer).toBeNull();
    s.player.x = 120;
    expect(mixStateOf(s).previewLayer).toBe('drum');
    s.player.owned = ['drum']; s.player.equipped = 'drum';
    const m = mixStateOf(s);
    expect(m.previewLayer).toBeNull();
    expect(m.owned).toEqual(['drum']);
    expect(m.equipped).toBe('drum');
    expect(m.leadOn).toBe(false);
  });
});

describe('phrase focus', () => {
  it('pulls owned layers back when the phrase does not feature them, except the equipped one', () => {
    const m = computeMix({ ...base, owned: ['drum', 'hat', 'bass'], equipped: 'hat', focus: ['lead', 'drum'] });
    expect(m.gain).toMatchObject({ drum: 0.8, hat: 1.0, bass: 0.25 });
  });
});
