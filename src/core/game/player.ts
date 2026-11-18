import { BeatGrid } from '../beat';
import { judgeDodge } from '../judge';
import { GameEvent, GameState, Input, Instrument, Player } from './types';

export type SolidFn = (x: number, y: number) => boolean;

export function createPlayer(x: number, y: number, hp: number): Player {
  return { x, y, faceX: 1, faceY: 0, hp, owned: [], equipped: null, dash: null, iframe: 0, cooldown: 0, respawn: { x, y }, reform: null };
}

function blocked(solid: SolidFn, x: number, y: number, r: number): boolean {
  return solid(x - r, y - r) || solid(x + r, y - r) || solid(x - r, y + r) || solid(x + r, y + r);
}

/** Move in small sub-steps so fast dashes never tunnel through a wall. */
function moveBy(p: Player, dx: number, dy: number, r: number, solid: SolidFn): void {
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 2));
  const sx = dx / n, sy = dy / n;
  for (let i = 0; i < n; i++) {
    if (!blocked(solid, p.x + sx, p.y, r)) p.x += sx;
    if (!blocked(solid, p.x, p.y + sy, r)) p.y += sy;
  }
}

export function movePlayer(s: GameState, input: Input, dt: number, solid: SolidFn): void {
  const p = s.player, tun = s.tun;
  p.iframe = Math.max(0, p.iframe - dt);
  p.cooldown = Math.max(0, p.cooldown - dt);
  const len = Math.hypot(input.moveX, input.moveY);
  if (len > 0) { p.faceX = input.moveX / len; p.faceY = input.moveY / len; }
  if (p.dash) {
    const d = Math.min(dt, p.dash.dur - p.dash.t);
    moveBy(p, p.dash.vx * d, p.dash.vy * d, tun.playerRadius, solid);
    p.dash.t += dt;
    if (p.dash.t >= p.dash.dur - 1e-9) p.dash = null;
  } else if (len > 0) {
    moveBy(p, p.faceX * tun.playerSpeed * dt, p.faceY * tun.playerSpeed * dt, tun.playerRadius, solid);
  }
}

/** A dodge always happens; its grade decides how far and how safe. */
export function tryDodge(s: GameState, input: Input, grid: BeatGrid): GameEvent | null {
  const p = s.player, tun = s.tun;
  if (input.dodgeAt === null || p.cooldown > 0 || p.dash || p.reform) return null;
  const j = judgeDodge(grid, input.dodgeAt, tun);
  const len = Math.hypot(input.moveX, input.moveY);
  const dx = len > 0 ? input.moveX / len : p.faceX;
  const dy = len > 0 ? input.moveY / len : p.faceY;
  const dist = j.grade === 'perfect' ? tun.dashPerfect : j.grade === 'near' ? tun.dashNear : tun.dashMiss;
  p.dash = { t: 0, dur: tun.dashTime, vx: (dx * dist) / tun.dashTime, vy: (dy * dist) / tun.dashTime, grade: j.grade };
  p.iframe = Math.max(p.iframe, j.grade === 'perfect' ? tun.iframePerfect : j.grade === 'near' ? tun.iframeNear : tun.iframeMiss);
  p.cooldown = tun.dodgeCooldown;
  s.dodgeLog.push(j.offsetMs);
  if (s.dodgeLog.length > 64) s.dodgeLog.shift();
  return { type: 'dodge', grade: j.grade, offsetMs: j.offsetMs, beat: j.beat };
}

export function switchInstrument(p: Player, dir: -1 | 1): void {
  if (p.owned.length === 0 || p.equipped === null) return;
  const i = p.owned.indexOf(p.equipped);
  p.equipped = p.owned[(i + dir + p.owned.length) % p.owned.length];
}

export function equip(p: Player, inst: Instrument): void {
  if (p.owned.includes(inst)) p.equipped = inst;
}
