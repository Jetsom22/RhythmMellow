/** Beat grid: 4/4, 16th-note steps. t0 is the audio time of step 0. */
export interface BeatGrid { bpm: number; t0: number }

export const STEPS_PER_BEAT = 4;
export const STEPS_PER_BAR = 16;

export function secPerBeat(bpm: number): number { return 60 / bpm; }
export function secPerStep(bpm: number): number { return 60 / bpm / STEPS_PER_BEAT; }

/** Fractional step index at time t. */
export function timeToStep(g: BeatGrid, t: number): number {
  return (t - g.t0) / secPerStep(g.bpm);
}

export function stepToTime(g: BeatGrid, step: number): number {
  return g.t0 + step * secPerStep(g.bpm);
}

/** Nearest quarter beat; offsetMs > 0 means t is late. */
export function nearestQuarter(g: BeatGrid, t: number): { beat: number; offsetMs: number } {
  const spb = secPerBeat(g.bpm);
  const beat = Math.round((t - g.t0) / spb);
  return { beat, offsetMs: (t - (g.t0 + beat * spb)) * 1000 };
}

/** New grid at another tempo whose fractional step at tNow is unchanged. */
export function rebase(g: BeatGrid, newBpm: number, tNow: number): BeatGrid {
  const step = timeToStep(g, tNow);
  return { bpm: newBpm, t0: tNow - step * secPerStep(newBpm) };
}
