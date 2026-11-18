/**
 * The meter of a stage: tempo, bar shape, which steps attacks may land on,
 * which steps a dodge is judged against, and the two judgement times.
 */
export interface MeterData {
  bpm?: number; stepsPerBeat?: number; beatsPerBar?: number;
  strikeSteps?: number[]; dodgeSteps?: number[];
  /** Dash judgement: a dash happens only if the key is pressed within this time of a dodge beat. */
  dashMs?: number;
  /** Just judgement: a dodge is "just" (invulnerable) if it starts within this time of the moment an attack lands. */
  justMs?: number;
}

export class Meter {
  bpm = 110;
  stepsPerBeat = 4;
  beatsPerBar = 4;
  strikeSteps = [0, 4, 8, 12];
  dodgeSteps = [0, 4, 8, 12];
  dashMs = 120;
  justMs = 60;

  static from(d: MeterData = {}): Meter {
    const m = new Meter();
    m.bpm = d.bpm ?? m.bpm;
    m.stepsPerBeat = d.stepsPerBeat ?? m.stepsPerBeat;
    m.beatsPerBar = d.beatsPerBar ?? m.beatsPerBar;
    m.strikeSteps = d.strikeSteps ?? m.strikeSteps;
    m.dodgeSteps = d.dodgeSteps ?? d.strikeSteps ?? m.dodgeSteps;
    m.dashMs = d.dashMs ?? m.dashMs;
    m.justMs = d.justMs ?? m.justMs;
    return m;
  }

  get stepsPerBar(): number { return this.stepsPerBeat * this.beatsPerBar; }
  get secPerStep(): number { return 60 / this.bpm / this.stepsPerBeat; }
  get secPerBeat(): number { return 60 / this.bpm; }

  isStrikeStep(step: number): boolean {
    const bar = this.stepsPerBar;
    return this.strikeSteps.includes(((step % bar) + bar) % bar);
  }

  /** Dash judgement: song time `t` against the dodge grid. offsetMs > 0 means late. */
  judge(t: number): { dash: boolean; offsetMs: number; step: number } {
    const sps = this.secPerStep, bar = this.stepsPerBar, here = Math.floor(t / sps / bar);
    let bestStep = 0, bestOff = Infinity;
    for (const b of [here - 1, here, here + 1]) for (const s of this.dodgeSteps) {
      const st = b * bar + s, off = (t - st * sps) * 1000;
      if (Math.abs(off) < Math.abs(bestOff)) { bestOff = off; bestStep = st; }
    }
    return { dash: Math.abs(bestOff) <= this.dashMs, offsetMs: bestOff, step: bestStep };
  }
}
