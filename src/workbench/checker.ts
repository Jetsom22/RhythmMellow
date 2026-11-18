import { BOSS_PATTERNS, BossPattern, PADS } from '../core/game/bossPatterns';
import { areaAt, onGround } from './field';
import { AttackKind, EmitterDef, Hit, INSTRUMENTS, Instrument, KIND_NAME, Pt, ResolvedPattern, Stage, emitterPatterns } from './stage';
import { judgedSteps } from './timeline';

export interface Finding {
  id: string;
  title: string;
  ok: boolean;
  /** what was found, one plain sentence per line */
  lines: string[];
  /** places on the map to point at */
  where: Pt[];
}

const kindsOf = (pats: ResolvedPattern[]): Set<AttackKind> => new Set(pats.flatMap(p => p.hits.map(h => h.shape.type)));
const names = (ks: Iterable<AttackKind>): string => [...ks].map(k => KIND_NAME[k]).join(', ');
const isRoad = (e: EmitterDef): boolean => e.kind === 'device' || e.kind === 'monster';

export function bossKinds(st: Stage): Set<AttackKind> {
  return kindsOf(st.data.emitters.filter(e => e.kind === 'boss').flatMap(e => emitterPatterns(st, e)));
}

/** Attack kinds present in each area. */
export function kindsByArea(st: Stage): Map<string, Set<AttackKind>> {
  const m = new Map<string, Set<AttackKind>>();
  for (const a of st.data.areas) m.set(a.id, new Set());
  for (const e of st.data.emitters) for (const k of kindsOf(emitterPatterns(st, e))) m.get(e.area)?.add(k);
  return m;
}

/* ---------------- walking the routes ---------------- */

interface Walk { area: string; parts: Instrument[] }

function partAt(st: Stage, area: string): Instrument | null {
  return st.data.parts.find(p => p.area === area)?.instrument ?? null;
}

/** Areas you can step into from here with these parts. Pads light up when you walk the centre with a part. */
function nextAreas(st: Stage, w: Walk): string[] {
  const out: string[] = [];
  const lit = w.parts.length;
  for (const r of st.data.routes) {
    const ok = (!r.requires?.parts || r.requires.parts.every(p => w.parts.includes(p))) && (!r.requires?.padsLit || lit >= r.requires.padsLit);
    if (!ok) continue;
    if (r.from === w.area) out.push(r.to);
    if (r.twoWay && r.to === w.area) out.push(r.from);
  }
  return out;
}

/** Can we walk from `from` to `to` holding `parts`, without picking up any other part on the way? */
function reach(st: Stage, from: string, to: string, parts: Instrument[]): boolean {
  const seen = new Set([from]), queue = [from];
  while (queue.length) {
    const a = queue.shift()!;
    if (a === to) return true;
    for (const b of nextAreas(st, { area: a, parts })) {
      const p = partAt(st, b);
      if (seen.has(b) || (p && !parts.includes(p) && b !== to)) continue;
      seen.add(b);
      queue.push(b);
    }
  }
  return false;
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map(p => [x, ...p]));
}

/* ---------------- the boss patterns must match the validation build ---------------- */

interface Flat { step: number; telegraph: number; kind: string; a: number; b: number; c: number; d: number; e: number }

function flatCore(p: BossPattern): Flat[] {
  return p.attacks.map(a => {
    const s = a.shape, base = { step: a.hitStep, telegraph: a.telegraph };
    switch (s.kind) {
      case 'circle': return { ...base, kind: s.at === 'player' ? 'circle@player' : 'circle@self', a: s.r, b: 0, c: 0, d: 0, e: 0 };
      case 'ring': return { ...base, kind: 'ring', a: s.rIn, b: s.rOut, c: 0, d: 0, e: 0 };
      case 'line': return { ...base, kind: 'beam', a: Math.round((((s.angle * 180) / Math.PI) % 360 + 360) % 360), b: s.width, c: 0, d: 0, e: 0 };
      case 'zone': return { ...base, kind: 'zone', a: s.x, b: s.y, c: s.w, d: s.h, e: s.holdSteps };
    }
  });
}

