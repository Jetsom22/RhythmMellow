import { LayerId } from '../music/song';
import { Meter, MeterData } from './meter';
import { contains, scaled, Shape } from './shapes';

/**
 * The rules of a stage, with no drawing and no sound: it only needs to be told what time it is.
 *
 * One attack engine serves everything that attacks: devices on the path, monsters, guardians
 * and the boss all schedule the same attack definitions, so what is learned on the way is
 * literally what the boss uses.
 *
 * Lengths are pixels here. Stage data is written in U (the distance walked in one beat)
 * and scaled on load.
 */

export type Instrument = 'drum' | 'hat' | 'bass';
export type V = { x: number; y: number };

export type AttackShape =
  | { kind: 'circle'; r: number }
  | { kind: 'ring'; r0: number; r1: number }
  | { kind: 'beam'; w: number; len?: number }
  | { kind: 'zone'; w: number; h: number };
export interface AttackDef { shape: AttackShape; tele: number; hold?: number; anchor?: 'self' | 'target' | 'fixed'; layer?: LayerId }
export interface PatternEvent { at: number; attack: string; anchor?: 'self' | 'target' | 'fixed'; x?: number; y?: number; rot?: number }
export interface Pattern { length: number; rest?: number; phase?: number; events: PatternEvent[] }
export interface Advance { hpBelow?: number; answered?: number; solved?: boolean }
export interface Phrase { id: string; bars: number; events: PatternEvent[]; advance?: Advance; openBars?: number[]; weakTo?: Instrument; shield?: boolean }
export interface Requires { parts?: number; flag?: string; flags?: string[]; layer?: Instrument }

export interface StageData {
  id?: string; name?: string; seed?: number; palette?: string;
  meter?: MeterData; lives?: number; walkPxPerSec?: number; dashU?: number;
  start: [number, number];
  map: { ground: Shape[]; holes?: Shape[] };
  attacks?: Record<string, AttackDef>;
  emitters?: (V & { id: string; kind: 'device' | 'monster' | 'guardian' | 'boss'; hp?: number; body?: number; pattern?: Pattern;
    follow?: { layer: LayerId; attack: string }; motion?: { kind: 'approach'; every?: number; by?: number; min?: number; sight?: number };
    range?: number; hidden?: boolean; rot?: number; weakTo?: Instrument; onBreak?: string })[];
  parts?: (V & { layer: Instrument; guard?: string })[];
  plates?: (V & { id: string; layer: Instrument; r?: number; flag?: string; encounter?: string })[];
  gates?: { id: string; shape: Shape; requires?: Requires }[];
  checkpoints?: (V & { r?: number })[];
  encounters?: (V & { id: string; kind?: 'guardian' | 'boss'; emitter: string; r: number; flag?: string; phrases: Phrase[] })[];
}

/** A telegraphed or held attack. */
export interface Inst {
  def: AttackDef; id: string; x: number; y: number; rot: number;
  start: number; hitStep: number; hold: number; layer: LayerId;
  src: string; srcKind: string; sx: number; sy: number;
}
export interface Emitter {
  id: string; kind: 'device' | 'monster' | 'guardian' | 'boss'; x: number; y: number;
  maxHp: number; hp: number; broken: boolean; body: number; pattern: Pattern;
  follow?: { layer: LayerId; attack: string }; motion?: { kind: 'approach'; every?: number; by?: number; min?: number; sight?: number };
  range?: number; hidden: boolean; rot: number; weakTo?: Instrument; onBreak?: string;
}
export interface Part { layer: Instrument; x: number; y: number; guard: string; taken: boolean }
export interface Plate { id: string; layer: Instrument; x: number; y: number; r: number; flag: string; encounter: string; lit: boolean; count: number }
export interface Gate { id: string; shape: Shape; requires: Requires; open: boolean }
export interface Encounter {
  id: string; kind: 'guardian' | 'boss'; emitter: Emitter; x: number; y: number; r: number; phrases: Phrase[]; flag: string;
  index: number; repeat: number; phraseStart: number; running: boolean; cleared: boolean; streakOk: boolean;
}

