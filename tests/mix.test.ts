import { describe, it, expect } from 'vitest';
import { computeMix, MixState } from '../src/core/music/mix';

const base: MixState = { owned: [], equipped: null, previewLayer: null, leadOn: false, harmony: 0, harmonyMax: 3, muffled: false, intensity: 0 };

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
