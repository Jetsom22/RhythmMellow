import { describe, it, expect } from 'vitest';
import { judgeDodge, heardTime, inputTime } from '../src/core/judge';
import { defaultTunables } from '../src/core/tunables';

describe('dodge judgement', () => {
  const g = { bpm: 120, t0: 0 };
  const tun = defaultTunables();
  it('grades by distance from the nearest quarter beat', () => {
    expect(judgeDodge(g, 1.0, tun).grade).toBe('perfect');
    expect(judgeDodge(g, 1.059, tun).grade).toBe('perfect');
    expect(judgeDodge(g, 1.061, tun).grade).toBe('near');
    expect(judgeDodge(g, 0.881, tun).grade).toBe('near');
    expect(judgeDodge(g, 1.25, tun).grade).toBe('miss');
  });
  it('reports the beat and signed offset', () => {
    const j = judgeDodge(g, 1.03, tun);
    expect(j.beat).toBe(2);
    expect(j.offsetMs).toBeCloseTo(30, 3);
  });
  it('compensates for input latency', () => {
    const j = judgeDodge(g, 1.08, { ...tun, inputOffsetMs: 80 });
    expect(j.grade).toBe('perfect');
    expect(j.offsetMs).toBeCloseTo(0, 3);
  });
  it('shifts heard and input time by the configured offsets', () => {
    const t = { ...tun, audioOffsetMs: 20, inputOffsetMs: 30 };
    expect(heardTime(5, t)).toBeCloseTo(4.98);
    expect(inputTime(5, t)).toBeCloseTo(4.95);
  });
});