export type StageEvent =
  | { type: 'dash'; just: boolean; offsetMs: number; from: V; to: V }
  | { type: 'fizzle'; offsetMs: number }
  | { type: 'absorb'; streak: number }
  | { type: 'strike'; inst: Inst; step: number }
  | { type: 'attack'; layer: Instrument; from: V; to: V; hit: boolean }
  | { type: 'hurt' | 'gameover'; kind: 'hit' | 'fall'; from: V; to: V; lives: number }
  | { type: 'part'; layer: Instrument; pos: V }
  | { type: 'plate'; id: string; layer: Instrument; pos: V }
  | { type: 'gate'; id: string }
  | { type: 'encounter'; id: string; phrase: string }
  | { type: 'phrase'; id: string; repeat: number; advanced: boolean }
  | { type: 'cleared'; id: string; kind: 'guardian' | 'boss' }
  | { type: 'broken'; id: string; pos: V };

export interface StageInput { moveX: number; moveY: number; /** Song time of the dash press, or null. */ dashAt: number | null; switchDir: -1 | 0 | 1; switchTo?: Instrument | null }

export const DASH_TIME = 0.16;
export const DASH_COOLDOWN = 0.25;
/** Invulnerability of a dash that is not just: only the instant of the press. */
export const SHORT_IFRAME = 0.05;
/** Steps the player stays scattered after being hit or falling (two beats). */
export const REFORM_STEPS = 8;
const SLICE = 1 / 120;
const MAX_CATCH_UP = 0.25;

export const ATTACK_RANGE_U: Record<Instrument, number> = { drum: 0.6, hat: 3.3, bass: 1.8 };
export const ATTACK_DAMAGE: Record<Instrument, number> = { drum: 10, hat: 3, bass: 2 };
const WEAK_MULT = 2, OTHER_MULT = 0.5, OPEN_MULT = 1.5, CLOSED_MULT = 0.5;
const mod = (v: number, m: number): number => ((v % m) + m) % m;
const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(ax - bx, ay - by);

export class StageSim {
  meter = new Meter();
  ground: Shape[] = [];
  holes: Shape[] = [];
  /** Pixels per U. 1U is the distance walked in one beat, and also the length of a dash. */
  u = 120;
  dashU = 1;
  inputOffsetMs = 0;
  god = false;

  // ── the player ──
  x = 0; y = 0;
  faceX = 1; faceY = 0;
  maxLives = 3;
  lives = 3;
  owned: Instrument[] = [];
  equipped: Instrument | null = null;
  dash: { t: number; dur: number; vx: number; vy: number; just: boolean } | null = null;
  iframe = 0;
  cooldown = 0;
  reform: { from: V; until: number } | null = null;
  checkpoint: V = { x: 0, y: 0 };
  streak = 0;
  /** Attacks cannot hurt before this step: one beat of grace after re-forming. */
  graceUntil = 0;

  // ── the stage ──
  attacks: Record<string, AttackDef> = {};
  emitters: Emitter[] = [];
  parts: Part[] = [];
  plates: Plate[] = [];
  checkpoints: (V & { r: number })[] = [];
  gates: Gate[] = [];
  encounters: Encounter[] = [];
  flags: Record<string, boolean> = {};
  active: Inst[] = [];
  pending: { hitStep: number; due: number }[] = [];
  private save: any = null;

  time = 0;
  step = -1;
  started = false;
  /** Things that happened since the last drain: the view and the sound read these. */
  events: StageEvent[] = [];
  /** Is that layer of the song sounding on that step? Used by the bass attack and by devices that follow the song. */
  layerSounding: ((layer: LayerId, step: number) => boolean) | null = null;

  get walkSpeed(): number { return this.u / this.meter.secPerBeat; }
  get pos(): V { return { x: this.x, y: this.y }; }

  // ───────── time ─────────

  /** Advance to song time `t`. Every whole step crossed on the way is processed in order, however long the frame was. */
  stepTo(t: number, input: Partial<StageInput> = {}): StageEvent[] {
    const sps = this.meter.secPerStep, mx = input.moveX ?? 0, my = input.moveY ?? 0;
    if (!this.started) {
      this.started = true;
      this.time = t;
      this.step = Math.floor(t / sps + 1e-9);
      this.checkpoint = this.pos;
      this.takeSave();
      return this.drain();
    }
    // Presses count even if the clock has not moved since the last frame.
    if (input.switchTo && this.owned.includes(input.switchTo)) this.equipped = input.switchTo;
    if (input.switchDir) this.switchInstrument(input.switchDir);
    if (input.dashAt != null) this.tryDash(mx, my, input.dashAt);
    if (t <= this.time) return this.drain();
    const simFrom = Math.max(this.time, t - MAX_CATCH_UP);
    while (this.time < t - 1e-9) {
      const nextStepT = (this.step + 1) * sps;
      const tn = Math.min(t, nextStepT, this.time < simFrom ? simFrom : this.time + SLICE);
      if (tn > simFrom) this.advance(tn - Math.max(this.time, simFrom), mx, my);
      this.time = tn;
      if (this.time >= nextStepT - 1e-9) { this.step++; this.onStep(this.step); }
    }
    return this.drain();
  }

