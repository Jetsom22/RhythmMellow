import { describe, it, expect } from 'vitest';
import { secPerBeat, secPerStep, timeToStep, stepToTime, nearestQuarter, rebase } from '../src/core/beat';

describe('beat grid', () => {
  const g = { bpm: 120, t0: 10 };
  it('converts bpm to durations', () => {
    expect(secPerBeat(120)).toBeCloseTo(0.5);
    expect(secPerStep(120)).toBeCloseTo(0.125);
  });
  it('maps time to steps and back', () => {
    expect(timeToStep(g, 10.5)).toBeCloseTo(4);
    expect(stepToTime(g, 16)).toBeCloseTo(12);
  });
  it('finds the nearest quarter beat with a signed offset', () => {
    const late = nearestQuarter(g, 10.53);
    expect(late.beat).toBe(1);
    expect(late.offsetMs).toBeCloseTo(30, 3);
    const early = nearestQuarter(g, 10.97);
    expect(early.beat).toBe(2);
    expect(early.offsetMs).toBeCloseTo(-30, 3);
  });
  it('keeps the beat position when the tempo changes mid-play', () => {
    const r = rebase(g, 90, 13.37);
    expect(timeToStep(r, 13.37)).toBeCloseTo(timeToStep(g, 13.37));
    expect(r.bpm).toBe(90);
  });
});
