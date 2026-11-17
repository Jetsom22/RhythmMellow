import { BeatGrid, stepToTime } from '../beat';
import { Grade } from '../judge';
import { Tunables } from '../tunables';
import { Target } from './attack';
import { BOSS_PATTERNS, BossPattern, PAD_RADIUS, PADS, Shape } from './bossPatterns';
import { Conductor } from './conductor';
import { BossState, GameEvent, GameState, Instrument } from './types';
import { roomAt } from './world';

type Pt = { x: number; y: number };
export const BOSS_RADIUS = 36;

/** Is (px,py) inside the shape? `origin` is the resolved anchor, `boss` the arena centre. */
export function hitTest(shape: Shape, origin: Pt, boss: Pt, px: number, py: number): boolean {
  switch (shape.kind) {
    case 'circle': return Math.hypot(px - origin.x, py - origin.y) <= shape.r;
    case 'ring': { const d = Math.hypot(px - boss.x, py - boss.y); return d >= shape.rIn && d <= shape.rOut; }
    case 'line': {
      const dx = px - boss.x, dy = py - boss.y, cx = Math.cos(shape.angle), cy = Math.sin(shape.angle);
      return dx * cx + dy * cy >= 0 && Math.abs(dx * -cy + dy * cx) <= shape.width / 2;
    }
    case 'zone': return px >= boss.x + shape.x && px <= boss.x + shape.x + shape.w && py >= boss.y + shape.y && py <= boss.y + shape.y + shape.h;
  }
}

export function damageMult(p: BossPattern, bar: number, inst: Instrument, tun: Tunables, shield: boolean): number {
  if (shield) return 0;
  let m = p.weakTo === null ? 1 : p.weakTo === inst ? tun.weakMult : tun.otherMult;
  if (p.texture === 'call') m *= p.openBars.includes(bar) ? tun.callOpenMult : tun.callClosedMult;
  return m;
}

function begin(s: GameState, absStep: number, ev: GameEvent[]): BossState {
  const room = s.world.rooms.boss!;
  const x = room.x + room.w / 2, y = room.y + room.h / 2;
  const b: BossState = {
    x, y, r: BOSS_RADIUS, hp: s.tun.bossHp,
    conductor: new Conductor(BOSS_PATTERNS),
    phraseStart: absStep, active: [], zones: [], pending: [],
    pads: PADS.map(p => ({ x: x + p.x, y: y + p.y, inst: p.inst, progress: 0, locked: false })),
    shield: false, solved: false, harmony: 0, muffleUntil: 0, defeated: false,
  };
  s.boss = b;
  s.leadOwner = 'boss';
  ev.push({ type: 'bossStart' });
  return b;
}

/** Start the fight now (normally it starts on the next bar line after the player walks in). */
export function enterBoss(s: GameState): GameEvent[] {
  const ev: GameEvent[] = [];
  begin(s, s.step, ev);
  return ev;
}

function hurt(s: GameState, ev: GameEvent[]): void {
  const p = s.player, b = s.boss;
  if (s.flags.god || !b) return;
  p.hp -= 1;
  p.iframe = s.tun.hitInvuln;
  b.harmony = 0;
  b.muffleUntil = s.step + s.tun.muffleBars * 16;
  b.pending = [];
  ev.push({ type: 'hurt', hp: p.hp });
  if (p.hp > 0) return;
  // Back to the door; the fight starts over.
  const entry = s.world.rooms.boss!.entry;
  p.hp = s.tun.playerHp;
  p.x = entry.x;
  p.y = entry.y;
  p.dash = null;
  s.boss = null;
  s.leadOwner = null;
  ev.push({ type: 'death' });
}

/** A hit lands on the beat, but the player still has the late half of the judgement window to answer it. */
function land(s: GameState, shape: Shape, origin: Pt, hitAbs: number, grid: BeatGrid): void {
  const b = s.boss!, p = s.player;
  if (s.flags.god || !hitTest(shape, origin, b, p.x, p.y) || p.iframe > 0) return;
  b.pending.push({ hitAbs, due: stepToTime(grid, hitAbs) + (s.tun.nearMs + Math.max(0, s.tun.inputOffsetMs)) / 1000 + 0.02 });
}

function defeat(s: GameState, ev: GameEvent[]): void {
  const b = s.boss!;
  b.defeated = true;
  b.active = [];
  b.zones = [];
  b.pending = [];
  b.shield = false;
  b.harmony = s.tun.harmonyMax;
  s.leadOwner = 'player';
  ev.push({ type: 'bossDefeated' });
}

