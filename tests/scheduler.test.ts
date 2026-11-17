import { describe, it, expect } from 'vitest';
import { Scheduler, ScheduledNote } from '../src/core/scheduler';
import { stepToTime } from '../src/core/beat';

const provide = (st: number) => [{ note: { step: st, len: 1, midi: 60, vel: 1, voice: 'tick' as const }, layer: 'tick' as const }];

describe('scheduler', () => {
  const g = { bpm: 110, t0: 0.1 };
  it('schedules every step exactly once, on the grid, over five minutes', () => {
    const sch = new Scheduler({ lookahead: 0.12, maxCatchUp: 0.25 });
    const seen = new Map<number, number>();
    let bad = 0;
    for (let i = 0; i < 12000; i++) {
      const now = i * 0.025;
      sch.tick(now, g, provide, n => {
        seen.set(n.note.step, (seen.get(n.note.step) ?? 0) + 1);
        if (Math.abs(n.time - stepToTime(g, n.note.step)) > 1e-9 || n.time < now - 1e-9) bad++;
      });
    }
    const last = Math.max(...seen.keys());
    expect(bad).toBe(0);
    expect(last).toBeGreaterThan(2190);
    for (let i = 0; i <= last; i++) expect(seen.get(i)).toBe(1);
  });
  it('does not dump a burst of stale notes after the tab was asleep', () => {
    const sch = new Scheduler({ lookahead: 0.12, maxCatchUp: 0.25 });
    const out: ScheduledNote[] = [];
    sch.tick(1.0, g, provide, n => out.push(n));
    out.length = 0;
    sch.tick(4.0, g, provide, n => out.push(n));
    expect(out.length).toBeGreaterThan(0);
    expect(out.every(n => n.time >= 4.0 - 1e-9)).toBe(true);
    expect(out.length).toBeLessThan(4);
  });
  it('starts over after reset', () => {
    const sch = new Scheduler({ lookahead: 0.12, maxCatchUp: 0.25 });
    const out: ScheduledNote[] = [];
    sch.tick(0, g, provide, n => out.push(n));
    sch.reset();
    sch.tick(0, g, provide, n => out.push(n));
    expect(out.filter(n => n.note.step === 0).length).toBe(2);
  });
});