  private drain(): StageEvent[] { const e = this.events; this.events = []; return e; }

  // ───────── the player ─────────

  isGround(px: number, py: number): boolean {
    for (const g of this.gates) if (g.open && contains(g.shape, px, py)) return true;
    for (const h of this.holes) if (contains(h, px, py)) return false;
    for (const g of this.ground) if (contains(g, px, py)) return true;
    return false;
  }

  switchInstrument(dir: number): void {
    if (!this.owned.length || !this.equipped) return;
    this.equipped = this.owned[mod(this.owned.indexOf(this.equipped) + dir, this.owned.length)];
  }

  /**
   * Two separate judgements:
   *  - dash: the key is pressed within the judgement time of a dodge beat -> the dash happens (always 1U)
   *  - just: the dodge starts within the just time of an attack landing on the player -> invulnerable for the whole dash
   * A dash that is not just is invulnerable only for an instant, so the player has to actually leave the attack.
   */
  private tryDash(mx: number, my: number, pressedAt: number): void {
    if (this.dash || this.cooldown > 0 || this.reform) return;
    const t = pressedAt - this.inputOffsetMs / 1000;
    const j = this.meter.judge(t);
    if (!j.dash) {
      this.cooldown = 0.08;
      this.events.push({ type: 'fizzle', offsetMs: j.offsetMs });
      return;
    }
    const ml = Math.hypot(mx, my);
    const dx = ml > 0.01 ? mx / ml : this.faceX, dy = ml > 0.01 ? my / ml : this.faceY;
    // A moment early, the attack is still on its way; a moment late, its hit is waiting to be confirmed.
    const sps = this.meter.secPerStep, win = this.meter.justMs / 1000;
    const answered: number[] = [];
    for (const p of this.pending) if (Math.abs(t - p.hitStep * sps) <= win) answered.push(p.hitStep);
    for (const a of this.active) {
      const last = a.hitStep + a.hold;
      for (let k = a.hitStep; k <= last; k += a.hold > 0 ? this.meter.stepsPerBeat : Infinity) {
        if (k > this.step && k >= this.graceUntil && Math.abs(t - k * sps) <= win && this.hits(a, this.x, this.y) && !answered.includes(k)) answered.push(k);
      }
    }
    const just = answered.length > 0, d = this.dashU * this.u;
    const from = this.pos;
    this.dash = { t: 0, dur: DASH_TIME, vx: (dx * d) / DASH_TIME, vy: (dy * d) / DASH_TIME, just };
    this.iframe = Math.max(this.iframe, SHORT_IFRAME);
    this.cooldown = DASH_COOLDOWN;
    this.events.push({ type: 'dash', just, offsetMs: j.offsetMs, from, to: { x: from.x + dx * d, y: from.y + dy * d } });
    if (just) {
      this.pending = this.pending.filter(p => !answered.includes(p.hitStep));
      this.absorb();
    }
  }

  private advance(dt: number, mx: number, my: number): void {
    this.iframe = Math.max(0, this.iframe - dt);
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (!this.reform) {
      const ml = Math.hypot(mx, my);
      if (ml > 0.01) { this.faceX = mx / ml; this.faceY = my / ml; }
      if (this.dash) {
        const d = Math.min(dt, this.dash.dur - this.dash.t);
        this.x += this.dash.vx * d; this.y += this.dash.vy * d;
        this.dash.t += dt;
        if (this.dash.t >= this.dash.dur - 1e-9) this.dash = null;
      } else if (ml > 0.01) {
        this.x += this.faceX * this.walkSpeed * dt; this.y += this.faceY * this.walkSpeed * dt;
      }
      // No walls: stepping off the ground is a fall. A dash carries the player over gaps.
      if (!this.dash && !this.isGround(this.x, this.y)) { this.hurt('fall'); return; }
      for (const c of this.checkpoints) if (dist(this.x, this.y, c.x, c.y) <= c.r) this.checkpoint = { x: c.x, y: c.y };
      for (const part of this.parts) {
        if (!part.taken && dist(this.x, this.y, part.x, part.y) <= 0.35 * this.u && this.guardCleared(part)) this.take(part);
      }
    }
    if (this.pending.some(p => p.due <= this.time)) this.hurt('hit');
  }

