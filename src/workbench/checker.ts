import { BOSS_PATTERNS, BossPattern, PADS } from '../core/game/bossPatterns';
import { contains } from '../core/stage/shapes';
import { Instrument } from '../core/stage/sim';
import {
  bitsToKinds, coverage, dashOffsets, encounterOf, Grid, isRoad, KIND_BIT, KIND_NAME, Kind, kindsOf, makeGrid, Model, walkable,
} from './model';

export interface Finding {
  id: string;
  title: string;
  ok: boolean;
  /** what was found, one plain sentence per line */
  lines: string[];
  /** places on the map to point at, in px */
  where: { x: number; y: number }[];
}

const INSTRUMENTS: Instrument[] = ['drum', 'hat', 'bass'];
const names = (ks: Iterable<Kind>): string => [...ks].map(k => KIND_NAME[k]).join(', ');
const round = (v: number): number => Math.round(v * 1000) / 1000;

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map(p => [x, ...p]));
}

/* ---------------- the boss must be the validation build's ---------------- */

type Flat = (string | number)[];

function flatCore(p: BossPattern): string[] {
  return p.attacks.map(a => {
    const s = a.shape, base: Flat = [a.hitStep, a.telegraph];
    switch (s.kind) {
      case 'circle': return [...base, s.at === 'player' ? 'circle@player' : 'circle@self', s.r].join();
      case 'ring': return [...base, 'ring', s.rIn, s.rOut].join();
      case 'line': return [...base, 'beam', Math.round(((((s.angle * 180) / Math.PI) % 360) + 360) % 360), s.width].join();
      case 'zone': return [...base, 'zone', s.x, s.y, s.w, s.h, s.holdSteps].join();
    }
  }).sort();
}

function flatData(m: Model, events: { at: number; attack: string; anchor?: string; x?: number; y?: number; rot?: number }[]): string[] {
  const k = m.u;
  return events.map(ev => {
    const def = m.data.attacks?.[ev.attack];
    if (!def) return `없는 공격 ${ev.attack}`;
    const s = def.shape, base: Flat = [ev.at, def.tele], anchor = ev.anchor ?? def.anchor ?? 'self';
    switch (s.kind) {
      case 'circle': return [...base, anchor === 'target' ? 'circle@player' : 'circle@self', round(s.r * k)].join();
      case 'ring': return [...base, 'ring', round(s.r0 * k), round(s.r1 * k)].join();
      case 'beam': return [...base, 'beam', (((ev.rot ?? 0) % 360) + 360) % 360, round(s.w * k)].join();
      case 'zone': {
        const cx = anchor === 'fixed' ? (ev.x ?? 0) * k : 0, cy = anchor === 'fixed' ? (ev.y ?? 0) * k : 0;
        return [...base, 'zone', round(cx - (s.w * k) / 2), round(cy - (s.h * k) / 2), round(s.w * k), round(s.h * k), def.hold ?? 0].join();
      }
    }
  }).sort();
}

export function compareWithValidationBuild(m: Model): string[] {
  const boss = m.data.encounters?.find(e => e.kind === 'boss');
  if (!boss) return ['보스가 없다'];
  const diffs: string[] = [];
  for (const core of BOSS_PATTERNS) {
    const ph = boss.phrases.find(p => p.id === core.id);
    if (!ph) { diffs.push(`검증 빌드의 보스 패턴 ${core.id} 가 없다`); continue; }
    if (ph.bars !== core.bars) diffs.push(`${core.id}: ${ph.bars}마디 (검증 빌드 ${core.bars}마디)`);
    if (JSON.stringify(ph.openBars ?? []) !== JSON.stringify(core.openBars)) diffs.push(`${core.id}: 보스가 약해지는 마디가 다르다`);
    if ((ph.weakTo ?? null) !== core.weakTo) diffs.push(`${core.id}: 잘 들어가는 악기가 다르다`);
    const a = flatCore(core), b = flatData(m, ph.events);
    if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`${core.id}: 공격의 박, 표시 길이, 크기 중 하나가 검증 빌드와 다르다`);
  }
  const pads = (m.data.plates ?? []).filter(p => p.encounter === boss.id).map(p => `${p.layer}${round(p.x * m.u)},${round(p.y * m.u)}`).sort().join(' ');
  const core = PADS.map(p => `${p.inst}${p.x},${p.y}`).sort().join(' ');
  if (pads !== core) diffs.push('보스 공명판의 위치가 검증 빌드와 다르다');
  return diffs;
}

