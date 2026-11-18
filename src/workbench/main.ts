import { StageData } from '../core/stage/sim';
import { appearanceTable, check, Finding } from './checker';
import { coverage, encounterOf, KIND_NAME, kindsOf, loadModel, makeGrid, phraseAt } from './model';
import { draw, palette, ViewState } from './view';

/**
 * The level-design workbench: the stage seen from above, the beat scrubbed by hand,
 * the checks of the level session, and a link into the game at any spot.
 */
const stages = import.meta.glob<StageData>('../data/stages/*.json', { eager: true, import: 'default' });
const params = new URLSearchParams(location.search);
const stageId = params.get('stage') ?? 'stage-01';
const data = stages[`../data/stages/${stageId}.json`];
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function boot(): void {
  if (!data) {
    $('report').innerHTML = '';
    $('summary').textContent = `스테이지 "${stageId}" 가 없다. 있는 것: ${Object.keys(stages).map(k => k.replace(/^.*\/|\.json$/g, '')).join(', ')}`;
    return;
  }
  const m = loadModel(data), sim = m.sim, c = palette(m);
  document.title = `작업대 · ${data.name ?? data.id}`;
  $('stage-name').textContent = `${data.name ?? ''} (${data.id ?? stageId})`;
  $('stage-meta').textContent = `${sim.meter.bpm} BPM · ${sim.meter.beatsPerBar}/4 · 목숨 ${sim.maxLives} · 1U = ${Math.round(m.u)}px`;
  document.documentElement.style.setProperty('--bg', c.bg);
  document.documentElement.style.setProperty('--ink', c.ink);

  const canvas = $<HTMLCanvasElement>('map');
  const ctx = canvas.getContext('2d')!;
  const bar = sim.meter.stepsPerBar;
  const boss = data.encounters?.find(e => e.kind === 'boss');
  const total = Math.max(16 * bar, (boss?.phrases ?? []).reduce((n, p) => n + p.bars * bar, 0));
  const v: ViewState = { cx: 0, cy: 0, scale: 0.1, step: 0, gatesOpen: false, reach: null, highlight: [], selected: null };
  const fit = (): void => { v.cx = 0; v.cy = 0; v.scale = Math.min(canvas.clientWidth, canvas.clientHeight) / (2 * 32 * m.u); };

  /* ---------- report ---------- */
  const findings = check(m);
  const okCount = findings.filter(f => f.ok).length;
  $('summary').textContent = `${findings.length}개 중 ${okCount}개 통과`;
  $('summary').className = okCount === findings.length ? 'good' : 'bad';
  const list = $('report');
  findings.forEach((f: Finding) => {
    const li = document.createElement('li');
    li.className = f.ok ? 'ok' : 'fail';
    li.innerHTML = `<button type="button"><span class="mark">${f.ok ? '통과' : '문제'}</span><b></b></button><ul></ul>`;
    li.querySelector('b')!.textContent = f.title;
    const ul = li.querySelector('ul')!;
    for (const line of f.lines) { const x = document.createElement('li'); x.textContent = line; ul.appendChild(x); }
    li.querySelector('button')!.addEventListener('click', () => {
      v.highlight = f.where;
      if (f.where.length) { v.cx = f.where[0].x; v.cy = f.where[0].y; v.scale = Math.max(v.scale, 0.16); }
      list.querySelectorAll('li.sel').forEach(n => n.classList.remove('sel'));
      li.classList.add('sel');
    });
    list.appendChild(li);
  });
  $('json').textContent = JSON.stringify(findings.map(f => ({ id: f.id, title: f.title, ok: f.ok, lines: f.lines })), null, 2);

  /* ---------- appearance table ---------- */
  const tbody = $('appear');
  for (const r of appearanceTable(m)) {
    const tr = document.createElement('tr');
    const devices = r.emitters.map(e => `${e.label} 혼자 ${e.alonePct}%`).join('\n');
    for (const cell of [KIND_NAME[r.kind], devices, r.guardians.join(', ') || '없음', r.boss.join(', ')]) {
      const td = document.createElement('td'); td.textContent = cell; tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  /* ---------- what is under the pointer ---------- */
  const toWorld = (sx: number, sy: number): { x: number; y: number } => ({ x: v.cx + (sx - canvas.clientWidth / 2) / v.scale, y: v.cy + (sy - canvas.clientHeight / 2) / v.scale });
  const pick = (wx: number, wy: number): { x: number; y: number; id: string | null; label: string; lines: string[] } | null => {
    const things = [
      ...sim.emitters.filter(e => !e.hidden).map(e => {
        const enc = encounterOf(m, e.id);
        const lines = [`공격: ${[...kindsOf(m, e.id)].map(k => KIND_NAME[k]).join(', ')}`];
        if (enc) lines.push(`패턴: ${enc.phrases.map(p => p.id).join(' → ')}`, `지금: ${phraseAt(m, enc, v.step).phrase.id}`);
        else if (e.pattern.events.length) lines.push(`한 바퀴 ${e.pattern.length + (e.pattern.rest ?? 0)}스텝, 시작 ${e.pattern.phase ?? 0}스텝 늦게`);
        if (e.range !== undefined) lines.push(`플레이어가 ${e.range}U 안에 있을 때만 공격`);
        return { x: e.x, y: e.y, id: e.id, label: m.label(e.id), lines };
      }),
      ...sim.parts.map(p => ({ x: p.x, y: p.y, id: null, label: `${p.layer} 악기`, lines: [`지키는 수호자: ${p.guard}`] })),
      ...sim.plates.map(p => ({ x: p.x, y: p.y, id: null, label: `공명판 ${p.id}`, lines: [p.encounter ? '보스전의 공명판' : '그 악기를 든 채 서 있으면 켜진다'] })),
      ...sim.checkpoints.map((cp, i) => ({ x: cp.x, y: cp.y, id: null, label: `체크포인트 ${i + 1}`, lines: [] as string[] })),
    ];
    let best: (typeof things)[number] | null = null, bd = 14 / v.scale;
    for (const t of things) { const dd = Math.hypot(t.x - wx, t.y - wy); if (dd < bd) { bd = dd; best = t; } }
    return best;
  };
  const showInfo = (wx: number, wy: number): void => {
    const t = pick(wx, wy), box = $('info');
    box.innerHTML = '<b></b><ul></ul><a id="play-here" target="_blank" rel="noopener">이 자리에서 게임 열기</a>';
    box.querySelector('b')!.textContent = t ? t.label : `빈 자리 (${(wx / m.u).toFixed(1)}, ${(wy / m.u).toFixed(1)}) U`;
    const ul = box.querySelector('ul')!;
    for (const line of t?.lines ?? []) { const li = document.createElement('li'); li.textContent = line; ul.appendChild(li); }
    const at = t ? { x: t.x, y: t.y + 1.5 * m.u } : { x: wx, y: wy };
    (box.querySelector('#play-here') as HTMLAnchorElement).href = `./index.html?stage=${stageId}&at=${(at.x / m.u).toFixed(1)},${(at.y / m.u).toFixed(1)}`;
    v.selected = t?.id ?? null;
  };

  /* ---------- controls ---------- */
  let playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  let t0 = performance.now();
  const stepsPerSec = (sim.meter.bpm / 60) * sim.meter.stepsPerBeat;
  const slider = $<HTMLInputElement>('step');
  slider.max = String(total - 1);
  const playBtn = $<HTMLButtonElement>('play');
  const setPlay = (on: boolean): void => {
    playing = on;
    playBtn.textContent = on ? '멈춤' : '재생';
    playBtn.setAttribute('aria-pressed', String(on));
    if (on) t0 = performance.now() - (v.step / stepsPerSec) * 1000;
  };
  playBtn.addEventListener('click', () => setPlay(!playing));
  slider.addEventListener('input', () => { setPlay(false); v.step = Number(slider.value); });
  $('gates').addEventListener('change', e => { v.gatesOpen = (e.target as HTMLInputElement).checked; });
  let reachGrid: ViewState['reach'] = null;
  $('reach').addEventListener('change', e => {
    if ((e.target as HTMLInputElement).checked) {
      if (!reachGrid) { const g = makeGrid(m, 0.5); const cv = coverage(m, g); reachGrid = { grid: g, road: cv.road, enc: cv.enc }; }
      v.reach = reachGrid;
    } else v.reach = null;
  });
  $('fit').addEventListener('click', () => { fit(); v.highlight = []; });
  $('show-json').addEventListener('click', () => { const p = $('json'); p.hidden = !p.hidden; });
  $<HTMLAnchorElement>('open-game').href = `./index.html?stage=${stageId}`;

  let drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, cx: v.cx, cy: v.cy, moved: false }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    v.cx = drag.cx - dx / v.scale; v.cy = drag.cy - dy / v.scale;
  });
  canvas.addEventListener('pointerup', e => {
    if (drag && !drag.moved) { const r = canvas.getBoundingClientRect(), w = toWorld(e.clientX - r.left, e.clientY - r.top); showInfo(w.x, w.y); }
    drag = null;
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, w = toWorld(sx, sy);
    v.scale = Math.min(1.2, Math.max(0.03, v.scale * Math.exp(-e.deltaY * 0.0015)));
    v.cx = w.x - (sx - r.width / 2) / v.scale; v.cy = w.y - (sy - r.height / 2) / v.scale;
  }, { passive: false });
  $('zoom-in').addEventListener('click', () => { v.scale = Math.min(1.2, v.scale * 1.4); });
  $('zoom-out').addEventListener('click', () => { v.scale = Math.max(0.03, v.scale / 1.4); });

  /* ---------- frame ---------- */
  let lastW = 0, lastH = 0;
  const frame = (): void => {
    const dpr = Math.min(2, devicePixelRatio || 1), w = canvas.clientWidth, h = canvas.clientHeight;
    if (w !== lastW || h !== lastH) {
      const first = lastW === 0;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); lastW = w; lastH = h;
      if (first) fit();
    }
    if (playing) v.step = (((performance.now() - t0) / 1000) * stepsPerSec) % total;
    slider.value = String(Math.floor(v.step));
    $('clock').textContent = `${Math.floor(v.step / bar) + 1}마디 ${Math.floor((v.step % bar) / sim.meter.stepsPerBeat) + 1}박 · 스텝 ${Math.floor(v.step % bar) + 1}`;
    $('boss-now').textContent = boss ? `보스: ${phraseAt(m, boss, v.step).phrase.id}` : '';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, w, h, m, v);
    requestAnimationFrame(frame);
  };
  setPlay(playing);
  requestAnimationFrame(frame);
}

boot();