  guardCleared(part: Part): boolean {
    if (!part.guard) return true;
    const e = this.encounters.find(q => q.id === part.guard);
    return e ? e.cleared : true;
  }

  /** Taking an instrument is the save point: lives come back and this moment is kept. */
  private take(part: Part): void {
    part.taken = true;
    this.owned.push(part.layer);
    if (!this.equipped) this.equipped = part.layer;
    this.lives = this.maxLives;
    this.checkpoint = { x: part.x, y: part.y };
    this.openGates();
    this.takeSave();
    this.events.push({ type: 'part', layer: part.layer, pos: { x: part.x, y: part.y } });
  }

  openGates(): void {
    for (const g of this.gates) {
      if (g.open) continue;
      const r = g.requires;
      let ok = true;
      if (r.parts !== undefined && this.owned.length < r.parts) ok = false;
      if (r.flag !== undefined && !this.flags[r.flag]) ok = false;
      if (r.layer !== undefined && !this.owned.includes(r.layer)) ok = false;
      for (const f of r.flags ?? []) if (!this.flags[f]) ok = false;
      if (ok) { g.open = true; this.events.push({ type: 'gate', id: g.id }); }
    }
  }

  private takeSave(): void {
    this.save = {
      pos: { ...this.checkpoint }, owned: this.owned.slice(), equipped: this.equipped, flags: { ...this.flags },
      taken: this.parts.map(p => p.taken), gates: this.gates.map(g => g.open),
      emitters: this.emitters.map(e => [e.hp, e.broken, e.x, e.y]),
      encounters: this.encounters.map(e => e.cleared), plates: this.plates.map(p => p.lit),
    };
  }

  private absorb(): void {
    this.streak++;
    this.events.push({ type: 'absorb', streak: this.streak });
  }

  /** Lose a life and scatter. With lives left, re-form at the last checkpoint; with none, go back to the save. */
  private hurt(kind: 'hit' | 'fall'): void {
    if (this.god || this.reform) return;
    const from = this.pos;
    this.pending = [];
    this.active = this.active.filter(a => a.srcKind === 'device' || a.srcKind === 'monster');
    this.streak = 0;
    this.dash = null;
    this.lives--;
    const over = this.lives <= 0;
    if (over) this.restoreSave();
    else { this.x = this.checkpoint.x; this.y = this.checkpoint.y; }
    for (const e of this.encounters) {
      if (!e.running) continue;
      e.running = false;            // the phrase starts over when the player walks back in
      e.streakOk = false;
      for (const pl of this.plates) if (pl.encounter === e.id) { pl.lit = false; pl.count = 0; }
    }
    this.reform = { from, until: this.step + REFORM_STEPS };
    this.events.push({ type: over ? 'gameover' : 'hurt', kind, from, to: this.pos, lives: this.lives });
  }

  private restoreSave(): void {
    const s = this.save;
    this.x = s.pos.x; this.y = s.pos.y;
    this.checkpoint = { ...s.pos };
    this.owned = s.owned.slice();
    this.equipped = s.equipped;
    this.flags = { ...s.flags };
    this.lives = this.maxLives;
    this.parts.forEach((p, i) => { p.taken = s.taken[i]; });
    this.gates.forEach((g, i) => { g.open = s.gates[i]; });
    this.emitters.forEach((e, i) => { [e.hp, e.broken, e.x, e.y] = s.emitters[i]; });
    this.encounters.forEach((e, i) => {
      e.cleared = s.encounters[i]; e.index = 0; e.repeat = 0; e.running = false;
      if (!e.cleared) e.emitter.hp = e.emitter.maxHp;
    });
    this.plates.forEach((p, i) => { p.lit = s.plates[i] && !p.encounter; p.count = 0; });
    this.active = [];
  }

