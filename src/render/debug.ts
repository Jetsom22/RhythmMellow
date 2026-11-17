import { BeatGrid, timeToStep } from '../core/beat';
import { GameState } from '../core/game/types';

/** Developer overlay: where the beat is, how the dodges landed, what the conductor is doing. */
export function drawDebug(c: CanvasRenderingContext2D, s: GameState, grid: BeatGrid, heardT: number, fps: number, latencyMs: number, w: number, h: number): void {
  const tun = s.tun;
  const spb = 60000 / grid.bpm;                     // ms per beat
  const x0 = w / 2 - 200, y0 = h - 70, W = 400;
  const px = (ms: number): number => x0 + W / 2 + (ms / (spb / 2)) * (W / 2);

  c.save();
  c.font = '12px ui-monospace, monospace';
  c.textBaseline = 'top';
  c.fillStyle = 'rgba(0,0,0,0.55)';
  c.fillRect(x0 - 12, y0 - 34, W + 24, 96);

  // Judgement windows around the beat, and where "now" is inside the beat.
  c.fillStyle = 'rgba(255,255,255,0.10)';
  c.fillRect(px(-tun.nearMs), y0, px(tun.nearMs) - px(-tun.nearMs), 20);
  c.fillStyle = 'rgba(255,255,255,0.22)';
  c.fillRect(px(-tun.perfectMs), y0, px(tun.perfectMs) - px(-tun.perfectMs), 20);
  c.strokeStyle = '#888';
  c.strokeRect(x0 + 0.5, y0 + 0.5, W, 20);
  const beatF = timeToStep(grid, heardT) / 4;
  const phaseMs = (beatF - Math.round(beatF)) * spb;
  c.fillStyle = '#fff';
  c.fillRect(px(phaseMs) - 1, y0 - 4, 2, 28);

  // Recent dodges: newest brightest.
  s.dodgeLog.forEach((ms, i) => {
    const a = Math.abs(ms);
    c.fillStyle = a <= tun.perfectMs ? '#7CFC9A' : a <= tun.nearMs ? '#FFD23F' : '#FF5A4D';
    c.globalAlpha = 0.25 + 0.75 * ((i + 1) / s.dodgeLog.length);
    c.fillRect(Math.max(x0, Math.min(x0 + W, px(ms))) - 2, y0 + 24, 4, 8);
  });
  c.globalAlpha = 1;

  const n = s.dodgeLog.length;
  const mean = n ? s.dodgeLog.reduce((a, b) => a + b, 0) / n : 0;
  const sd = n ? Math.sqrt(s.dodgeLog.reduce((a, b) => a + (b - mean) ** 2, 0) / n) : 0;
  const b = s.boss;
  c.fillStyle = '#ddd';
  c.fillText(`dodge n=${n} mean=${mean.toFixed(0)}ms sd=${sd.toFixed(0)}ms   fps ${fps.toFixed(0)}   out ${latencyMs}ms   bpm ${grid.bpm}   step ${s.step}`, x0, y0 - 28);
  c.fillText(b ? `phrase ${b.conductor.current.id} x${b.conductor.repeat}  ${b.conductor.current.section}/${b.conductor.current.texture}  harmony ${b.harmony}  hp ${b.hp.toFixed(0)}` : 'no fight', x0, y0 + 38);
  c.restore();
}
