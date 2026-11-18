import { renderScene, ScorePlayer } from '../audio/scorePlayer';
import {
  EqBand, filled, harmony, instrumentOf, Instrument, Layer, notesOf, ParamSpec, Part, RULE_NOTES, RULE_PARAMS, SCALES, sceneSteps, Score,
  scoreFromText, scoreToText, SCORE_LAYERS, stepsPerBar, SYNTH_PARAMS, Track, voicesOf,
} from '../core/music/score';
import { demoScore } from '../core/music/scoreLibrary';

/**
 * The studio: write a stage's music and mix it by ear.
 * Every control changes the score, and the player uses the changed score at once.
 * The work is kept in the browser and can be saved to a file, which is what goes into the repository.
 */

const STORE = 'rm.studio.score';
const LAYER_NAMES: Record<Layer, string> = { drum: '드럼', hat: '하이햇', bass: '베이스', lead: '리드', pad: '패드' };
const LAYER_COLORS: Record<Layer, string> = { drum: '#5fa8b8', hat: '#9fcabf', bass: '#7d8fd0', lead: '#e8584a', pad: '#c9506b' };
const VOICE_NAMES: Record<string, string> = { kick: '킥', snare: '스네어', hat: '하이햇', note: '음' };

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

let kept: Score = demoScore();           // the version to compare against
let score: Score = clone(kept);          // what is being edited
try { const saved = scoreFromText(localStorage.getItem(STORE) ?? ''); if (saved) score = saved; } catch { /* no storage: start from the built-in score */ }
let view = Object.keys(score.scenes)[0]; // the scene shown and edited
let sel: Layer = 'bass';
let selVoice = 'note';
let tab = '음색';
let compare = false;
let playing = false;
const muted: Partial<Record<Layer, boolean>> = {};
let solo: Layer | null = null;
let ctx: AudioContext | null = null;
let player: ScorePlayer | null = null;
let storeTimer = 0;

const heard = (): Score => (compare ? kept : score);

// ---------------------------------------------------------------- small DOM helpers

type Child = Node | string | null | undefined | false;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  const { class: cls, ...rest } = props as { class?: string };
  if (cls) e.className = cls;
  Object.assign(e, rest);
  for (const k of kids) if (k) e.append(k);
  return e;
}
const fmt = (v: number): string => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

function slider(label: string, spec: Pick<ParamSpec, 'lo' | 'hi' | 'scale'>, value: number, onInput: (v: number) => void): HTMLElement {
  const log = spec.scale === 'log';
  const input = el('input', { type: 'range' });
  if (log) { input.min = '0'; input.max = '1'; input.step = '0.001'; input.value = String(Math.log(Math.min(Math.max(value, spec.lo), spec.hi) / spec.lo) / Math.log(spec.hi / spec.lo)); }
  else { input.min = String(spec.lo); input.max = String(spec.hi); input.step = spec.scale === 'int' ? '1' : String((spec.hi - spec.lo) / 400); input.value = String(value); }
  const shown = el('span', { class: 'num' }, fmt(value));
  input.addEventListener('input', () => {
    const v = log ? spec.lo * Math.pow(spec.hi / spec.lo, Number(input.value)) : Number(input.value);
    shown.textContent = fmt(v);
    onInput(v);
  });
  return el('label', { class: 'row' }, el('span', { class: 'name' }, label), input, shown);
}

function select(items: string[], current: string, onPick: (v: string) => void, names?: Record<string, string>): HTMLSelectElement {
  const s = el('select');
  for (const it of items) s.append(el('option', { value: it, selected: it === current }, names?.[it] ?? it));
  s.addEventListener('change', () => onPick(s.value));
  return s;
}

function button(text: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = el('button', { class: cls }, text);
  b.addEventListener('click', onClick);
  return b;
}

const note = (text: string): HTMLElement => el('p', { class: 'note' }, text);

// ---------------------------------------------------------------- the score being edited

const scene = () => score.scenes[view];
function track(layer: Layer): Track {
  const t = scene().tracks;
  if (!t[layer]) t[layer] = { part: 'rest', inst: layer === 'drum' ? { kick: 'kick', snare: 'snare' } : '' };
  return t[layer]!;
}
const instName = (): string => instrumentOf(score, track(sel), selVoice);
const inst = (): Instrument | undefined => score.instruments[instName()];