/* ---------------- walking the grid ---------------- */

/** Cells reachable from `from` with these parts, by walking and by dashing over gaps up to the dash length. */
function flood(m: Model, g: Grid, from: number[], parts: Instrument[], blocked?: (k: number) => boolean): Uint8Array {
  const walk = walkable(m, g, parts), seen = new Uint8Array(g.n * g.n), offs = dashOffsets(m, g), stack = from.filter(k => k >= 0 && walk[k]);
  for (const k of stack) seen[k] = 1;
  while (stack.length) {
    const k = stack.pop()!, i = k % g.n, j = (k - i) / g.n;
    for (const [di, dj] of offs) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= g.n || b >= g.n) continue;
      const q = b * g.n + a;
      if (seen[q] || !walk[q] || blocked?.(q)) continue;
      seen[q] = 1;
      stack.push(q);
    }
  }
  return seen;
}

/** Walking distance in px from the start cells to every cell (dashes over gaps count as their length). */
function distances(m: Model, g: Grid, from: number[], parts: Instrument[]): Float64Array {
  const walk = walkable(m, g, parts), dist = new Float64Array(g.n * g.n).fill(Infinity), offs = dashOffsets(m, g);
  const heap: [number, number][] = [];
  const push = (d: number, k: number): void => {
    heap.push([d, k]);
    for (let i = heap.length - 1; i > 0;) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = (): [number, number] => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let s = i;
        if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
        if (r < heap.length && heap[r][0] < heap[s][0]) s = r;
        if (s === i) break;
        [heap[s], heap[i]] = [heap[i], heap[s]]; i = s;
      }
    }
    return top;
  };
  for (const k of from) if (k >= 0 && walk[k]) { dist[k] = 0; push(0, k); }
  while (heap.length) {
    const [d, k] = pop();
    if (d > dist[k]) continue;
    const i = k % g.n, j = (k - i) / g.n;
    for (const [di, dj] of offs) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= g.n || b >= g.n) continue;
      const q = b * g.n + a, nd = d + Math.hypot(di, dj) * g.cell;
      if (!walk[q] || nd >= dist[q]) continue;
      dist[q] = nd;
      push(nd, q);
    }
  }
  return dist;
}

const near = (m: Model, g: Grid, x: number, y: number, rU: number): number[] => {
  const out: number[] = [];
  for (let j = 0; j < g.n; j++) for (let i = 0; i < g.n; i++) if (Math.hypot(g.x(i) - x, g.y(j) - y) <= rU * m.u) out.push(j * g.n + i);
  return out;
};

/* ---------------- density ---------------- */

/** The planner's density targets (2026-11-18). One screen is 10.7U x 6U. */
export const DENSITY = { screenW: 10.7, screenH: 6, perScreen: 2, quietBeats: 4, areaScreens: 3 };

export interface Density {
  paths: { layer: Instrument; lengthU: number; quietU: number; longestQuietU: number; perScreen: number; quietAt: { x: number; y: number } }[];
  areas: { layer: Instrument; sizeU2: number; screens: number }[];
}

