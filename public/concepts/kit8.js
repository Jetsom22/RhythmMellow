/* 시안 8 공용 도구: 색, 시간, 박자표, 소리, 모양, 예고, 플레이어. beat.html 과 map.html 이 함께 쓴다. */
const K = (() => {
  const TAU = Math.PI * 2, BPM = 110, SPB = 60 / BPM;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const easeOut = t => 1 - (1 - t) ** 3;
  const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ── 색: body 의 CSS 변수에서 읽는다 ── */
  const col = {};
  const readColors = () => { const cs = getComputedStyle(document.body); for (const k of ['bg', 'ink', 'd', 'e1', 'e2', 'e3', 'p1', 'p2', 'p3', 'j']) col[k] = cs.getPropertyValue('--' + k).trim(); };
  const alpha = (hex, a) => hex + Math.round(clamp(a) * 255).toString(16).padStart(2, '0');

  /* ── 박자표: 마디 안의 스텝 수, 스텝 하나의 길이(박), 회피 자리, 센 박 ── */
  const METERS = {
    '44': { label: '4/4 킥·스네어', steps: 16, dur: .25, dodge: [0, 4, 8, 12], beats: [0, 4, 8, 12], snare: [4, 12] },
    '34': { label: '3/4', steps: 12, dur: .25, dodge: [0, 4, 8], beats: [0, 4, 8], snare: [4, 8] },
    '78': { label: '7/8 (2+2+3)', steps: 7, dur: .5, dodge: [0, 2, 4], beats: [0, 2, 4], snare: [2, 4] },
    swing: { label: '스윙', steps: 12, dur: 1 / 3, dodge: [0, 3, 5, 6, 9, 11], beats: [0, 3, 6, 9], snare: [3, 9] },
    jersey: { label: '저지 클럽', steps: 16, dur: .25, dodge: [0, 3, 6, 10, 12, 14], beats: [0, 4, 8, 12], snare: [4, 12] },
    break: { label: '브레이크비트', steps: 16, dur: .25, dodge: [0, 2, 4, 7, 10, 12], beats: [0, 4, 8, 12], snare: [4, 7, 12] },
  };
  const barLen = m => m.steps * m.dur;               // 마디의 길이(박)
  /* 박 b 에서 본 회피 자리들: 직전과 다음, 그리고 거기까지의 거리 */
  function around(m, b, list = m.dodge) {
    const L = barLen(m), bar = Math.floor(b / L), out = [];
    for (const k of [bar - 1, bar, bar + 1]) for (const s of list) out.push(k * L + s * m.dur);
    let prev = -1e9, next = 1e9;
    for (const t of out) { if (t <= b && t > prev) prev = t; if (t > b && t < next) next = t; }
    return { prev, next };
  }
  /* 박 a 와 b 사이(a<t≤b)에 있는 자리들 */
  function crossed(m, a, b, list = m.dodge) {
    const L = barLen(m), out = [];
    for (let bar = Math.floor(a / L) - 1; bar <= Math.floor(b / L) + 1; bar++)
      for (const s of list) { const t = bar * L + s * m.dur; if (t > a && t <= b) out.push({ t, s, bar }); }
    return out.sort((x, y) => x.t - y.t);
  }

  /* ── 시간: 속도를 바꿀 수 있는 시계 ── */
  const clock = { speed: 1, beat: 0, last: null, t: 0 };
  function tick(now) {
    if (clock.last == null) clock.last = now;
    const dt = Math.min(.1, (now - clock.last) / 1000); clock.last = now;
    clock.t += dt * clock.speed; clock.beat = clock.t / SPB;
    return dt * clock.speed;
  }

  /* ── 소리: 회피 자리는 킥과 스네어, 그 밖의 8분음은 아주 작은 하이햇 ── */
  const audio = { on: false, ctx: null, next: 0 };
  function sfx(type, when) {
    const c = audio.ctx, o = c.createOscillator(), g = c.createGain();
    if (type === 'kick') { o.frequency.setValueAtTime(140, when); o.frequency.exponentialRampToValueAtTime(42, when + .12); g.gain.setValueAtTime(.55, when); g.gain.exponentialRampToValueAtTime(.001, when + .22); o.connect(g); }
    else {
      const n = c.createBufferSource(), buf = c.createBuffer(1, c.sampleRate * .2, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      n.buffer = buf; const f = c.createBiquadFilter(); f.type = type === 'hat' ? 'highpass' : 'bandpass'; f.frequency.value = type === 'hat' ? 7000 : 1800;
      g.gain.setValueAtTime(type === 'hat' ? .05 : .28, when); g.gain.exponentialRampToValueAtTime(.001, when + (type === 'hat' ? .04 : .14));
      n.connect(f); f.connect(g); g.connect(c.destination); n.start(when); n.stop(when + .2); return;
    }
    g.connect(c.destination); o.start(when); o.stop(when + .25);
  }
  /* 시계가 1배속일 때만 박을 미리 예약해 울린다 */
  let heardUpTo = 0;
  function schedule(m) {
    if (!audio.on || !audio.ctx || clock.speed !== 1) { heardUpTo = clock.beat; return; }
    const ahead = clock.beat + .35, now = audio.ctx.currentTime;
    for (const x of crossed(m, Math.max(heardUpTo, clock.beat - .05), ahead, Array.from({ length: m.steps }, (_, i) => i))) {
      const when = now + (x.t - clock.beat) * SPB;
      if (m.dodge.includes(x.s)) sfx(m.snare.includes(x.s) ? 'snare' : 'kick', when);
      else if ((x.s * m.dur) % .5 < 1e-6) sfx('hat', when);
    }
    heardUpTo = ahead;
  }
  function setAudio(on) {
    audio.on = on;
    if (on && !audio.ctx) audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (on) audio.ctx.resume();
    heardUpTo = clock.beat;
  }

  /* ── 모양: disc, ring, band, capsule, poly ── */
  function path(g, s, grow = 1) {
    g.beginPath();
    if (s.kind === 'disc') g.arc(s.x, s.y, Math.max(.01, s.r * grow), 0, TAU);
    else if (s.kind === 'ring') { g.arc(s.x, s.y, s.r1 + (s.r2 - s.r1) * grow, 0, TAU); g.arc(s.x, s.y, s.r1, 0, TAU, true); }
    else if (s.kind === 'band') {
      const c = Math.cos(s.ang), n = Math.sin(s.ang), h = s.w / 2 * Math.min(1, .25 + grow), L = s.len * grow, o = s.off || 0;
      const x = s.x + c * o, y = s.y + n * o;
      g.moveTo(x + n * h, y - c * h); g.lineTo(x + c * L + n * h, y + n * L - c * h);
      g.lineTo(x + c * L - n * h, y + n * L + c * h); g.lineTo(x - n * h, y + c * h); g.closePath();
    }
  }
  /* 적의 공격 하나: 번지는 예고(16분음 계단) → 꽉 찬 타격 → 옅어짐. p: 예고 진행 0~1, e: 타격 뒤 흐른 박 */
  function attack(g, s, color, p, e, steps) {
    g.save(); g.fillStyle = g.strokeStyle = color;
    if (p >= 0 && p < 1) {
      const k = Math.floor(p * steps) + 1;
      g.globalAlpha = .08; path(g, s); g.fill('evenodd');
      g.globalAlpha = .14 + .46 * (k / steps); path(g, s, clamp(p)); g.fill('evenodd');
      g.globalAlpha = .45; g.lineWidth = (1) * (g.__lw || 1); path(g, s); g.stroke();
    } else if (e >= 0 && e < .6) {
      g.globalAlpha = e < .08 ? 1 : .85 * (1 - clamp((e - .08) / .52)); path(g, s); g.fill('evenodd');
      if (e < .45) { g.globalAlpha = .6 * (1 - e / .45); g.lineWidth = (1.2) * (g.__lw || 1); g.beginPath(); if (s.kind === 'disc') g.arc(s.x, s.y, s.r + 4 + 26 * easeOut(e / .45), 0, TAU); else path(g, s); g.stroke(); }
    }
    g.restore();
  }

  /* ── 플레이어 ── */
  function player(g, x, y, ringColor, opt = {}) {
    const { pulse = 0, hollow = 0, r = 14, just = null } = opt;
    const rr = 8 * (1 + .1 * pulse);
    g.save();
    if (hollow > 0 && just) {                                   // 무적인 동안: 몸이 투명해지고 저스트 색으로 바뀐다
      g.strokeStyle = just; g.lineWidth = 1.6 * (g.__lw || 1); g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
      g.fillStyle = just; g.globalAlpha = .22; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
      g.globalAlpha = .9; g.lineWidth = 1.2 * (g.__lw || 1); g.beginPath(); g.arc(x, y, rr, 0, TAU); g.stroke();
      g.restore(); return;
    }
    g.strokeStyle = ringColor; g.lineWidth = 1.5 * (g.__lw || 1); g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
    if (hollow > 0) {                                           // 무적인 동안: 몸이 비어 테두리만 남는다
      g.globalAlpha = 1 - hollow; g.fillStyle = col.ink; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
      g.globalAlpha = 1; g.strokeStyle = col.ink; g.lineWidth = 1.3 * (g.__lw || 1); g.beginPath(); g.arc(x, y, rr, 0, TAU); g.stroke();
    } else { g.fillStyle = col.ink; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill(); }
    g.restore();
  }
  /* 대시: 떠난 자리의 고리, 잔상, 속도선. ring: 0 없음 / 1 고리 / 2 두 겹 / .5 끊긴 고리 */
  function dash(g, x0, y0, x1, y1, age, color, ring = 1, scale = 1) {
    if (age < 0 || age > 1.2) return;
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, k = clamp(age / 1.2);
    g.save(); g.strokeStyle = g.fillStyle = color;
    g.globalAlpha = .8 * (1 - k) ** 1.5; g.lineWidth = (1.5 - k) * (g.__lw || 1);
    const R = (12 + 34 * easeOut(k)) * scale;
    if (ring === .5) { for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(x0, y0, R, i * TAU / 6 + .2, i * TAU / 6 + .75); g.stroke(); } }
    else if (ring >= 1) { g.beginPath(); g.arc(x0, y0, R, 0, TAU); g.stroke(); }
    if (ring >= 2) { g.globalAlpha *= .6; g.beginPath(); g.arc(x0, y0, R * .62 + 4, 0, TAU); g.stroke(); }
    for (let i = 1; i <= 5; i++) { const t = i / 6; g.globalAlpha = .3 * t * (1 - clamp(age / .7)) ** 1.2; g.beginPath(); g.arc(x0 + dx * t, y0 + dy * t, 8 * (.55 + .45 * t), 0, TAU); g.fill(); }
    if (L > 30) { g.lineWidth = (1) * (g.__lw || 1); g.globalAlpha = .5 * (1 - clamp(age / .6)); for (const o of [-8, 0, 8]) { g.beginPath(); g.moveTo(x0 - uy * o + ux * 6, y0 + ux * o + uy * 6); g.lineTo(x1 - uy * o - ux * 14, y1 + ux * o - uy * 14); g.stroke(); } }
    g.restore();
  }

  /* ── 여운의 파면: 벽에 튕기는 음파 ──
     front: 같은 순간의 파면 위 점들 [x, y, 튕긴 횟수]. s0: 벽이 없었다면 이웃한 두 점이 떨어져 있을 간격.
     그보다 더 벌어진 자리(볼록한 벽을 돌아 퍼진 자리)는 벌어진 만큼 옅게 그린다. 선을 끊지 않는다.
     벽에 한 번 튕길 때마다 세기가 BOUNCE 배로 준다. */
  const BOUNCE = .62;
  function wave(g, fronts, color, alpha, width, s0, closed = true) {
    const buckets = new Map();
    for (const f of fronts) {
      const n = f.length, last = closed ? n : n - 1;
      for (let i = 0; i < last; i++) {
        const p = f[i], q = f[(i + 1) % n], L = Math.hypot(q[0] - p[0], q[1] - p[1]), stretch = L / s0;
        if (stretch > 14) continue;                               // 장애물을 돌아 아주 멀리 갈라진 점끼리는 잇지 않는다(어차피 거의 보이지 않는다)
        const a = alpha * Math.min(1, 1.3 / Math.max(stretch, .01)) * BOUNCE ** Math.max(p[2], q[2]);
        const k = Math.round(a * 40); if (k <= 0) continue;
        let path = buckets.get(k); if (!path) buckets.set(k, path = new Path2D());
        path.moveTo(p[0], p[1]); path.lineTo(q[0], q[1]);
      }
    }
    g.save(); g.strokeStyle = color; g.lineCap = 'round'; g.lineWidth = width * (g.__lw || 1);
    for (const [k, path] of buckets) { g.globalAlpha = k / 40; g.stroke(path); }
    g.restore();
  }

  /* ── 캔버스: 논리 크기로 그리고 2배로 찍는다 ── */
  function surface(cv, w, h) {
    const g = cv.getContext('2d'); const s = cv.width / w;
    return { g, w, h, begin() { g.setTransform(s, 0, 0, s, 0, 0); g.globalAlpha = 1; g.fillStyle = col.bg; g.fillRect(0, 0, w, h); } };
  }
  const visible = new WeakMap();
  const io = new IntersectionObserver(es => es.forEach(e => visible.set(e.target, e.isIntersecting)));
  const watch = cv => { visible.set(cv, true); io.observe(cv); };
  const isVisible = cv => visible.get(cv) !== false;

  /* ── 버튼 묶음 ── */
  function choice(root, attr, fn) {
    root.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      root.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      fn(b.dataset[attr]);
    }));
  }
  function bindPalette(root) {
    choice(root, 'p', p => { document.body.dataset.p = p; readColors(); try { localStorage.setItem('rm-pal', p); } catch (e) { } });
    let p = null; try { p = localStorage.getItem('rm-pal'); } catch (e) { }
    if (p) root.querySelector(`[data-p="${p}"]`)?.click();
    readColors();
  }
  function bindSpeed(root) { choice(root, 'speed', v => { clock.speed = +v; }); }
  function bindSound(btn, m) {
    btn.addEventListener('click', () => { setAudio(!audio.on); btn.setAttribute('aria-pressed', audio.on ? 'true' : 'false'); });
  }

  return { TAU, BPM, SPB, clamp, easeOut, easeInOut, lerp, col, readColors, alpha, METERS, barLen, around, crossed, clock, tick, schedule, setAudio, audio, path, attack, player, dash, wave, surface, watch, isVisible, choice, bindPalette, bindSpeed, bindSound };
})();
