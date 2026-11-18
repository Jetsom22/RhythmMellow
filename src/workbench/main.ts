import stage01 from '../../data/stages/stage-01.json?raw';
import { appearanceTable, check, Finding } from './checker';
import { colors, draw, ViewState } from './view';
import { emitterPatterns, KIND_NAME, loadStage, Pt, Stage } from './stage';
import { playingAt } from './timeline';

const STAGES: Record<string, string> = { 'stage-01': stage01 };

const params = new URLSearchParams(location.search);
const stageId = params.get('stage') ?? 'stage-01';
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function boot(): void {
  let st: Stage;
  try {
    const raw = STAGES[stageId];
    if (!raw) throw new Error(`스테이지 "${stageId}" 가 없다. 있는 것: ${Object.keys(STAGES).join(', ')}`);
    st = loadStage(raw);
  } catch (err) {
    $('report').innerHTML = `<p class="bad">데이터를 읽지 못했다: ${(err as Error).message}</p>`;
    return;
  }
  const d = st.data, c = colors(st);
  document.title = `작업대 · ${d.title}`;
  $('stage-name').textContent = `${d.title} (${d.id})`;
  $('stage-meta').textContent = `${d.bpm} BPM · ${d.meter.beatsPerBar}/4 · 목숨 ${d.lives} · 1U = ${st.u}px`;

  const canvas = $<HTMLCanvasElement>('map');
  const ctx = canvas.getContext('2d')!;
  const total = 16 * st.stepsPerBar;   // the boss plays 16 bars before it repeats
  const v: ViewState = { cx: 0, cy: 0, scale: 0.1, step: 0, showAreas: false, showRoutes: false, padsLit: 0, highlight: [], selected: null };

  const fit = (): void => {
    const r = 34 * st.u;
    v.cx = 0; v.cy = 0; v.scale = Math.min(canvas.clientWidth, canvas.clientHeight) / (2 * r);
  };

  /* ---------- report ---------- */
  const findings = check(st);
  const okCount = findings.filter(f => f.ok).length;
  $('summary').textContent = `${findings.length}개 중 ${okCount}개 통과`;
  $('summary').className = okCount === findings.length ? 'good' : 'bad';
  const list = $('report');
  list.innerHTML = '';
  findings.forEach((f: Finding) => {
    const li = document.createElement('li');
    li.className = f.ok ? 'ok' : 'fail';
    li.innerHTML = `<button type="button"><span class="mark">${f.ok ? '통과' : '문제'}</span><b></b></button><ul></ul>`;
    li.querySelector('b')!.textContent = f.title;
    const ul = li.querySelector('ul')!;
    for (const line of f.lines) { const x = document.createElement('li'); x.textContent = line; ul.appendChild(x); }
    li.querySelector('button')!.addEventListener('click', () => {
      v.highlight = f.where;
      if (f.where.length) { v.cx = f.where[0].x; v.cy = f.where[0].y; v.scale = Math.max(v.scale, 0.18); }
      list.querySelectorAll('li.sel').forEach(n => n.classList.remove('sel'));
      li.classList.add('sel');
    });
    list.appendChild(li);
  });
  $('json').textContent = JSON.stringify(findings.map(f => ({ id: f.id, title: f.title, ok: f.ok, lines: f.lines })), null, 2);

  /* ---------- appearance table ---------- */
  const tbody = $('appear');
  for (const r of appearanceTable(st)) {
    const tr = document.createElement('tr');
    for (const cell of [KIND_NAME[r.kind], r.first.join(', ') || '없음', r.again.join(', ') || '없음', r.guardians.join(', ') || '없음', r.boss.join(', ')]) {
      const td = document.createElement('td'); td.textContent = cell; tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  /* ---------- details of what is under the pointer ---------- */
  const near = (sx: number, sy: number): { label: string; lines: string[]; id: string | null } | null => {
    const wx = v.cx + (sx - canvas.clientWidth / 2) / v.scale, wy = v.cy + (sy - canvas.clientHeight / 2) / v.scale;
    const things: { at: Pt; label: string; lines: string[]; id: string | null }[] = [
      ...d.emitters.map(e => {
        const pats = emitterPatterns(st, e);
        const { pat } = playingAt(st, e, v.step);
        return {
          at: st.pos(e.at), id: e.id, label: e.name,
          lines: [
            `구역: ${d.areas.find(a => a.id === e.area)?.name ?? e.area}`,
            `패턴: ${pats.map(p => p.name).join(' → ')}`,
            ...(pats.length > 1 ? [`지금: ${pat.name}`] : []),
            ...(pat.source ? [`보스 패턴 ${pat.source} 의 일부를 크기와 박 그대로`] : []),
            `시작 스텝: ${e.startStep ?? 0}`,
            ...(e.pass ? [`통과: ${e.pass.map(p => (p === 'dodge' ? '회피 통과' : '쓰러뜨리기')).join(', ')}`] : []),
          ],
        };
      }),
      ...d.parts.map(p => ({ at: st.pos(p.at), id: null, label: `악기: ${p.instrument}`, lines: [`지키는 수호자: ${p.guard}`] })),
      ...d.pads.map(p => ({ at: st.pos(p.at), id: null, label: `공명판: ${p.instrument}`, lines: ['그 악기를 든 채 한 마디 서 있으면 켜진다'] })),
      ...d.checkpoints.map(cp => ({ at: st.pos(cp.at), id: null, label: '체크포인트', lines: [cp.id] })),
    ];
    let best: (typeof things)[number] | null = null, bd = 14 / v.scale;
    for (const t of things) { const dd = Math.hypot(t.at.x - wx, t.at.y - wy); if (dd < bd) { bd = dd; best = t; } }
    return best;
  };
  const showInfo = (t: ReturnType<typeof near>): void => {
    const box = $('info');
    if (!t) { box.innerHTML = '<p class="muted">지도에서 장치, 몬스터, 수호자, 악기를 누르면 여기에 나온다.</p>'; return; }
    box.innerHTML = '<b></b><ul></ul>';
    box.querySelector('b')!.textContent = t.label;
    const ul = box.querySelector('ul')!;
    for (const line of t.lines) { const li = document.createElement('li'); li.textContent = line; ul.appendChild(li); }
  };
  showInfo(null);

  /* ---------- controls ---------- */
  let playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  let t0 = performance.now();
  const stepsPerSec = (d.bpm / 60) * d.meter.stepsPerBeat;
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
  $('areas').addEventListener('change', e => { v.showAreas = (e.target as HTMLInputElement).checked; });
  $('routes').addEventListener('change', e => { v.showRoutes = (e.target as HTMLInputElement).checked; });
  $('pads').addEventListener('change', e => { v.padsLit = (e.target as HTMLInputElement).checked ? 3 : 0; });
  $('fit').addEventListener('click', () => { fit(); v.highlight = []; });
  $('show-json').addEventListener('click', () => { const p = $('json'); p.hidden = !p.hidden; });

  // pan and zoom
  let drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, cx: v.cx, cy: v.cy, moved: false }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    v.cx = drag.cx - dx / v.scale; v.cy = drag.cy - dy / v.scale;
  });
  canvas.addEventListener('pointerup', e => {
    if (drag && !drag.moved) {
      const r = canvas.getBoundingClientRect(), t = near(e.clientX - r.left, e.clientY - r.top);
      v.selected = t?.id ?? null;
      showInfo(t);
    }
    drag = null;
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    const wx = v.cx + (sx - r.width / 2) / v.scale, wy = v.cy + (sy - r.height / 2) / v.scale;
    v.scale = Math.min(1.2, Math.max(0.03, v.scale * Math.exp(-e.deltaY * 0.0015)));
    v.cx = wx - (sx - r.width / 2) / v.scale; v.cy = wy - (sy - r.height / 2) / v.scale;
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
    const bar = Math.floor(v.step / st.stepsPerBar), beat = Math.floor((v.step % st.stepsPerBar) / d.meter.stepsPerBeat);
    $('clock').textContent = `${bar + 1}마디 ${beat + 1}박 · 스텝 ${Math.floor(v.step % st.stepsPerBar) + 1}`;
    const boss = d.emitters.find(e => e.kind === 'boss');
    $('boss-now').textContent = boss ? `보스: ${playingAt(st, boss, v.step).pat.name}` : '';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, w, h, st, v);
    requestAnimationFrame(frame);
  };
  setPlay(playing);
  document.documentElement.style.setProperty('--bg', c.bg);
  document.documentElement.style.setProperty('--ink', c.ink);
  requestAnimationFrame(frame);
}

boot();