/** Where an instrument or a part is used, so a change is not a surprise somewhere else. */
function usedIn(kind: 'part' | 'inst', item: string): string {
  const where: string[] = [];
  for (const s in score.scenes) for (const l of SCORE_LAYERS) {
    const t = score.scenes[s].tracks[l];
    if (!t) continue;
    const hit = kind === 'part' ? t.part === item : typeof t.inst === 'string' ? t.inst === item : Object.values(t.inst).includes(item);
    if (hit) where.push(`${s} / ${LAYER_NAMES[l]}`);
  }
  return where.join(', ') || '없음';
}

function freshName(taken: Record<string, unknown>, given: string, base: string): string {
  if (given && !(given in taken)) return given;
  let n = 2;
  while (`${base} ${n}` in taken) n++;
  return `${base} ${n}`;
}

/** After any change: the player takes the score as it is now, and the work is kept. */
function changed(): void {
  player?.setScore(heard());
  applyGains();
  clearTimeout(storeTimer);
  storeTimer = window.setTimeout(() => { try { localStorage.setItem(STORE, scoreToText(score)); } catch { /* ignore */ } }, 600);
}

function applyGains(): void {
  if (!player) return;
  for (const l of SCORE_LAYERS) player.setLayerGain(l, !muted[l] && (solo === null || solo === l) ? 1 : 0);
}

// ---------------------------------------------------------------- playing

async function togglePlay(): Promise<void> {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' });
    await ctx.resume();
    player = new ScorePlayer(ctx, heard(), view);
    player.onScene = () => renderTop();
    applyGains();
    player.start();
    playing = true;
  } else if (playing) { await ctx.suspend(); playing = false; }
  else { await ctx.resume(); playing = true; }
  renderTop();
}

function pickScene(id: string, now: boolean): void {
  view = id;
  player?.setScene(id, now || !playing ? 'now' : 'bar');
  render();
}

// ---------------------------------------------------------------- top bar

const top = document.getElementById('top')!;
const tracksBox = document.getElementById('tracks')!;
const tabsBox = document.getElementById('tabs')!;
const pageBox = document.getElementById('page')!;
const canvas = document.getElementById('notes') as HTMLCanvasElement;
const meterEls = {} as Record<Layer | 'master', HTMLElement>;

function renderTop(): void {
  top.replaceChildren();
  top.append(button(playing ? '정지' : '재생', () => void togglePlay(), 'primary'));
  const scenes = el('div', { class: 'scenes' }, el('span', { class: 'dim' }, '장면'));
  const queued = player?.queued();
  for (const id of Object.keys(score.scenes)) {
    const s = score.scenes[id];
    const b = el('button', { class: 'scene' }, id + (s.once ? ' →' : ''));
    if (id === view) b.classList.add('view');
    if (player && playing && player.scene === id) b.classList.add('live');
    if (queued === id) b.classList.add('queued');
    b.onclick = e => pickScene(id, e.shiftKey);
    scenes.append(b);
  }
  top.append(scenes);
  if (player && playing && player.scene !== view) top.append(el('span', { class: 'dim' }, `듣는 장면: ${player.scene} · 고치는 장면: ${view}`));
  const cmp = el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: compare }), '기준 듣기');
  cmp.querySelector('input')!.addEventListener('change', e => { compare = (e.target as HTMLInputElement).checked; player?.setScore(heard()); applyGains(); drawNotes(); });
  top.append(cmp, button('지금 것을 기준으로', () => { kept = clone(score); changed(); }), button('기준으로 되돌리기', () => {
    score = clone(kept);
    if (!score.scenes[view]) view = Object.keys(score.scenes)[0];
    changed();
    render();
  }));
  const master = el('div', { class: 'meter master' }, el('i'));
  meterEls.master = master;
  top.append(el('span', { class: 'dim' }, '전체'), master, el('span', { class: 'num', id: 'masterNum' }));
}

// ---------------------------------------------------------------- layers