/** Runs once per 16th step. */
export function stepBoss(s: GameState, absStep: number, grid: BeatGrid, ev: GameEvent[]): void {
  const p = s.player;
  let b = s.boss;
  if (!b) {
    if (absStep % 16 !== 0 || roomAt(s.world, p.x, p.y) !== 'boss') return;
    b = begin(s, absStep, ev);
  }
  if (b.defeated) return;
  if (b.conductor.isLast && b.hp <= 0) return defeat(s, ev);

  // Phrase boundary: repeat or move on. The beat never stops.
  if (absStep - b.phraseStart >= b.conductor.current.bars * 16) {
    const r = b.conductor.phraseEnd({ hpFrac: b.hp / s.tun.bossHp, solved: b.solved });
    if (r.done) return defeat(s, ev);
    b.phraseStart = absStep;
    b.active = [];
    ev.push({ type: 'phrase', id: b.conductor.current.id, repeat: b.conductor.repeat, advanced: r.advanced });
  }
  const pat = b.conductor.current;
  const local = absStep - b.phraseStart;
  b.shield = pat.texture === 'resolve' && !b.solved;

  // Telegraphs begin.
  for (const spec of pat.attacks) {
    if (local !== spec.hitStep - spec.telegraph) continue;
    const sh = spec.shape;
    const origin = sh.kind === 'circle' ? (sh.at === 'player' ? { x: p.x, y: p.y } : sh.at === 'boss' ? { x: b.x, y: b.y } : { x: b.x + sh.at.x, y: b.y + sh.at.y }) : { x: b.x, y: b.y };
    b.active.push({ spec, startStep: absStep, hitAbs: b.phraseStart + spec.hitStep, origin, evaded: false });
  }

  // Hits land.
  for (const a of b.active) {
    if (a.hitAbs !== absStep) continue;
    if (!a.evaded) land(s, a.spec.shape, a.origin, absStep, grid);
    if (a.spec.shape.kind === 'zone') b.zones.push({ shape: a.spec.shape, untilStep: absStep + a.spec.shape.holdSteps, layer: a.spec.layer });
  }
  b.active = b.active.filter(a => a.hitAbs > absStep);
  // Lingering zones strike again on each quarter beat: walk out of them.
  for (const z of b.zones) if (absStep % 4 === 0 && absStep <= z.untilStep) land(s, z.shape, b, absStep, grid);
  b.zones = b.zones.filter(z => z.untilStep > absStep);

  // Resonance pads: hold each with its own instrument for a whole bar.
  if (pat.texture === 'resolve' && !b.solved) {
    for (const pad of b.pads) {
      if (pad.locked) continue;
      const on = Math.hypot(p.x - pad.x, p.y - pad.y) <= PAD_RADIUS && p.equipped === pad.inst;
      pad.progress = on ? pad.progress + 1 : 0;
      if (pad.progress >= 16) pad.locked = true;
    }
    if (b.pads.every(pad => pad.locked)) {
      b.solved = true;
      b.shield = false;
      ev.push({ type: 'solved' });
    }
  }
}

/** A good dodge on the beat of an attack absorbs it and feeds the harmony. */
export function bossOnDodge(s: GameState, beat: number, grade: Grade): void {
  const b = s.boss, p = s.player;
  if (!b || b.defeated || grade === 'miss') return;
  const hitAbs = beat * 4;
  let absorbed = false;
  for (const a of b.active) {
    if (a.hitAbs === hitAbs && !a.evaded && hitTest(a.spec.shape, a.origin, b, p.x, p.y)) { a.evaded = true; absorbed = true; }
  }
  if (b.pending.some(h => h.hitAbs === hitAbs)) {
    b.pending = b.pending.filter(h => h.hitAbs !== hitAbs);
    absorbed = true;
  }
  if (absorbed) b.harmony = Math.min(s.tun.harmonyMax, b.harmony + 1);
}

/** Runs every movement slice: unanswered hits come due. */
export function updateBoss(s: GameState, t: number, ev: GameEvent[]): void {
  const b = s.boss;
  if (b && b.pending.some(h => h.due <= t)) hurt(s, ev);
}

/** The boss as something the player's attack can aim at. */
export function bossTarget(s: GameState): Target | null {
  const b = s.boss;
  if (!b || b.defeated) return null;
  return {
    x: b.x, y: b.y, r: b.r,
    takeDamage: (amount, inst) => {
      const pat = b.conductor.current;
      const bar = Math.floor((s.step - b.phraseStart) / 16);
      const gate = pat.advance.hpBelow;
      // Health cannot drop past the gate of the current phrase; the puzzle phrase takes none.
      const floor = gate === undefined ? b.hp : gate * s.tun.bossHp;
      b.hp = Math.max(floor, b.hp - amount * damageMult(pat, bar, inst, s.tun, b.shield));
    },
  };
}