  // ───────── attacks ─────────

  /** Is the point inside an attack? */
  hits(a: Inst, px: number, py: number): boolean {
    const s = a.def.shape, dx = px - a.x, dy = py - a.y;
    if (s.kind === 'circle') return Math.hypot(dx, dy) <= s.r;
    if (s.kind === 'ring') { const d = Math.hypot(dx, dy); return d >= s.r0 && d <= s.r1; }
    const c = Math.cos(-a.rot), n = Math.sin(-a.rot), qx = dx * c - dy * n, qy = dx * n + dy * c;
    if (s.kind === 'beam') return qx >= 0 && qx <= (s.len ?? 100000) && Math.abs(qy) <= s.w / 2;
    return Math.abs(qx) <= s.w / 2 && Math.abs(qy) <= s.h / 2;
  }

  private spawn(em: Emitter, ev: PatternEvent, atStep: number): void {
    const def = this.attacks[ev.attack], anchor = ev.anchor ?? def.anchor ?? 'self';
    // Nothing takes aim at a player who is not there.
    if (anchor === 'target' && this.reform) return;
    let x = em.x, y = em.y;
    if (anchor === 'target') { x = this.x; y = this.y; }
    else if (anchor === 'fixed') { x = em.x + (ev.x ?? 0) * this.u; y = em.y + (ev.y ?? 0) * this.u; }
    this.active.push({
      def, id: ev.attack, x, y, rot: ((ev.rot ?? 0) * Math.PI) / 180,
      start: atStep, hitStep: atStep + def.tele, hold: def.hold ?? 0, layer: def.layer ?? 'lead',
      src: em.id, srcKind: em.kind, sx: em.x, sy: em.y,
    });
  }

  /**
   * An attack lands. The player is safe if outside it, or inside a just dodge.
   * Otherwise the hit is confirmed a moment later, so a just dodge started slightly late still answers it.
   */
  private strike(a: Inst, s: number): void {
    this.events.push({ type: 'strike', inst: a, step: s });
    if (this.god || this.reform || s < this.graceUntil || !this.hits(a, this.x, this.y)) return;
    if (this.dash?.just) return;         // already answered when the dodge started
    if (this.iframe > 0) return;
    this.pending.push({ hitStep: s, due: s * this.meter.secPerStep + (this.meter.justMs + Math.max(0, this.inputOffsetMs)) / 1000 + 0.02 });
  }

  private schedule(em: Emitter, list: PatternEvent[], local: number, s: number): void {
    for (const ev of list) if (ev.at - this.attacks[ev.attack].tele === local) this.spawn(em, ev, s);
  }

  private onStep(s: number): void {
    if (this.reform && s >= this.reform.until) {
      this.reform = null;
      this.graceUntil = s + this.meter.stepsPerBeat;      // one beat to find your feet
    }
    const spb = this.meter.stepsPerBeat;
    this.stepEncounters(s);
    for (const em of this.emitters) {
      if (em.broken || em.kind === 'guardian' || em.kind === 'boss') continue;
      // A device may follow a layer of the song instead of a pattern: it strikes on each beat that layer sounds.
      if (em.follow) {
        const tele = this.attacks[em.follow.attack].tele;
        if (mod(s + tele, spb) === 0 && this.layerSounding?.(em.follow.layer, s + tele)) this.spawn(em, { at: 0, attack: em.follow.attack, rot: em.rot }, s);
        continue;
      }
      // Some only act when the player is near (a monster does not shoot across the field).
      if (em.range !== undefined && dist(this.x, this.y, em.x, em.y) > em.range * this.u) continue;
      const pat = em.pattern, total = pat.length + (pat.rest ?? 0);
      this.schedule(em, pat.events, mod(s - (pat.phase ?? 0), total), s);
      // A monster is a device that moves: one step toward the player on its beat. It is an obstacle, not prey.
      const m = em.motion;
      if (m?.kind === 'approach' && mod(s, m.every ?? spb) === 0 && !this.reform) {
        const dx = this.x - em.x, dy = this.y - em.y, d = Math.hypot(dx, dy);
        const room = d - (m.min ?? 1) * this.u;             // never closer than its minimum
        if (room > 0.001 && d < (m.sight ?? 8) * this.u) {
          const k = Math.min((m.by ?? 0.5) * this.u, room) / d;
          em.x += dx * k; em.y += dy * k;
        }
      }
    }
    for (const a of this.active.slice()) {
      const since = s - a.hitStep;
      // A held attack strikes again on every beat while it lasts.
      if (since === 0 || (since > 0 && since <= a.hold && since % spb === 0)) this.strike(a, s);
    }
    this.active = this.active.filter(a => s < a.hitStep + a.hold);
    this.stepPlates();
    this.autoAttack(s);
  }