function renderTracks(): void {
  tracksBox.replaceChildren();
  const parts = Object.keys(score.parts).sort();
  const insts = Object.keys(score.instruments).sort();
  for (const layer of SCORE_LAYERS) {
    const t = track(layer);
    const pick = button(LAYER_NAMES[layer], () => { sel = layer; selVoice = voicesOf(layer)[0]; render(); }, 'layer' + (layer === sel ? ' on' : ''));
    pick.style.color = LAYER_COLORS[layer];
    const on = el('input', { type: 'checkbox', checked: !muted[layer] });
    on.addEventListener('change', () => { muted[layer] = !on.checked; applyGains(); drawNotes(); });
    const only = el('input', { type: 'checkbox', checked: solo === layer });
    only.addEventListener('change', () => { solo = only.checked ? layer : null; applyGains(); renderTracks(); drawNotes(); });
    const head = el('div', { class: 'head' }, pick, el('label', { class: 'check' }, on, '켜기'), el('label', { class: 'check' }, only, '솔로'),
      select(parts, t.part, v => { t.part = v; changed(); render(); }));
    for (const voice of voicesOf(layer)) {
      head.append(select(insts, instrumentOf(score, t, voice), v => {
        if (layer === 'drum') { if (typeof t.inst === 'string') t.inst = {}; (t.inst as Record<string, string>)[voice] = v; } else t.inst = v;
        changed(); render();
      }));
    }
    const meter = el('div', { class: 'meter' }, el('i'));
    meterEls[layer] = meter;
    tracksBox.append(el('div', { class: 'track' }, head,
      el('div', { class: 'fader' }, slider('페이더 (dB)', { lo: -24, hi: 12, scale: 'lin' }, t.gain_db ?? 0, v => { t.gain_db = Math.round(v * 10) / 10; changed(); }), meter)));
  }
}

// ---------------------------------------------------------------- right side

function voiceRow(): HTMLElement | null {
  if (sel !== 'drum') return null;
  return el('div', { class: 'btns' }, ...['kick', 'snare'].map(v => button(VOICE_NAMES[v], () => { selVoice = v; renderPage(); }, v === selVoice ? 'on' : '')));
}

function copyRow(what: string, make: (name: string) => void): HTMLElement {
  const field = el('input', { type: 'text', placeholder: '사본의 이름' });
  return el('div', { class: 'btns' }, field, button(`새 ${what}(으)로 복사`, () => make(field.value.trim())));
}

function pageSound(): Child[] {
  const i = inst();
  if (!i) return [voiceRow(), note('이 장면에서 이 겹에 악기가 없다.')];
  const name = instName();
  const full = filled(SYNTH_PARAMS[i.synth], i.p);
  return [
    voiceRow(), el('h3', {}, name), note('쓰는 곳: ' + usedIn('inst', name)),
    copyRow('악기', given => {
      const fresh = freshName(score.instruments, given, name);
      score.instruments[fresh] = clone(i);
      const t = track(sel);
      if (sel === 'drum') (t.inst as Record<string, string>)[selVoice] = fresh; else t.inst = fresh;
      changed(); render();
    }),
    ...SYNTH_PARAMS[i.synth].map(spec => slider(spec.label, spec, full[spec.key], v => { i.p[spec.key] = v; changed(); })),
  ];
}

function pageMix(): Child[] {
  const i = inst();
  if (!i) return [voiceRow(), note('이 장면에서 이 겹에 악기가 없다.')];
  const m = i.mix;
  const bands: Child[] = m.eq.map((b: EqBand, n: number) => el('div', { class: 'band' },
    el('div', { class: 'btns' },
      select(['hp', 'lp', 'peak', 'loshelf', 'hishelf'], b.type, v => { b.type = v as EqBand['type']; changed(); }, { hp: '아래 자르기', lp: '위 자르기', peak: '봉우리', loshelf: '아래 선반', hishelf: '위 선반' }),
      button('빼기', () => { m.eq.splice(n, 1); changed(); renderPage(); })),
    slider('주파수 (Hz)', { lo: 20, hi: 16000, scale: 'log' }, b.hz, v => { b.hz = v; changed(); }),
    slider('폭 (Q)', { lo: 0.3, hi: 6, scale: 'log' }, b.q, v => { b.q = v; changed(); }),
    slider('올림/내림 (dB)', { lo: -15, hi: 15, scale: 'lin' }, b.gain, v => { b.gain = v; changed(); })));
  return [
    voiceRow(), el('h3', {}, instName() + ' 믹싱'), note('쓰는 곳: ' + usedIn('inst', instName())),
    slider('음량 (dB)', { lo: -36, hi: 12, scale: 'lin' }, m.gain_db, v => { m.gain_db = v; changed(); }),
    slider('잔향', { lo: 0, hi: 0.8, scale: 'lin' }, m.room, v => { m.room = v; changed(); }),
    slider('킥에 눌리는 양', { lo: 0, hi: 0.9, scale: 'lin' }, m.duck, v => { m.duck = v; changed(); }),
    slider('눌렸다 돌아오는 시간 (초)', { lo: 0.04, hi: 0.6, scale: 'log' }, m.duck_release, v => { m.duck_release = v; changed(); }),
    el('h3', {}, 'EQ'), ...bands,
    button('대역 더하기', () => { m.eq.push({ type: 'peak', hz: 1000, q: 1, gain: 0 }); changed(); renderPage(); }),
  ];
}