function flatData(p: ResolvedPattern): Flat[] {
  return p.hits.flatMap((h: Hit): Flat[] => {
    const s = h.shape, base = { step: h.step, telegraph: h.telegraph };
    switch (s.type) {
      case 'circle': return [{ ...base, kind: h.anchor === 'player' ? 'circle@player' : 'circle@self', a: s.radius, b: 0, c: 0, d: 0, e: 0 }];
      case 'ring': return [{ ...base, kind: 'ring', a: s.inner, b: s.outer, c: 0, d: 0, e: 0 }];
      case 'beam': return s.angles.map(ang => ({ ...base, kind: 'beam', a: ((ang % 360) + 360) % 360, b: s.width, c: 0, d: 0, e: 0 }));
      case 'zone': {
        let cx = 0, cy = 0;
        if (h.anchor.startsWith('pad:')) { const pad = p.pads[Number(h.anchor.slice(4))]; cx = pad.x; cy = pad.y; }
        if (h.offset) { cx += h.offset.x; cy += h.offset.y; }
        return [{ ...base, kind: 'zone', a: cx - s.w / 2, b: cy - s.h / 2, c: s.w, d: s.h, e: s.holdSteps }];
      }
    }
  });
}

const key = (f: Flat): string => [f.step, f.telegraph, f.kind, f.a, f.b, f.c, f.d, f.e].join(',');

export function compareWithValidationBuild(st: Stage): string[] {
  const diffs: string[] = [];
  for (const core of BOSS_PATTERNS) {
    const mine = st.patterns[core.id];
    if (!mine) { diffs.push(`검증 빌드의 보스 패턴 ${core.id} 가 데이터에 없다`); continue; }
    const def = st.data.patterns[core.id];
    if (mine.loopSteps !== core.bars * st.stepsPerBar) diffs.push(`${core.id}: 길이가 ${mine.loopSteps / st.stepsPerBar}마디 (검증 빌드 ${core.bars}마디)`);
    if (JSON.stringify(def.openBars ?? []) !== JSON.stringify(core.openBars)) diffs.push(`${core.id}: 보스가 약해지는 마디가 다르다`);
    if ((def.weakTo ?? null) !== core.weakTo) diffs.push(`${core.id}: 잘 들어가는 악기가 다르다`);
    const a = flatCore(core).map(key).sort(), b = flatData(mine).map(key).sort();
    if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`${core.id}: 공격의 박, 표시 길이, 크기 중 하나가 검증 빌드와 다르다`);
    const pads = (mine.pads ?? []).map(p => `${p.instrument}${p.x},${p.y}`).join(' ');
    const corePads = PADS.map(p => `${p.inst}${p.x},${p.y}`).join(' ');
    if (core.texture === 'resolve' && pads !== corePads) diffs.push(`${core.id}: 공명판 위치가 다르다`);
  }
  return diffs;
}

/* ---------------- the report ---------------- */