  // ───────── plates ─────────

  private stepPlates(): void {
    for (const pl of this.plates) {
      if (pl.lit) continue;
      const enc = this.encounters.find(e => e.id === pl.encounter);
      const live = !enc || enc.running;
      if (live && !this.reform && this.equipped === pl.layer && dist(this.x, this.y, pl.x, pl.y) <= pl.r) {
        if (++pl.count >= this.meter.stepsPerBar) {
          pl.lit = true;
          if (pl.flag) { this.flags[pl.flag] = true; this.openGates(); }
          this.events.push({ type: 'plate', id: pl.id, layer: pl.layer, pos: { x: pl.x, y: pl.y } });
        }
      } else pl.count = 0;
    }
  }

  solved(e: Encounter): boolean { return this.plates.every(pl => pl.encounter !== e.id || pl.lit); }

  // ───────── guardians and the boss ─────────

  private stepEncounters(s: number): void {
    const bar = this.meter.stepsPerBar;
    for (const e of this.encounters) {
      if (e.cleared) continue;
      const inside = !this.reform && dist(this.x, this.y, e.x, e.y) <= e.r;
      if (!e.running) {
        if (!(inside && mod(s, bar) === 0)) continue;
        e.running = true;
        e.phraseStart = s;
        e.streakOk = false;
        this.streak = 0;
        this.events.push({ type: 'encounter', id: e.id, phrase: e.phrases[e.index].id });
      }
      let ph = e.phrases[e.index];
      const adv = ph.advance ?? {}, em = e.emitter;
      if (adv.answered !== undefined && this.streak >= adv.answered) e.streakOk = true;
      const last = e.index === e.phrases.length - 1;
      const met = (adv.hpBelow !== undefined && em.hp <= adv.hpBelow * em.maxHp + 1e-6) || (adv.answered !== undefined && e.streakOk) || (!!adv.solved && this.solved(e));
      // The last phrase ends the moment its condition is met; earlier ones change on the phrase line.
      if (last && met) { this.clear(e); continue; }
      if (s - e.phraseStart >= ph.bars * bar) {
        if (met) { e.index++; e.repeat = 0; e.streakOk = false; } else e.repeat++;
        e.phraseStart = s;
        ph = e.phrases[e.index];
        this.events.push({ type: 'phrase', id: ph.id, repeat: e.repeat, advanced: met });
      }
      this.schedule(em, ph.events, s - e.phraseStart, s);
    }
  }

  private clear(e: Encounter): void {
    e.cleared = true;
    e.running = false;
    e.emitter.broken = true;
    this.active = this.active.filter(a => a.src !== e.emitter.id);
    if (e.flag) this.flags[e.flag] = true;
    this.openGates();
    this.events.push({ type: 'cleared', id: e.id, kind: e.kind });
  }

  encounterOf(em: Emitter): Encounter | null { return this.encounters.find(e => e.emitter === em) ?? null; }
  get fight(): Encounter | null { return this.encounters.find(e => e.running) ?? null; }

  // ───────── the player's attack ─────────

  /** Temporary: the equipped instrument attacks by itself, on its own rhythm, at whatever is nearest. */
  private autoAttack(s: number): void {
    const eq = this.equipped;
    if (!eq || this.reform) return;
    const spb = this.meter.stepsPerBeat;
    const fires = eq === 'drum' ? mod(s, spb) === 0 : eq === 'hat' ? mod(s, spb) === spb / 2 : !!this.layerSounding?.('bass', s);
    if (!fires) return;
    let best: Emitter | null = null, bestD = Infinity;
    for (const em of this.emitters) {
      if (em.broken || em.maxHp <= 0) continue;
      const enc = this.encounterOf(em);
      if (enc && !enc.running) continue;
      const d = dist(this.x, this.y, em.x, em.y) - em.body;
      if (d < bestD) { bestD = d; best = em; }
    }
    if (!best) return;
    const hit = bestD <= ATTACK_RANGE_U[eq] * this.u;
    if (hit) this.damage(best, ATTACK_DAMAGE[eq], s);
    this.events.push({ type: 'attack', layer: eq, from: this.pos, to: { x: best.x, y: best.y }, hit });
  }