function pagePart(): Child[] {
  const name = track(sel).part;
  const part: Part | undefined = score.parts[name];
  if (!part) return [note('이 장면에서 이 겹에 악보가 없다.')];
  const full = filled(RULE_PARAMS[part.rule] ?? [], part.p);
  const roll = el('input', { type: 'number', min: '0', max: '999', value: String(part.roll ?? 0) });
  roll.addEventListener('input', () => { part.roll = Math.max(0, Math.floor(Number(roll.value) || 0)); changed(); drawNotes(); });
  return [
    el('h3', {}, name), note('쓰는 곳: ' + usedIn('part', name)),
    copyRow('악보', given => {
      const fresh = freshName(score.parts, given, name);
      score.parts[fresh] = clone(part);
      track(sel).part = fresh;
      changed(); render();
    }),
    el('div', { class: 'btns' }, el('span', { class: 'name' }, '규칙'),
      select(Object.keys(RULE_PARAMS), part.rule, v => { part.rule = v; part.p = {}; changed(); render(); })),
    note(RULE_NOTES[part.rule] ?? ''),
    el('div', { class: 'btns' }, el('span', { class: 'name' }, '다시 뽑기'), roll, button('다음', () => { part.roll = (part.roll ?? 0) + 1; changed(); render(); })),
    note('씨앗에서 이 악보만 다시 뽑는다. 다른 악보의 음은 바뀌지 않는다.'),
    ...(RULE_PARAMS[part.rule] ?? []).map(spec => slider(spec.label, spec, full[spec.key], v => { part.p[spec.key] = v; changed(); drawNotes(); })),
  ];
}

function pageScene(): Child[] {
  const s = scene();
  const moving = (key: 'lp_to' | 'hp_to', label: string, lo: number, hi: number, start: number): Child[] => {
    const on = el('input', { type: 'checkbox', checked: s[key] !== undefined });
    on.addEventListener('change', () => { if (on.checked) s[key] = start; else delete s[key]; changed(); renderPage(); });
    return [el('label', { class: 'check' }, on, label + ' 움직이기'),
      s[key] !== undefined && slider(label + ' 끝 값 (Hz)', { lo, hi, scale: 'log' }, s[key]!, v => { s[key] = v; changed(); })];
  };
  const once = el('input', { type: 'checkbox', checked: !!s.once });
  once.addEventListener('change', () => { s.once = once.checked; if (!s.once) delete s.next; changed(); render(); });
  const names = Object.keys(score.scenes);
  return [
    el('h3', {}, '장면: ' + view),
    slider('길이 (마디)', { lo: 1, hi: 8, scale: 'int' }, s.bars, v => { s.bars = v; changed(); drawNotes(); }),
    slider('위 자르기 (Hz)', { lo: 200, hi: 20000, scale: 'log' }, s.lp ?? 20000, v => { s.lp = v; changed(); }),
    ...moving('lp_to', '위 자르기', 200, 20000, 20000),
    slider('아래 자르기 (Hz)', { lo: 20, hi: 2000, scale: 'log' }, s.hp ?? 20, v => { s.hp = v; changed(); }),
    ...moving('hp_to', '아래 자르기', 20, 2000, 20),
    note('장면의 모든 겹에 걸리는 필터다. 20000과 20이면 꺼진 것과 같다. 움직이기를 켜면 장면이 도는 동안 처음 값에서 끝 값으로 간다.'),
    el('label', { class: 'check' }, once, '한 번만 연주하고 넘어가기'),
    s.once && el('div', { class: 'btns' }, el('span', { class: 'name' }, '다음 장면'), select(names, s.next ?? names[0], v => { s.next = v; changed(); })),
    copyRow('장면', given => {
      const fresh = freshName(score.scenes, given, view);
      score.scenes[fresh] = clone(s);
      view = fresh;
      changed(); render();
    }),
    names.length > 1 && button('이 장면 지우기', () => {
      delete score.scenes[view];
      for (const st in score.states) if (score.states[st] === view) delete score.states[st];
      for (const id in score.scenes) if (score.scenes[id].next === view) delete score.scenes[id].next;
      view = Object.keys(score.scenes)[0];
      changed(); render();
    }),
    el('h3', {}, '게임 상태와 장면'),
    ...Object.keys(score.states).map(st => el('div', { class: 'btns' }, el('span', { class: 'name wide' }, st), select(names, score.states[st], v => { score.states[st] = v; changed(); }))),
    note('게임이 이 상태가 되면 짝지어진 장면을 다음 마디부터 연주한다.'),
  ];
}