/** Walk the shortest way from the start to each instrument and count what reaches you on the way. */
export function density(m: Model): Density {
  const d = m.data, g = makeGrid(m, 0.5), cov = coverage(m, g), walk = walkable(m, g, []);
  const start = g.index(d.start[0] * m.u, d.start[1] * m.u);
  const offs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const dist = new Float64Array(g.n * g.n).fill(Infinity), prev = new Int32Array(g.n * g.n).fill(-1);
  // straight-line Dijkstra on walkable cells (no dashing: this is the walk, not the shortcut)
  const order: number[] = [start];
  dist[start] = 0;
  for (let h = 0; h < order.length; h++) {
    const k = order[h], i = k % g.n, j = (k - i) / g.n;
    for (const [di, dj] of offs) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= g.n || b >= g.n) continue;
      const q = b * g.n + a, nd = dist[k] + Math.hypot(di, dj) * 0.5;
      if (!walk[q] || nd >= dist[q] - 1e-9) continue;
      dist[q] = nd; prev[q] = k; order.push(q);
    }
  }
  const owner = new Map<number, string[]>();
  for (const [id, cells] of cov.byEmitter) for (const c of cells) owner.set(c, [...(owner.get(c) ?? []), id]);
  const paths: Density['paths'] = [];
  for (const p of m.sim.parts) {
    const path: number[] = [];
    for (let k = g.index(p.x, p.y); k >= 0 && k !== start; k = prev[k]) path.push(k);
    path.reverse();
    let len = 0, quiet = 0, run = 0, longest = 0, quietAt = { x: p.x, y: p.y };
    const met = new Set<string>();
    for (let i = 1; i < path.length; i++) {
      const a = path[i], b = path[i - 1];
      const step = Math.hypot((a % g.n) - (b % g.n), Math.floor(a / g.n) - Math.floor(b / g.n)) * 0.5;
      len += step;
      const here = owner.get(a) ?? [];
      for (const id of here) met.add(id);
      if (!here.length && !(cov.enc[a])) {
        quiet += step; run += step;
        if (run > longest) { longest = run; quietAt = { x: g.x(a % g.n), y: g.y(Math.floor(a / g.n)) }; }
      } else run = 0;
    }
    paths.push({ layer: p.layer, lengthU: len, quietU: quiet, longestQuietU: longest, perScreen: len ? (met.size / len) * DENSITY.screenW : 0, quietAt });
  }
  const areas: Density['areas'] = [];
  for (const layer of INSTRUMENTS) {
    let n = 0;
    for (let k = 0; k < walk.length; k++) if (walk[k] && m.areaOf(g.x(k % g.n), g.y(Math.floor(k / g.n))) === layer) n++;
    if (n) areas.push({ layer, sizeU2: n * 0.25, screens: (n * 0.25) / (DENSITY.screenW * DENSITY.screenH) });
  }
  return { paths, areas };
}

/* ---------------- the report ---------------- */

