import { BeatGrid, nearestQuarter } from './beat';
import { Tunables } from './tunables';

export type Grade = 'perfect' | 'near' | 'miss';

/** Song time the player is hearing right now, given the audio clock time. */
export function heardTime(tAudio: number, tun: Tunables): number {
  return tAudio - tun.audioOffsetMs / 1000;
}

/** Song time the player meant, given the audio clock time of a key press. */
export function inputTime(tPress: number, tun: Tunables): number {
  return tPress - (tun.audioOffsetMs + tun.inputOffsetMs) / 1000;
}

export function judgeDodge(g: BeatGrid, tPress: number, tun: Tunables): { grade: Grade; offsetMs: number; beat: number } {
  const { beat, offsetMs } = nearestQuarter(g, inputTime(tPress, tun));
  const a = Math.abs(offsetMs);
  const grade: Grade = a <= tun.perfectMs ? 'perfect' : a <= tun.nearMs ? 'near' : 'miss';
  return { grade, offsetMs, beat };
}

/** Typical tap offset: the mean after dropping the earliest and the latest tap. 0 if too few taps. */
export function estimateInputOffset(offsetsMs: number[]): number {
  if (offsetsMs.length < 4) return 0;
  const mid = [...offsetsMs].sort((a, b) => a - b).slice(1, -1);
  return Math.round(mid.reduce((a, b) => a + b, 0) / mid.length);
}