  private damage(em: Emitter, amount: number, s: number): void {
    let mult = 1, floor = 0;
    const enc = this.encounterOf(em), eq = this.equipped;
    if (enc) {
      const ph = enc.phrases[enc.index];
      if (ph.weakTo) mult = ph.weakTo === eq ? WEAK_MULT : OTHER_MULT;
      if (ph.openBars?.length) mult *= ph.openBars.includes(Math.floor((s - enc.phraseStart) / this.meter.stepsPerBar)) ? OPEN_MULT : CLOSED_MULT;
      if (ph.shield && !this.solved(enc)) mult = 0;
      // Health cannot drop past the gate of the current phrase.
      floor = (ph.advance?.hpBelow ?? 0) * em.maxHp;
    } else if (em.weakTo) mult = em.weakTo === eq ? WEAK_MULT : OTHER_MULT;
    em.hp = Math.max(floor, em.hp - amount * mult);
    if (em.hp <= 0 && !enc) {
      em.broken = true;
      this.active = this.active.filter(a => a.src !== em.id);
      if (em.onBreak) { this.flags[em.onBreak] = true; this.openGates(); }
      this.events.push({ type: 'broken', id: em.id, pos: { x: em.x, y: em.y } });
    }
  }

  // ───────── loading ─────────

  /** Build a stage from data written in U. */
  static from(d: StageData): StageSim {
    const s = new StageSim();
    s.meter = Meter.from(d.meter);
    const k = s.u = (d.walkPxPerSec ?? 220) * s.meter.secPerBeat;
    s.dashU = d.dashU ?? 1;
    s.lives = s.maxLives = d.lives ?? 3;
    s.ground = d.map.ground.map(g => scaled(g, k));
    s.holes = (d.map.holes ?? []).map(h => scaled(h, k));
    s.x = d.start[0] * k; s.y = d.start[1] * k;
    for (const [id, a] of Object.entries(d.attacks ?? {})) {
      const sh: any = { ...a.shape };
      for (const key of Object.keys(sh)) if (key !== 'kind') sh[key] *= k;
      s.attacks[id] = { ...a, shape: sh };
    }
    for (const c of d.checkpoints ?? []) s.checkpoints.push({ x: c.x * k, y: c.y * k, r: (c.r ?? 0.8) * k });
    for (const e of d.emitters ?? []) {
      s.emitters.push({
        id: e.id, kind: e.kind, x: e.x * k, y: e.y * k, maxHp: e.hp ?? 0, hp: e.hp ?? 0, broken: false, body: (e.body ?? 0.25) * k,
        pattern: e.pattern ?? { length: 16, events: [] }, follow: e.follow, motion: e.motion, range: e.range,
        hidden: !!e.hidden, rot: e.rot ?? 0, weakTo: e.weakTo, onBreak: e.onBreak,
      });
    }
    for (const p of d.parts ?? []) s.parts.push({ layer: p.layer, x: p.x * k, y: p.y * k, guard: p.guard ?? '', taken: false });
    for (const p of d.plates ?? []) s.plates.push({ id: p.id, layer: p.layer, x: p.x * k, y: p.y * k, r: (p.r ?? 0.33) * k, flag: p.flag ?? '', encounter: p.encounter ?? '', lit: false, count: 0 });
    for (const g of d.gates ?? []) s.gates.push({ id: g.id, shape: scaled(g.shape, k), requires: g.requires ?? {}, open: false });
    for (const e of d.encounters ?? []) {
      const em = s.emitters.find(q => q.id === e.emitter)!;
      s.encounters.push({ id: e.id, kind: e.kind ?? 'guardian', emitter: em, x: e.x * k, y: e.y * k, r: e.r * k, phrases: e.phrases, flag: e.flag ?? '',
        index: 0, repeat: 0, phraseStart: 0, running: false, cleared: false, streakOk: false });
    }
    s.openGates();
    s.events = [];
    return s;
  }
}
