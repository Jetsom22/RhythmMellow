import { bassSounding } from './gimmicks';
import { GameEvent, GameState, Instrument } from './types';

export interface Target { x: number; y: number; r: number; takeDamage(amount: number, inst: Instrument): void }

/** The seam for swapping auto attack for something else later. */
export interface AttackModule { onStep(s: GameState, absStep: number, targets: Target[]): GameEvent[] }

/**
 * Temporary attack: the equipped instrument fires by itself, on its own rhythm,
 * at the nearest target. Where you stand decides whether it reaches.
 */
export const autoAttack: AttackModule = {
  onStep(s, absStep, targets) {
    const p = s.player, tun = s.tun, inst = p.equipped;
    if (!inst || targets.length === 0) return [];
    const sub = ((absStep % 4) + 4) % 4;
    const fires = inst === 'drum' ? sub === 0 : inst === 'hat' ? sub === 2 : bassSounding(s.song, absStep);
    if (!fires) return [];
    let best = targets[0], bestD = Infinity;
    for (const t of targets) {
      const d = Math.hypot(t.x - p.x, t.y - p.y) - t.r;
      if (d < bestD) { bestD = d; best = t; }
    }
    const range = inst === 'drum' ? tun.rangeDrum : inst === 'hat' ? tun.rangeHat : tun.rangeBass;
    const dmg = inst === 'drum' ? tun.dmgDrum : inst === 'hat' ? tun.dmgHat : tun.dmgBass;
    const hit = bestD <= range;
    if (hit) best.takeDamage(dmg, inst);
    // A whiff is still shown, reaching only as far as the instrument can.
    const dist = Math.hypot(best.x - p.x, best.y - p.y) || 1;
    const k = hit ? 1 : Math.min(1, range / dist);
    return [{ type: 'attack', inst, x: p.x, y: p.y, tx: p.x + (best.x - p.x) * k, ty: p.y + (best.y - p.y) * k, hit }];
  },
};