export function check(m: Model): Finding[] {
  const d = m.data, sim = m.sim, out: Finding[] = [];
  const add = (id: string, title: string, lines: string[], where: { x: number; y: number }[], okLine: string): void => {
    out.push({ id, title, ok: lines.length === 0, lines: lines.length ? lines : [okLine], where });
  };
  const g = makeGrid(m, 0.5);
  const cov = coverage(m, g);
  const roadEmitters = sim.emitters.filter(e => isRoad(e.kind));
  const bossEm = sim.emitters.find(e => e.kind === 'boss');
  const bossKinds = bossEm ? kindsOf(m, bossEm.id) : new Set<Kind>();
  const start = { x: d.start[0] * m.u, y: d.start[1] * m.u };

  // 1. the boss is the validation build's
  add('same-as-validation', '보스 패턴이 검증 빌드와 같은가', compareWithValidationBuild(m), [],
    `보스 패턴 ${BOSS_PATTERNS.length}개의 박, 표시 길이, 크기와 공명판 위치가 src/core/game/bossPatterns.ts 와 같다`);

  // 2. every judged step is on a kick or snare beat
  {
    const bad: string[] = [], where: { x: number; y: number }[] = [];
    for (const e of d.emitters ?? []) {
      const p = e.pattern;
      if (p) {
        const steps = p.events.map(ev => ev.at + (p.phase ?? 0)).filter(s => !sim.meter.isStrikeStep(s));
        const loop = p.length + (p.rest ?? 0);
        if (steps.length) { bad.push(`${m.label(e.id)}: 스텝 ${steps.join(', ')} 은 정박이 아니다`); where.push({ x: e.x * m.u, y: e.y * m.u }); }
        if (loop % sim.meter.stepsPerBeat) bad.push(`${m.label(e.id)}: 한 바퀴가 ${loop}스텝이라 돌수록 박에서 어긋난다`);
      }
    }
    for (const enc of d.encounters ?? []) for (const ph of enc.phrases) {
      const steps = ph.events.map(ev => ev.at).filter(s => !sim.meter.isStrikeStep(s));
      if (steps.length) bad.push(`${enc.id} 의 ${ph.id}: 스텝 ${steps.join(', ')} 은 정박이 아니다`);
    }
    add('on-beat', '공격 판정이 정박에서만 나는가', bad, where, '모든 공격 판정이 정박(킥·스네어 박)에 있다');
  }

  // 3. everything stands on ground
  {
    const bad: string[] = [], where: { x: number; y: number }[] = [];
    const things = [
      ...sim.emitters.filter(e => !e.hidden).map(e => ({ label: m.label(e.id), x: e.x, y: e.y })),
      ...sim.parts.map(p => ({ label: `${p.layer} 악기`, x: p.x, y: p.y })),
      ...sim.plates.map(p => ({ label: `공명판 ${p.id}`, x: p.x, y: p.y })),
      ...sim.checkpoints.map((c, i) => ({ label: `체크포인트 ${i + 1}`, x: c.x, y: c.y })),
      { label: '시작 위치', ...start },
    ];
    for (const g2 of sim.gates) g2.open = true;
    sim.field.setWays(sim.gates.map(g2 => g2.shape));
    for (const t of things) if (!sim.isGround(t.x, t.y)) { bad.push(`${t.label} 가 낭떠러지 위에 있다`); where.push(t); }
    add('on-ground', '모든 것이 땅 위에 있는가', bad, where, `장치·몬스터·수호자·악기·공명판·체크포인트 ${things.length}개가 모두 땅 위에 있다`);
  }

  // 4. instrument areas are split by cliffs: with no instrument, you cannot walk or dash from one into another without the centre
  {
    const bad: string[] = [], where: { x: number; y: number }[] = [];
    const g4 = makeGrid(m, 0.25);
    const centre = sim.field.ground.find(s => s.kind === 'circle');
    const inCentre = (k: number): boolean => !!centre && centre.kind === 'circle' && Math.hypot(g4.x(k % g4.n) - centre.x, g4.y(Math.floor(k / g4.n)) - centre.y) <= centre.r + sim.dashU * m.u;
    const areaCells = new Map<Instrument, number[]>();
    for (let k = 0; k < g4.n * g4.n; k++) {
      if (inCentre(k)) continue;
      const a = m.areaOf(g4.x(k % g4.n), g4.y(Math.floor(k / g4.n)));
      if (a) areaCells.set(a, [...(areaCells.get(a) ?? []), k]);
    }
    for (const [a, cells] of areaCells) {
      const seen = flood(m, g4, cells, [], inCentre);
      for (const [b, other] of areaCells) {
        if (b === a) continue;
        const leak = other.find(k => seen[k]);
        if (leak !== undefined) {
          bad.push(`악기가 없을 때 ${a} 구역에서 가운데 필드를 거치지 않고 ${b} 구역으로 갈 수 있다(걷기나 대시 1U로)`);
          where.push({ x: g4.x(leak % g4.n), y: g4.y(Math.floor(leak / g4.n)) });
        }
      }
    }
    add('cliffs', '악기 구역 사이가 절벽으로 나뉘어 있는가 (기획자 결정)', bad, where,
      '악기가 없을 때는 가운데 필드를 거쳐야만 다른 구역으로 갈 수 있다. 구역 사이 절벽은 대시(1U)로 건널 수 없다');
  }

  // 5. every boss attack is on the road first
  {
    const roadKinds = new Set(roadEmitters.flatMap(e => [...kindsOf(m, e.id)]));
    const bad = [...bossKinds].filter(k => !roadKinds.has(k)).map(k => `보스의 ${KIND_NAME[k]} 공격이 길에 한 번도 안 나온다`);
    add('road-first', '보스가 쓰는 공격이 모두 길에 먼저 나오는가', bad, [], `보스가 쓰는 공격(${names(bossKinds)})이 모두 길의 장치나 몬스터에 있다`);
  }

  // 6. the first time you meet an attack, it is alone: walking in from the start, the nearest place it reaches alone comes before the nearest place it reaches mixed
  {
    const bad: string[] = [], where: { x: number; y: number }[] = [];
    const dist = distances(m, g, [g.index(start.x, start.y)], []);
    for (const kind of bossKinds) {
      const bit = KIND_BIT[kind];
      let alone = Infinity, mixed = Infinity, mixedAt = -1;
      for (let c = 0; c < dist.length; c++) {
        const b = cov.road[c] | cov.enc[c];
        if (!(b & bit) || !Number.isFinite(dist[c])) continue;
        if (b === bit) alone = Math.min(alone, dist[c]);
        else if (dist[c] < mixed) { mixed = dist[c]; mixedAt = c; }
      }
      const others = mixedAt >= 0 ? bitsToKinds((cov.road[mixedAt] | cov.enc[mixedAt]) & ~bit).map(k => KIND_NAME[k]).join(', ') : '';
      if (!Number.isFinite(alone)) bad.push(`${KIND_NAME[kind]} 공격이 혼자 닿는 곳이 없다`);
      else if (mixed <= alone) {
        bad.push(`${KIND_NAME[kind]}: 시작에서 ${(mixed / m.u).toFixed(1)}U 가면 ${others} 공격과 섞인 곳에 먼저 닿는다 (혼자인 곳은 ${(alone / m.u).toFixed(1)}U)`);
        where.push({ x: g.x(mixedAt % g.n), y: g.y(Math.floor(mixedAt / g.n)) });
      }
    }
    add('first-alone', '공격을 처음 만날 때 그것 하나만 있는가', bad, where,
      '시작에서 걸어 들어가면 각 공격이 혼자 닿는 곳을 섞인 곳보다 먼저 만난다(공격이 닿는 범위와 걷는 거리로 계산)');
  }

  // 7. met again before the boss, and together with another attack
  {
    const bad: string[] = [];
    for (const k of bossKinds) {
      const n = roadEmitters.filter(e => kindsOf(m, e.id).has(k)).length;
      if (n < 2) bad.push(`${KIND_NAME[k]} 공격이 보스 전에 ${n}번만 나온다 (2번 이상 필요)`);
      const bit = KIND_BIT[k];
      let mixed = false;
      for (let c = 0; c < cov.road.length && !mixed; c++) if ((cov.road[c] & bit) && (cov.road[c] & ~bit)) mixed = true;
      if (!mixed) bad.push(`${KIND_NAME[k]} 공격이 보스 전에 다른 공격과 함께 나오는 곳이 없다`);
    }
    add('repeat', '보스 전에 다시, 다른 공격과 함께 나오는가', bad, [], '보스가 쓰는 공격마다 길에서 2번 이상, 다른 공격과 함께 나오는 곳이 있다');
  }

  // 8. every boss attack appears in a guardian
  {
    const gk = new Set(sim.emitters.filter(e => e.kind === 'guardian').flatMap(e => [...kindsOf(m, e.id)]));
    const bad = [...bossKinds].filter(k => !gk.has(k)).map(k => `${KIND_NAME[k]} 공격을 쓰는 수호자가 없다`);
    add('guardians', '보스가 쓰는 공격이 수호자에서도 나오는가', bad, [], `수호자들이 ${names(gk)} 공격을 쓴다`);
  }

  // 9. collect in any order, then reach the boss
  {
    const bad: string[] = [];
    const bossEnc = d.encounters?.find(e => e.kind === 'boss');
    for (const order of permutations(INSTRUMENTS.filter(i => sim.parts.some(p => p.layer === i)))) {
      let from = [g.index(start.x, start.y)];
      const have: Instrument[] = [];
      let ok = true;
      for (const i of order) {
        const pt = sim.parts.find(p => p.layer === i)!;
        const seen = flood(m, g, from, have), target = near(m, g, pt.x, pt.y, 0.8);
        if (!target.some(k => seen[k])) { bad.push(`${order.join(' → ')} 순서: ${i} 악기에 닿지 못한다`); ok = false; break; }
        have.push(i);
        from = target;
      }
      if (ok && bossEnc) {
        const seen = flood(m, g, from, have);
        if (!near(m, g, bossEnc.x * m.u, bossEnc.y * m.u, 1).some(k => seen[k])) bad.push(`${order.join(' → ')} 순서: 셋을 모은 뒤 보스에 닿지 못한다`);
      }
    }
    add('any-order', '어느 순서로 모아도 악기 셋과 보스에 닿는가', bad, [], '악기 3개를 모으는 6가지 순서 모두 보스까지 걷기와 대시로 간다');
  }

  // 10. a guardian can be passed without any instrument
  {
    const bad: string[] = [], where: { x: number; y: number }[] = [];
    for (const p of sim.parts) {
      const enc = d.encounters?.find(e => e.id === p.guard);
      if (!enc) { bad.push(`${p.layer} 악기를 지키는 수호자가 없다`); continue; }
      if (!enc.phrases.every(ph => (ph.advance?.answered ?? 0) > 0)) { bad.push(`${enc.id}: 악기 없이 통과하는 방법(회피 통과)이 없다`); where.push({ x: enc.x * m.u, y: enc.y * m.u }); }
    }
    add('dodge-pass', '악기가 없어도 수호자를 통과할 수 있는가', bad, where, '모든 수호자를 회피 통과(공격을 연속으로 저스트 회피)로 넘을 수 있다');
  }

  // 12. dense enough (planner, 2026-11-18): on the way to each instrument, 2 or more things per screen of walking
  //     and at most 4 beats with nothing reaching; an instrument area at most 3 screens big
  {
    const bad: string[] = [], where: { x: number; y: number }[] = [];
    const d0 = density(m);
    for (const r of d0.paths) {
      if (r.longestQuietU > DENSITY.quietBeats) { bad.push(`${r.layer} 악기까지: 아무 공격도 닿지 않는 구간이 ${r.longestQuietU.toFixed(1)}박 이어진다(${DENSITY.quietBeats}박 이하)`); where.push(r.quietAt); }
      if (r.perScreen < DENSITY.perScreen) bad.push(`${r.layer} 악기까지: 걸어서 화면 하나(${DENSITY.screenW}U)에 ${r.perScreen.toFixed(1)}번 만난다(${DENSITY.perScreen}번 이상)`);
    }
    for (const a of d0.areas) if (a.screens > DENSITY.areaScreens) bad.push(`${a.layer} 구역의 땅이 화면 ${a.screens.toFixed(1)}장 크기다(${DENSITY.areaScreens}장 이하)`);
    add('density', '맵이 촘촘한가 (기획자 결정 기준)', bad, where,
      `악기까지 가는 길에서 화면 하나에 ${DENSITY.perScreen}번 이상 만나고, 아무 일 없이 걷는 구간이 ${DENSITY.quietBeats}박 이하이며, 구역마다 화면 ${DENSITY.areaScreens}장 이하다`);
  }

  // 11. a checkpoint near every attack on the road
  {
    const bad: string[] = [], where: { x: number; y: number }[] = [];
    const cps = [...sim.checkpoints, start];
    for (const e of roadEmitters.filter(x => !x.hidden)) {
      const dmin = Math.min(...cps.map(c => Math.hypot(c.x - e.x, c.y - e.y))) / m.u;
      if (dmin > 8) { bad.push(`${m.label(e.id)}: 가장 가까운 체크포인트가 ${dmin.toFixed(1)}U 떨어져 있다(8U 이내 권장)`); where.push(e); }
    }
    add('checkpoints', '공격이 있는 곳마다 8U 안에 체크포인트가 있는가', bad, where, '길의 장치와 몬스터마다 8U 안에 체크포인트나 시작 위치가 있다');
  }

  for (const gt of sim.gates) gt.open = false;
  sim.field.setWays([]);
  sim.openGates();
  return out;
}

