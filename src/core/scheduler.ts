import { BeatGrid, stepToTime, timeToStep } from './beat';
import { LayerId, Note } from './music/song';

export interface ScheduledNote { note: Note; time: number; layer: LayerId | 'tick' }
export type Provider = (absStep: number) => { note: Note; layer: LayerId | 'tick' }[];

/**
 * Lookahead scheduler. Call tick() often; it hands every step whose time falls
 * inside the lookahead window to the sink exactly once. If it wakes up far
 * behind (a hidden tab), stale steps are dropped instead of played in a burst.
 */
export class Scheduler {
  private next: number | null = null;
  lastScheduled = -1;

  constructor(private opts: { lookahead: number; maxCatchUp: number } = { lookahead: 0.12, maxCatchUp: 0.25 }) {}

  tick(now: number, grid: BeatGrid, provide: Provider, sink: (n: ScheduledNote) => void): void {
    const current = Math.max(0, Math.ceil(timeToStep(grid, now) - 1e-9));
    if (this.next === null) this.next = current;
    if (stepToTime(grid, this.next) < now - this.opts.maxCatchUp) this.next = current;
    const horizon = now + this.opts.lookahead;
    while (stepToTime(grid, this.next) < horizon) {
      const abs = this.next++;
      const time = Math.max(stepToTime(grid, abs), now);
      for (const { note, layer } of provide(abs)) sink({ note: { ...note, step: abs }, time, layer });
      this.lastScheduled = abs;
    }
  }

  reset(): void { this.next = null; }
}
