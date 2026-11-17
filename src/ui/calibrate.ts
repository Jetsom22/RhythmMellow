import { AudioEngine } from '../audio/engine';
import { nearestQuarter } from '../core/beat';
import { estimateInputOffset } from '../core/judge';
import { Keyboard } from '../input/keyboard';

const TAPS = 12;

/**
 * Plays only the base pulse and asks for taps on the beat.
 * Resolves with the player's typical tap offset in ms (positive = late), or null if cancelled.
 */
export function runCalibration(engine: AudioEngine, kb: Keyboard, audioOffsetMs: number): Promise<number | null> {
  return new Promise(resolve => {
    const box = document.createElement('div');
    box.id = 'calibrate';
    const dots = document.createElement('div');
    dots.className = 'dots';
    for (let i = 0; i < TAPS; i++) dots.append(document.createElement('i'));
    const hint = document.createElement('p');
    hint.textContent = '틱 소리에 맞춰 Space를 12번 누르세요 · Esc 취소';
    box.append(dots, hint);
    document.body.append(box);

    engine.setMix({ gain: { drum: 0, hat: 0, bass: 0, lead: 0, pad: 0, tick: 0.7 }, cutoffHz: 18000, brightness: 0 });
    const offsets: number[] = [];
    const wasEnabled = kb.enabled, prev = kb.onPress;
    kb.enabled = false;
    const finish = (value: number | null): void => {
      kb.enabled = wasEnabled;
      kb.onPress = prev;
      box.remove();
      resolve(value);
    };
    kb.onPress = (code, at) => {
      if (code === 'Escape') return finish(null);
      if (code !== 'Space') return;
      offsets.push(nearestQuarter(engine.grid, at - audioOffsetMs / 1000).offsetMs);
      dots.children[offsets.length - 1]?.classList.add('on');
      if (offsets.length >= TAPS) finish(estimateInputOffset(offsets));
    };
  });
}