function pageSong(): Child[] {
  const h = harmony(score);
  return [
    el('h3', {}, '곡'),
    slider('씨앗', { lo: 0, hi: 999, scale: 'int' }, score.seed, v => { score.seed = v; changed(); drawNotes(); }),
    slider('템포 (BPM)', { lo: 60, hi: 180, scale: 'int' }, score.bpm, v => { score.bpm = v; changed(); }),
    el('div', { class: 'btns' }, el('span', { class: 'name' }, '음계'), select(Object.keys(SCALES), score.key.scale, v => { score.key.scale = v; changed(); render(); })),
    slider('으뜸음 (-1이면 씨앗에서)', { lo: -1, hi: 57, scale: 'int' }, score.key.root, v => { score.key.root = v; changed(); drawNotes(); }),
    slider('화음이 되풀이되는 마디 수', { lo: 1, hi: 8, scale: 'int' }, score.key.bars, v => { score.key.bars = v; changed(); drawNotes(); }),
    note(`지금 으뜸음 ${h.root}, 마디마다의 화음(음계의 몇 번째 음인지) ${h.chords.join(', ')}`),
  ];
}

function pageFile(): Child[] {
  const text = el('textarea', { spellcheck: false });
  const file = el('input', { type: 'file', accept: '.json,application/json' });
  const load = (raw: string): void => {
    const read = scoreFromText(raw);
    if (!read) { alert('곡 파일이 아니다.'); return; }
    score = read;
    view = Object.keys(score.scenes)[0];
    changed(); render();
  };
  file.addEventListener('change', async () => { if (file.files?.[0]) load(await file.files[0].text()); });
  return [
    el('h3', {}, '파일'),
    el('div', { class: 'btns' },
      button('파일로 저장', () => {
        const a = el('a', { href: URL.createObjectURL(new Blob([scoreToText(score)], { type: 'application/json' })), download: `${score.id}.json` });
        a.click();
      }),
      button('글로 보기', () => { text.value = scoreToText(score); }),
      button('아래 글에서 불러오기', () => load(text.value)),
      button('기본 곡으로 처음부터', () => { score = demoScore(); kept = clone(score); view = Object.keys(score.scenes)[0]; changed(); render(); })),
    el('div', { class: 'btns' }, el('span', { class: 'name' }, '파일 불러오기'), file),
    note('고친 것은 이 브라우저에 저절로 남는다. 저장소에 넣으려면 파일로 저장해서(또는 글을 복사해서) 사운드 세션에 준다.'),
    text,
  ];
}

const PAGES: Record<string, () => Child[]> = { '음색': pageSound, '믹싱': pageMix, '악보': pagePart, '장면': pageScene, '곡': pageSong, '파일': pageFile };

function renderPage(): void {
  tabsBox.replaceChildren(...Object.keys(PAGES).map(t => button(t, () => { tab = t; renderPage(); }, t === tab ? 'on' : '')));
  pageBox.replaceChildren();
  for (const k of PAGES[tab]()) if (k) pageBox.append(k);
}

// ---------------------------------------------------------------- the notes