/** For each boss attack: the emitters that show it alone, the others, the guardians and the boss phrases that use it. */
export function appearanceTable(m: Model): { kind: Kind; emitters: { label: string; alonePct: number }[]; guardians: string[]; boss: string[] }[] {
  const g = makeGrid(m, 0.5), cov = coverage(m, g);
  const bossEm = m.sim.emitters.find(e => e.kind === 'boss');
  const bossKinds = bossEm ? kindsOf(m, bossEm.id) : new Set<Kind>();
  return [...bossKinds].map(kind => {
    const bit = KIND_BIT[kind];
    const road = m.sim.emitters.filter(e => isRoad(e.kind) && kindsOf(m, e.id).has(kind));
    return {
      kind,
      emitters: road.map(e => {
        const cells = cov.byEmitter.get(e.id) ?? [];
        const alone = cells.filter(c => (cov.road[c] | cov.enc[c]) === bit).length;
        return { label: m.label(e.id), alonePct: cells.length ? Math.round((100 * alone) / cells.length) : 0 };
      }),
      guardians: m.sim.emitters.filter(e => e.kind === 'guardian' && kindsOf(m, e.id).has(kind)).map(e => encounterOf(m, e.id)?.id ?? e.id),
      boss: (m.data.encounters?.find(e => e.kind === 'boss')?.phrases ?? []).filter(p => p.events.some(ev => m.sim.attacks[ev.attack]?.shape.kind === kind)).map(p => p.id),
    };
  });
}

/** Is the point inside a ground shape that is not one of the instrument areas? (used to draw areas) */
export function inCentre(m: Model, x: number, y: number): boolean {
  return m.sim.field.ground.some(s => s.kind === 'circle' && contains(s, x, y));
}
