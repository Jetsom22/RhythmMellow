import { BossPattern } from './bossPatterns';

/**
 * Chooses the next phrase at each phrase end. A phrase whose condition is not
 * met plays again, like a band vamping until the soloist is ready.
 */
export class Conductor {
  private i = 0;
  private n = 0;

  constructor(private patterns: BossPattern[]) {}

  get current(): BossPattern { return this.patterns[this.i]; }
  get repeat(): number { return this.n; }
  get index(): number { return this.i; }
  get isLast(): boolean { return this.i === this.patterns.length - 1; }

  phraseEnd(ctx: { hpFrac: number; solved: boolean }): { advanced: boolean; done: boolean } {
    const a = this.current.advance;
    const met = a.solved ? ctx.solved : ctx.hpFrac <= (a.hpBelow ?? 0) + 1e-9;
    if (met && this.isLast) return { advanced: false, done: true };
    if (met) {
      this.i++;
      this.n = 0;
      return { advanced: true, done: false };
    }
    this.n++;
    return { advanced: false, done: false };
  }
}