function drawNotes(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const s = heard();
  if (!s.scenes[view]) return;
  const total = sceneSteps(s, view), bar = stepsPerBar(s), lane = h / SCORE_LAYERS.length;
  for (let b = 0; b < total; b += s.meter.stepsPerBeat) {
    g.fillStyle = b % bar === 0 ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.05)';
    g.fillRect((w * b) / total, 0, 1, h);
  }
  SCORE_LAYERS.forEach((layer, i) => {
    const list = notesOf(s, view, layer);
    const lo = Math.min(...list.map(n => n.midi)), hi = Math.max(...list.map(n => n.midi));
    if (layer === sel) { g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(0, i * lane, w, lane); }
    const quiet = !!muted[layer] || (solo !== null && solo !== layer);
    g.fillStyle = LAYER_COLORS[layer];
    for (const n of list) {
      const y = hi > lo ? i * lane + lane * (0.85 - (0.7 * (n.midi - lo)) / (hi - lo)) : i * lane + lane * (n.voice === 'snare' ? 0.35 : 0.6);
      g.globalAlpha = quiet ? 0.25 : 0.4 + 0.6 * n.vel;
      g.fillRect((w * n.step) / total, y - 2, Math.max(2, (w * n.len) / total - 1), n.acc ? 6 : 4);
    }
    g.globalAlpha = 1;
  });
  if (player && player.scene === view) {
    const pos = player.position();
    g.fillStyle = '#f1e9d8';
    g.fillRect((w * pos.step) / pos.steps, 0, 1.5, h);
  }
}

function tick(): void {
  if (player && playing) {
    for (const id of [...SCORE_LAYERS, 'master'] as (Layer | 'master')[]) {
      const lv = player.level(id);
      const bar = meterEls[id]?.firstElementChild as HTMLElement | null;
      if (bar) { bar.style.width = `${Math.max(0, Math.min(100, ((lv.rmsDb + 60) / 60) * 100))}%`; bar.classList.toggle('hot', lv.peak > 0.98); }
      if (id === 'master') { const n = document.getElementById('masterNum'); if (n) n.textContent = `${lv.rmsDb.toFixed(0)} dB`; }
    }
  }
  drawNotes();
  requestAnimationFrame(tick);
}

function render(): void {
  renderTop();
  renderTracks();
  renderPage();
  drawNotes();
}

render();
requestAnimationFrame(tick);

/** Measure a scene without playing it: peak, loudness, and how the energy is spread over the spectrum. */
async function measure(sceneId: string, soloLayer?: Layer, laps = 2): Promise<{ peak: number; rmsDb: number; bands: Record<string, number> }> {
  const buf = await renderScene(score, sceneId, laps, soloLayer);
  const d = buf.getChannelData(0), r = buf.getChannelData(1);
  let peak = 0, sq = 0;
  for (let i = 0; i < d.length; i++) { const a = Math.max(Math.abs(d[i]), Math.abs(r[i])); if (a > peak) peak = a; sq += (d[i] * d[i] + r[i] * r[i]) / 2; }
  // Band energies with one-pole splits: rough, but enough to see where a layer sits.
  const edges = [120, 400, 1500, 5000];
  const names = ['~120', '120~400', '400~1.5k', '1.5k~5k', '5k~'];
  const state = edges.map(() => 0), energy = names.map(() => 0);
  for (let i = 0; i < d.length; i++) {
    let rest = d[i];
    edges.forEach((hz, k) => { const a = 1 - Math.exp((-2 * Math.PI * hz) / buf.sampleRate); state[k] += a * (d[i] - state[k]); });
    let below = 0;
    edges.forEach((_, k) => { const part = state[k] - below; energy[k] += part * part; below = state[k]; });
    rest = d[i] - below;
    energy[4] += rest * rest;
  }
  const sum = energy.reduce((a, b) => a + b, 0) || 1;
  const bands: Record<string, number> = {};
  names.forEach((n, k) => { bands[n] = Math.round((energy[k] / sum) * 100); });
  return { peak: Math.round(peak * 1000) / 1000, rmsDb: Math.round(10 * Math.log10(sq / d.length + 1e-12) * 10) / 10, bands };
}

// For automated checks and for measuring from the console.
(window as unknown as Record<string, unknown>).__studio = {
  get score() { return score; }, set score(s: Score) { score = s; changed(); render(); },
  get player() { return player; }, get playing() { return playing; }, get view() { return view; },
  measure, togglePlay, pickScene,
};
