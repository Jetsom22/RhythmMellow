import { Input, Instrument } from '../core/game/types';

const DIGITS: Record<string, Instrument> = { Digit1: 'drum', Digit2: 'hat', Digit3: 'bass' };
const SWALLOW = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

/** Held keys become movement; presses become one-shot inputs stamped with the audio clock. */
export class Keyboard {
  private held = new Set<string>();
  private dodgeAt: number | null = null;
  private switchDir: -1 | 0 | 1 = 0;
  private switchTo: Instrument | null = null;
  private special = false;
  /** Other listeners (panel, calibration) can hook raw presses here. */
  onPress: ((code: string, at: number) => void) | null = null;
  enabled = true;

  constructor(target: Window, private clock: () => number) {
    target.addEventListener('keydown', e => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (SWALLOW.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      const at = this.clock();
      this.onPress?.(e.code, at);
      if (!this.enabled) return;
      this.held.add(e.code);
      if (e.code === 'Space') this.dodgeAt = at;
      else if (e.code === 'KeyQ') this.switchDir = -1;
      else if (e.code === 'KeyE') this.switchDir = 1;
      else if (DIGITS[e.code]) this.switchTo = DIGITS[e.code];
      else if (e.code === 'KeyF' || e.code === 'KeyJ') this.special = true;
    });
    target.addEventListener('keyup', e => this.held.delete(e.code));
    target.addEventListener('blur', () => this.held.clear());
  }

  private axis(neg: string[], pos: string[]): number {
    return (pos.some(k => this.held.has(k)) ? 1 : 0) - (neg.some(k => this.held.has(k)) ? 1 : 0);
  }

  poll(): Input {
    const input: Input = {
      moveX: this.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']),
      moveY: this.axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']),
      dodgeAt: this.dodgeAt, switchDir: this.switchDir, switchTo: this.switchTo, special: this.special,
    };
    this.dodgeAt = null;
    this.switchDir = 0;
    this.switchTo = null;
    this.special = false;
    return input;
  }
}