export function check(st: Stage): Finding[] {
  const d = st.data, out: Finding[] = [];
  const add = (id: string, title: string, lines: string[], where: Pt[] = [], okLine?: string): void => {
    out.push({ id, title, ok: lines.length === 0, lines: lines.length ? lines : okLine ? [okLine] : [], where });
  };
  const byArea = kindsByArea(st);
  const boss = bossKinds(st);
  const roadEmitters = d.emitters.filter(isRoad);
  const areaName = (id: string): string => d.areas.find(a => a.id === id)?.name ?? id;

  // 1. the boss patterns are the validation build's
  add('same-as-validation', '보스 패턴이 검증 빌드와 같은가', compareWithValidationBuild(st), [],
    `보스 패턴 ${BOSS_PATTERNS.length}개의 박, 표시 길이, 크기가 src/core/game/bossPatterns.ts 와 같다`);

  // 2. every judged step is on a kick or snare beat
  {
    const bad: string[] = [], where: Pt[] = [];
    for (const [id, p] of Object.entries(st.patterns)) {
      const steps = judgedSteps(p).filter(s => !d.meter.strikeSteps.includes(((s % st.stepsPerBar) + st.stepsPerBar) % st.stepsPerBar));
      if (steps.length) bad.push(`${p.name || id}: 스텝 ${steps.join(', ')} 은 정박이 아니다`);
    }
    for (const e of d.emitters) if ((e.startStep ?? 0) % d.meter.stepsPerBeat !== 0) { bad.push(`${e.id}: 시작 스텝 ${e.startStep} 이 정박이 아니다`); where.push(st.pos(e.at)); }
    add('on-beat', '공격 판정이 정박에서만 나는가', bad, where, '모든 판정이 정박(킥·스네어 박)에 있다');
  }

  // 3. everything stands on ground, in the area it says
  {
    const bad: string[] = [], where: Pt[] = [];
    const things: { label: string; at: Pt; area: string }[] = [
      ...d.emitters.map(e => ({ label: `${e.name} (${e.id})`, at: st.pos(e.at), area: e.area })),
      ...d.parts.map(p => ({ label: `악기 ${p.instrument}`, at: st.pos(p.at), area: p.area })),
      ...d.pads.map(p => ({ label: `공명판 ${p.instrument}`, at: st.pos(p.at), area: p.area })),
      ...d.checkpoints.map(c => ({ label: `체크포인트 ${c.id}`, at: st.pos(c.at), area: c.area })),
      { label: '시작 위치', at: st.pos(d.start.at), area: d.start.area },
    ];
    for (const t of things) {
      if (!onGround(st, t.at, 3)) { bad.push(`${t.label} 가 낭떠러지 위에 있다`); where.push(t.at); }
      const a = areaAt(st, t.at);
      if (a !== t.area) { bad.push(`${t.label} 는 ${areaName(t.area)} 에 있다고 적혀 있는데 실제 위치는 ${a ? areaName(a) : '어느 구역도 아님'}`); where.push(t.at); }
    }
    add('on-ground', '모든 것이 땅 위, 적힌 구역 안에 있는가', bad, where, `장치·몬스터·수호자·악기·공명판·체크포인트 ${things.length}개가 모두 땅 위, 적힌 구역 안에 있다`);
  }

  // 4. split by cliffs: from one instrument area you cannot walk into another without the centre, and no cliff a dash can cross
  {
    const bad: string[] = [], where: Pt[] = [];
    const zoneOfArea = (id: string): string | undefined => d.areas.find(a => a.id === id)?.zone;
    const places = [
      ...d.emitters.map(e => ({ zone: zoneOfArea(e.area), at: st.pos(e.at) })),
      ...d.parts.map(p => ({ zone: zoneOfArea(p.area), at: st.pos(p.at) })),
      ...d.checkpoints.map(c => ({ zone: zoneOfArea(c.area), at: st.pos(c.at) })),
    ].filter(p => p.zone && Math.hypot(p.at.x, p.at.y) >= 15.5 * st.u);
    const cell = st.u / 4, R = 34 * st.u, n = Math.ceil((2 * R) / cell);
    const idx = (p: Pt): [number, number] => [Math.floor((p.x + R) / cell), Math.floor((p.y + R) / cell)];
    const walk = (i: number, j: number): boolean => {
      const p = { x: -R + (i + 0.5) * cell, y: -R + (j + 0.5) * cell };
      return Math.hypot(p.x, p.y) >= 15 * st.u && onGround(st, p);
    };
    for (const zone of new Set(places.map(p => p.zone!))) {
      const seen = new Uint8Array(n * n), stack = places.filter(p => p.zone === zone).map(p => idx(p.at));
      while (stack.length) {
        const [i, j] = stack.pop()!;
        if (i < 0 || j < 0 || i >= n || j >= n || seen[j * n + i] || !walk(i, j)) continue;
        seen[j * n + i] = 1;
        stack.push([i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]);
      }
      const leak = places.find(p => p.zone !== zone && seen[idx(p.at)[1] * n + idx(p.at)[0]]);
      if (leak) { bad.push(`${zone} 구역에서 가운데 필드를 거치지 않고 ${leak.zone} 구역으로 걸어갈 수 있다`); where.push(leak.at); }
    }
    for (const h of d.field.holes) if (h.id?.startsWith('cliff') && h.type === 'path' && h.width <= 1 + 20 / st.u) bad.push(`${h.id}: 폭 ${h.width}U 는 대시(1U)로 건널 수 있다`);
    add('cliffs', '구역 사이가 절벽으로 나뉘어 있는가 (기획자 결정)', bad, where, '악기 구역끼리는 가운데 필드를 거쳐야만 오갈 수 있고, 절벽 폭은 대시로 건널 수 없다');
  }

  // 5. every boss attack is on the road before the boss
  {
    const bad = [...boss].filter(k => !roadEmitters.some(e => kindsOf(emitterPatterns(st, e)).has(k))).map(k => `보스의 ${KIND_NAME[k]} 공격이 길에 한 번도 안 나온다`);
    add('road-first', '보스가 쓰는 공격이 모두 길에 먼저 나오는가', bad, [], `보스가 쓰는 공격(${names(boss)})이 모두 길의 장치나 몬스터에 있다`);
  }

  // 6. the first time you meet an attack, it is alone — on every way through the routes
  {
    const bad: string[] = [], where: Pt[] = [];
    const startArea = d.start.area;
    type S = { area: string; mask: number; parts: Instrument[] };
    const bit = (k: AttackKind): number => ({ circle: 1, ring: 2, beam: 4, zone: 8 })[k];
    const learn = (area: string, mask: number): { mask: number; fresh: AttackKind[] } => {
      const ks = [...(byArea.get(area) ?? [])];
      const fresh = ks.filter(k => !(mask & bit(k)));
      if (ks.length === 1) return { mask: mask | bit(ks[0]), fresh: [] };
      return { mask: mask | ks.reduce((m, k) => m | bit(k), 0), fresh };
    };
    const first = learn(startArea, 0);
    const seen = new Set<string>(), reported = new Set<string>();
    const queue: S[] = [{ area: startArea, mask: first.mask, parts: [] }];
    while (queue.length) {
      const s = queue.shift()!;
      for (const b of nextAreas(st, { area: s.area, parts: s.parts })) {
        const l = learn(b, s.mask);
        if (l.fresh.length && !reported.has(b)) {
          reported.add(b);
          bad.push(`${areaName(b)}: ${names(l.fresh)} 공격을 다른 공격과 섞인 채로 처음 만날 수 있다`);
          const e = d.emitters.find(x => x.area === b);
          if (e) where.push(st.pos(e.at));
        }
        const p = partAt(st, b);
        const parts = p && !s.parts.includes(p) ? [...s.parts, p] : s.parts;
        const k = `${b}|${l.mask}|${[...parts].sort().join()}`;
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push({ area: b, mask: l.mask, parts });
      }
    }
    add('first-alone', '공격을 처음 만날 때 그것 하나만 있는가', bad, where, '어느 길로 가도 각 공격을 처음 만나는 곳에는 그 공격 하나만 있다');
  }

  // 7. seen again before the boss
  {
    const bad: string[] = [];
    for (const k of boss) {
      const n = roadEmitters.filter(e => kindsOf(emitterPatterns(st, e)).has(k)).length;
      if (n < 2) bad.push(`${KIND_NAME[k]} 공격이 보스 전에 ${n}번만 나온다 (2번 이상 필요)`);
      const mixed = [...byArea.entries()].some(([a, ks]) => a !== 'boss' && ks.has(k) && ks.size > 1 && d.emitters.some(e => e.area === a && isRoad(e)));
      if (!mixed) bad.push(`${KIND_NAME[k]} 공격이 보스 전에 다른 공격과 함께 나오는 곳이 없다`);
    }
    add('repeat', '보스 전에 다시, 다른 공격과 함께 나오는가', bad, [], '보스가 쓰는 공격마다 길에서 2번 이상, 다른 공격과 함께 나오는 곳이 있다');
  }

  // 8. every boss attack appears in a guardian
  {
    const g = kindsOf(d.emitters.filter(e => e.kind === 'guardian').flatMap(e => emitterPatterns(st, e)));
    const bad = [...boss].filter(k => !g.has(k)).map(k => `${KIND_NAME[k]} 공격을 쓰는 수호자가 없다`);
    add('guardians', '보스가 쓰는 공격이 수호자에서도 나오는가', bad, [], `수호자들이 ${names(g)} 공격을 쓴다`);
  }

  // 9. collect in any order, then reach the boss
  {
    const bad: string[] = [];
    const insts = INSTRUMENTS.filter(i => d.parts.some(p => p.instrument === i));
    for (const order of permutations(insts)) {
      let at = d.start.area;
      const have: Instrument[] = [];
      let ok = true;
      for (const i of order) {
        const target = d.parts.find(p => p.instrument === i)!.area;
        if (!reach(st, at, target, have)) { bad.push(`${order.join(' → ')} 순서: ${i} 를 얻으러 ${areaName(target)} 에 갈 수 없다`); ok = false; break; }
        have.push(i);
        at = target;
      }
      if (ok && !reach(st, at, 'boss', have)) bad.push(`${order.join(' → ')} 순서: 셋을 모은 뒤 보스에게 갈 수 없다`);
    }
    add('any-order', '어느 순서로 모아도 악기 셋과 보스에 닿는가', bad, [], `악기 ${insts.length}개를 모으는 ${permutations(insts).length}가지 순서 모두 보스까지 간다`);
  }

  // 10. a guardian can be passed without any instrument
  {
    const bad: string[] = [], where: Pt[] = [];
    for (const p of d.parts) {
      const g = d.emitters.find(e => e.id === p.guard);
      if (!g) { bad.push(`${p.instrument} 를 지키는 수호자 ${p.guard} 가 없다`); continue; }
      if (!g.pass?.includes('dodge')) { bad.push(`${g.name}: 악기 없이 통과하는 방법(회피 통과)이 없다`); where.push(st.pos(g.at)); }
    }
    add('dodge-pass', '악기가 없어도 수호자를 통과할 수 있는가', bad, where, '모든 수호자를 회피 통과(공격 3번 연속 저스트 대시)로 넘을 수 있다');
  }

  // 11. a checkpoint near every area with attacks
  {
    const bad: string[] = [], where: Pt[] = [];
    const cpAreas = new Set([...d.checkpoints.map(c => c.area), d.start.area]);
    for (const a of d.areas) {
      if (a.id === 'boss' || !d.emitters.some(e => e.area === a.id)) continue;
      const near = cpAreas.has(a.id) || d.routes.some(r => (r.from === a.id && cpAreas.has(r.to)) || (r.to === a.id && cpAreas.has(r.from)));
      if (!near) { bad.push(`${a.name}: 이 구역이나 바로 옆 구역에 체크포인트가 없다`); const e = d.emitters.find(x => x.area === a.id); if (e) where.push(st.pos(e.at)); }
    }
    add('checkpoints', '공격이 있는 구역마다 가까이에 체크포인트가 있는가', bad, where, '공격이 있는 구역마다 그 구역이나 바로 옆 구역에 체크포인트가 있다');
  }

  return out;
}

/** For each boss attack: where it is first met alone, where again, which guardians, which boss patterns. */
export function appearanceTable(st: Stage): { kind: AttackKind; first: string[]; again: string[]; guardians: string[]; boss: string[] }[] {
  const d = st.data, byArea = kindsByArea(st);
  const areaName = (id: string): string => d.areas.find(a => a.id === id)?.name ?? id;
  return [...bossKinds(st)].map(kind => {
    const roadAreas = [...new Set(d.emitters.filter(e => isRoad(e) && kindsOf(emitterPatterns(st, e)).has(kind)).map(e => e.area))];
    const alone = roadAreas.filter(a => byArea.get(a)?.size === 1 && d.areas.find(x => x.id === a)?.role !== 'middle');
    return {
      kind,
      first: alone.map(areaName),
      again: roadAreas.filter(a => !alone.includes(a)).map(areaName),
      guardians: d.emitters.filter(e => e.kind === 'guardian' && kindsOf(emitterPatterns(st, e)).has(kind)).map(e => e.name),
      boss: d.emitters.filter(e => e.kind === 'boss').flatMap(e => emitterPatterns(st, e)).filter(p => p.hits.some(h => h.shape.type === kind)).map(p => p.id),
    };
  });
}
