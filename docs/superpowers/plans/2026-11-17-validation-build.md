# RhythmMellow 검증 빌드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 브라우저에서 도는 한 바퀴(악기 셋 수집 → 보스 합주전)를 만들어, 그 한 바퀴가 재미있는지 쥐어볼 수 있게 한다.

**Architecture:** 박자 계산·곡 생성·판정·게임 규칙은 DOM과 Web Audio를 모르는 순수 TypeScript(`src/core`)로 짜고 Vitest로 검증한다. `src/audio`(Web Audio 신디), `src/render`(Canvas 2D), `src/input`, `src/ui`는 얇은 껍질이다. 시간의 기준은 `AudioContext.currentTime` 하나이며, 게임은 매 프레임 "들리는 곡 시간"을 받아 그 사이에 지나간 16분 스텝을 처리한다.

**Tech Stack:** TypeScript, Vite, Vitest, Canvas 2D, Web Audio API. 게임 프레임워크 없음. 런타임 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-11-17-validation-build-design.md`

## Global Constraints

- `src/core/**` 는 `window`, `document`, `AudioContext`, `performance` 를 참조하지 않는다. 시간은 인자로 받는다.
- 4/4박자, 16분 격자(마디당 16스텝), 스테이지 안에서 템포 고정. 기본 110 BPM, 루프 2마디.
- 악기 겹은 `drum`(킥 1·3박, 스네어 2·4박), `hat`, `bass`. 보스전에 `lead`, `pad` 가 더해진다.
- 회피 판정은 정박(스텝 % 4 === 0)에만 견준다. 시작값 정확 ±60ms, 근접 ±120ms.
- 보스의 모든 타격 스텝은 `% 4 === 0` 이다.
- 손이 하는 일은 이동·회피·악기 전환 셋뿐. 조준 없음, 스킬 없음.
- 놓친 회피는 실패가 아니라 약한 회피다. 방 안에서는 죽지 않는다.
- 수치는 전부 `src/core/tunables.ts` 의 `Tunables` 에서 읽는다. 코드에 숫자를 박지 않는다.
- 화면은 임시 도형과 단색. 글자는 최소. 디버그 표시는 토글.
- 대상: 데스크톱 Chromium, 키보드. 이동 WASD/방향키, 회피 Space, 전환 Q/E 및 1·2·3.
- 주선율(`lead`) 겹은 보스에 묶지 않는다. 누가 드는지는 상태값(`leadOwner`)으로 둔다.
- 커밋 메시지 끝에 저장소 규칙의 Co-Authored-By / Claude-Session 줄을 붙인다.

## Review Focus

1. **탭이 가려졌다 돌아옴** — 타이머가 멈췄다 깨어나도 밀린 음을 한꺼번에 쏟지 않고 현재 위치에서 이어 간다. 게임은 가려진 동안 멈춘다. (Task 3, Task 6)
2. **프레임이 크게 끊김** — dt가 커도 지나간 스텝을 하나도 빠뜨리지 않고 순서대로 처리하며, 이동은 벽을 뚫지 않는다. (Task 5)
3. **키를 누르고 있음 / 연타** — 키 반복 입력은 회피로 세지 않고, 회피에는 재사용 대기가 있다. (Task 5, Task 6)
4. **플레이 중 템포를 바꿈** — 조절판에서 BPM을 바꿔도 박 위치가 튀지 않는다(현재 박을 유지하며 기준점을 다시 잡음). (Task 1)
5. **악기가 0개 또는 1개일 때 전환·공격** — 전환은 아무 일도 없고, 든 악기가 없으면 공격도 없다. 오류가 나지 않는다. (Task 5, Task 8)

---

## File Structure

```
index.html, package.json, tsconfig.json, vite.config.ts, README.md
src/main.ts                     부팅, 프레임 루프, 껍질 연결
src/core/rng.ts                 씨앗 난수
src/core/tunables.ts            Tunables 타입과 기본값
src/core/beat.ts                시간↔박 계산
src/core/judge.ts               회피 판정, 지연 보정
src/core/scheduler.ts           앞서 예약하는 스케줄러(가짜 시계로 테스트)
src/core/music/song.ts          씨앗 → 곡(겹별 음표)
src/core/music/mix.ts           게임 상태 → 겹별 음량/필터
src/core/game/types.ts          GameState, Input, GameEvent
src/core/game/world.ts          맵 데이터와 충돌
src/core/game/player.ts         이동, 회피, 전환
src/core/game/gimmicks.ts       세 방의 기믹 규칙
src/core/game/attack.ts         악기별 자동 공격(갈아끼울 수 있는 모듈)
src/core/game/bossPatterns.ts   보스 패턴 데이터
src/core/game/conductor.ts      악구 진행(되풀이/넘어감)
src/core/game/boss.ts           보스전 규칙, 화성 상태
src/core/game/sim.ts            createGame, stepGame
src/audio/synth.ts              Web Audio 음색
src/audio/engine.ts             AudioContext, 스케줄러 구동, 믹스 적용
src/input/keyboard.ts           키 → Input
src/render/renderer.ts          Canvas 그리기
src/render/debug.ts             디버그 표시
src/ui/panel.ts                 조절판
src/ui/calibrate.ts             지연 보정 화면
scripts/smoke.mjs               Playwright 연기 시험
tests/**                        src/core 와 같은 구조의 *.test.ts
```

---

### Task 1: 프로젝트 뼈대, 조절값, 박자 계산

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `src/main.ts`(빈 캔버스만), `src/core/rng.ts`, `src/core/tunables.ts`, `src/core/beat.ts`
- Test: `tests/beat.test.ts`, `tests/rng.test.ts`

**Interfaces:**
- Produces:
  - `mulberry32(seed: number): () => number` — [0,1) 난수
  - `interface Tunables` 와 `defaultTunables(): Tunables`. 필드와 기본값:
    `bpm 110, loopBars 2, perfectMs 60, nearMs 120, audioOffsetMs 0, inputOffsetMs 0, playerSpeed 220, playerRadius 10, dashPerfect 170, dashNear 120, dashMiss 50, dashTime 0.16, iframePerfect 0.30, iframeNear 0.18, iframeMiss 0.03, dodgeCooldown 0.25, playerHp 3, hitInvuln 1.0, bossHp 600, weakMult 2, otherMult 0.5, callOpenMult 1.5, callClosedMult 0.5, dmgDrum 10, dmgHat 3, dmgBass 2, rangeDrum 70, rangeHat 400, rangeBass 220, chasmWidth 90, harmonyMax 3, muffleBars 2`
  - `interface BeatGrid { bpm: number; t0: number }`
  - `secPerBeat(bpm): number`, `secPerStep(bpm): number`(16분)
  - `timeToStep(g: BeatGrid, t: number): number` — 소수 스텝(t0에서 0)
  - `stepToTime(g: BeatGrid, step: number): number`
  - `nearestQuarter(g: BeatGrid, t: number): { beat: number; offsetMs: number }` — offsetMs 양수는 늦음
  - `rebase(g: BeatGrid, newBpm: number, tNow: number): BeatGrid` — tNow에서의 소수 스텝이 그대로 유지되는 새 격자
- `package.json` scripts: `dev`(`vite --host`), `build`(`tsc --noEmit && vite build`), `test`(`vitest run`), `smoke`(`node scripts/smoke.mjs`). `vite.config.ts` 의 `base: './'`.

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/beat.test.ts`)

```ts
const g = { bpm: 120, t0: 10 };
expect(secPerBeat(120)).toBeCloseTo(0.5); expect(secPerStep(120)).toBeCloseTo(0.125);
expect(timeToStep(g, 10.5)).toBeCloseTo(4); expect(stepToTime(g, 16)).toBeCloseTo(12);
expect(nearestQuarter(g, 10.53)).toEqual({ beat: 1, offsetMs: expect.closeTo(30, 3) });
expect(nearestQuarter(g, 10.97).beat).toBe(2); expect(nearestQuarter(g, 10.97).offsetMs).toBeCloseTo(-30, 3);
// Review Focus 4
const r = rebase(g, 90, 13.37);
expect(timeToStep(r, 13.37)).toBeCloseTo(timeToStep(g, 13.37)); expect(r.bpm).toBe(90);
```
`tests/rng.test.ts`: 같은 씨앗 두 생성기의 처음 100개 값이 같고, 다른 씨앗은 다르며, 모두 [0,1).

- [ ] **Step 2:** `npm install` 후 `npm test` → 모듈 없음으로 FAIL
- [ ] **Step 3:** 위 인터페이스 구현
- [ ] **Step 4:** `npm test` PASS, `npm run build` 성공
- [ ] **Step 5:** 커밋 `feat: project scaffold, tunables, beat grid`

### Task 2: 회피 판정과 지연 보정

**Files:** Create `src/core/judge.ts` · Test `tests/judge.test.ts`

**Interfaces:**
- Consumes: `BeatGrid`, `nearestQuarter`, `Tunables`
- Produces:
  - `type Grade = 'perfect' | 'near' | 'miss'`
  - `heardTime(tAudio: number, tun: Tunables): number` — `tAudio - audioOffsetMs/1000`
  - `inputTime(tPress: number, tun: Tunables): number` — `tPress - (audioOffsetMs + inputOffsetMs)/1000`
  - `judgeDodge(g: BeatGrid, tPress: number, tun: Tunables): { grade: Grade; offsetMs: number; beat: number }`

- [ ] **Step 1: 테스트**

```ts
const g = { bpm: 120, t0: 0 }; const tun = defaultTunables();
expect(judgeDodge(g, 1.000, tun).grade).toBe('perfect');
expect(judgeDodge(g, 1.059, tun).grade).toBe('perfect');
expect(judgeDodge(g, 1.061, tun).grade).toBe('near');
expect(judgeDodge(g, 0.881, tun).grade).toBe('near');   // -119ms
expect(judgeDodge(g, 1.25, tun).grade).toBe('miss');
// 보정: 80ms 늦게 누르는 사람 + 보정 80 → 정확
expect(judgeDodge(g, 1.08, { ...tun, inputOffsetMs: 80 }).grade).toBe('perfect');
expect(judgeDodge(g, 1.08, { ...tun, inputOffsetMs: 80 }).offsetMs).toBeCloseTo(0, 3);
```
- [ ] **Step 2:** FAIL 확인 · **Step 3:** 구현 · **Step 4:** PASS · **Step 5:** 커밋 `feat: dodge judgement with latency offsets`

### Task 3: 곡 생성과 스케줄러

**Files:** Create `src/core/music/song.ts`, `src/core/scheduler.ts` · Test `tests/song.test.ts`, `tests/scheduler.test.ts`

**Interfaces:**
- Produces:
  - `type LayerId = 'drum' | 'hat' | 'bass' | 'lead' | 'pad'`
  - `type VoiceId = 'kick' | 'snare' | 'hat' | 'bass' | 'lead' | 'pad' | 'tick'`
  - `interface Note { step: number; len: number; midi: number; vel: number; voice: VoiceId }` (step은 루프 안 0..loopSteps-1, len은 스텝 수)
  - `interface Song { seed: number; loopSteps: number; rootMidi: number; scale: number[]; chordRoots: number[]; layers: Record<LayerId, Note[]>; tick: Note[] }` — `tick` 은 정박마다 하나(기본 맥박)
  - `euclid(pulses: number, steps: number, rotate?: number): boolean[]`
  - `generateSong(seed: number, loopBars: number): Song`
  - `vary(song: Song, layer: LayerId, n: number): Note[]` — n=0이면 원본, n>0이면 박자 뼈대(정박 음)는 지키는 작은 변주. 결정적.
  - `notesAt(notes: Note[], loopSteps: number, absStep: number): Note[]`
  - `interface ScheduledNote { note: Note; time: number; layer: LayerId | 'tick' }`
  - `class Scheduler { constructor(opts: { lookahead: number; maxCatchUp: number }); tick(now: number, grid: BeatGrid, provide: (absStep: number) => { note: Note; layer: LayerId | 'tick' }[], sink: (n: ScheduledNote) => void): void; reset(): void }` — 기본 `lookahead 0.12`, `maxCatchUp 0.25`. `sink` 로 나가는 `note.step` 은 절대 스텝(`absStep`)으로 바꿔 넣는다. `now` 보다 `maxCatchUp` 넘게 지난 스텝은 버리고 현재 위치에서 잇는다.
- 생성 규칙(결정 사항): 음계는 단조 펜타토닉, 뿌리음 MIDI 45~52에서 씨앗으로 선택. `chordRoots` 는 마디마다 하나(음계 음). `drum`: 마디마다 킥 스텝 0·8, 스네어 4·12(씨앗에 따라 킥 꾸밈음 추가 가능하나 정박 음은 항상 있음). `hat`: 엇박 스텝(`% 4 === 2`)은 전부, 16분은 `euclid` 로 일부 추가, 정박에는 없음. `bass`: 마디마다 화음 뿌리음, len ≥ 4인 긴 음 1~2개. `lead`: 음계 음으로 2마디 선율, 마디 첫 박에 음 있음. `pad`: 마디마다 화음 3음, len 16.

- [ ] **Step 1: 테스트**

```ts
// song
expect(generateSong(7, 2)).toEqual(generateSong(7, 2));
expect(generateSong(7, 2)).not.toEqual(generateSong(8, 2));
const s = generateSong(7, 2); expect(s.loopSteps).toBe(32);
for (const bar of [0, 1]) {
  expect(s.layers.drum.filter(n => n.voice === 'kick').map(n => n.step)).toEqual(expect.arrayContaining([bar*16, bar*16+8]));
  expect(s.layers.drum.filter(n => n.voice === 'snare').map(n => n.step)).toEqual(expect.arrayContaining([bar*16+4, bar*16+12]));
}
expect(s.layers.hat.every(n => n.step % 4 !== 0)).toBe(true);
expect([2,6,10,14].every(st => s.layers.hat.some(n => n.step === st))).toBe(true);
expect(s.layers.bass.every(n => n.len >= 4)).toBe(true);
const pcs = new Set(s.scale.map(d => (s.rootMidi + d) % 12));
for (const l of ['bass','lead','pad'] as const) expect(s.layers[l].every(n => pcs.has(n.midi % 12))).toBe(true);
expect(euclid(3, 8)).toEqual([true,false,false,true,false,false,true,false]);
expect(vary(s, 'hat', 0)).toEqual(s.layers.hat); expect(vary(s, 'hat', 1)).toEqual(vary(s, 'hat', 1));
expect(s.tick.map(n => n.step)).toEqual([0,4,8,12,16,20,24,28]);
// scheduler: 5분 동안 25ms마다 tick → 모든 스텝이 정확히 한 번, 시간 오차 없음
const g = { bpm: 110, t0: 0.1 }; const sch = new Scheduler({ lookahead: 0.12, maxCatchUp: 0.25 });
const seen = new Map<number, number>();
for (let now = 0; now < 300; now += 0.025) sch.tick(now, g, st => [{ note: { step: st, len: 1, midi: 60, vel: 1, voice: 'tick' }, layer: 'tick' }], n => { seen.set(n.note.step, (seen.get(n.note.step) ?? 0) + 1); expect(n.time).toBeCloseTo(stepToTime(g, n.note.step), 9); expect(n.time).toBeGreaterThanOrEqual(now - 1e-9); });
const last = Math.max(...seen.keys()); expect(last).toBeGreaterThan(2190);
for (let i = 0; i <= last; i++) expect(seen.get(i)).toBe(1);
// Review Focus 1: 3초 멈췄다 깨어남 → 지나간 스텝을 쏟지 않음
const sch2 = new Scheduler({ lookahead: 0.12, maxCatchUp: 0.25 }); const out: ScheduledNote[] = [];
const p = (st: number) => [{ note: { step: st, len: 1, midi: 60, vel: 1, voice: 'tick' as const }, layer: 'tick' as const }];
sch2.tick(1.0, g, p, n => out.push(n)); out.length = 0;
sch2.tick(4.0, g, p, n => out.push(n));
expect(out.every(n => n.time >= 4.0 - 1e-9)).toBe(true); expect(out.length).toBeLessThan(4);
```
- [ ] **Step 2:** FAIL · **Step 3:** 구현 · **Step 4:** PASS · **Step 5:** 커밋 `feat: seeded song generation and lookahead scheduler`

### Task 4: 소리 엔진과 듣기 페이지

**Files:** Create `src/core/music/mix.ts`, `src/audio/synth.ts`, `src/audio/engine.ts` · Modify `src/main.ts`, `index.html` · Test `tests/mix.test.ts`

**Interfaces:**
- Consumes: `Song`, `Scheduler`, `BeatGrid`, `Tunables`, `notesAt`, `vary`
- Produces:
  - `interface MixState { owned: LayerId[]; equipped: LayerId | null; previewLayer: LayerId | null; leadOn: boolean; harmony: number; harmonyMax: number; muffled: boolean; intensity: number }` (intensity 0..1, 보스 마당이 깊어질수록 큼)
  - `interface Mix { gain: Record<LayerId | 'tick', number>; cutoffHz: number; brightness: number }`
  - `computeMix(m: MixState): Mix` — 규칙: 가진 겹 0.8, 든 겹 1.0, 안 가졌지만 `previewLayer` 면 0.5, 그 외 0. `tick` 은 `drum` 을 가졌으면 0, 아니면 0.35. `lead` 는 `leadOn` 일 때 0.9. `pad` 는 `harmony/harmonyMax * 0.7`. `cutoffHz` 는 `muffled` 면 700, 아니면 18000. `brightness = intensity`.
  - `class AudioEngine { constructor(song: Song, tun: Tunables); start(): Promise<void>; now(): number; grid: BeatGrid; outputLatencyMs(): number; setMix(m: Mix): void; setVariation(n: number): void; setBpm(bpm: number): void; oneShot(kind: 'collect' | 'hit' | 'dodgePerfect' | 'dodgeNear' | 'dodgeMiss' | 'fill' | 'resolve' | 'victory'): void; suspend(): void; resume(): void }`
  - `start()` 는 사용자 입력 안에서 호출한다. `grid.t0 = now() + 0.15`. `setInterval` 25ms로 `Scheduler.tick` 을 돌린다. `setBpm` 은 `rebase` 후 `Scheduler.reset()`.
- 음색(결정): kick 사인 150→45Hz 0.12s 하강 / snare 대역 통과 잡음 + 180Hz 삼각파 0.12s / hat 고역 통과 잡음 0.04s / bass 톱니 + 저역 필터 엔벨로프 / lead 사각파(얕은 디튠) + 짧은 딜레이 / pad 느린 어택의 삼각파 화음 / tick 2kHz 사인 0.02s. 마스터에 저역 필터(`cutoffHz`)와 리미터(DynamicsCompressor).
- 듣기 페이지: 첫 화면은 "시작" 버튼 하나. 개발용으로 `?jam=1` 이면 겹 토글 체크박스와 BPM 입력을 보여 준다.

- [ ] **Step 1: 테스트** (`tests/mix.test.ts`)

```ts
const base = { owned: [], equipped: null, previewLayer: null, leadOn: false, harmony: 0, harmonyMax: 3, muffled: false, intensity: 0 } as MixState;
expect(computeMix(base).gain).toMatchObject({ drum: 0, hat: 0, bass: 0, lead: 0, pad: 0, tick: 0.35 });
const m = computeMix({ ...base, owned: ['drum','hat'], equipped: 'hat', previewLayer: 'bass' });
expect(m.gain).toMatchObject({ drum: 0.8, hat: 1.0, bass: 0.5, tick: 0 });
expect(computeMix({ ...base, harmony: 3 }).gain.pad).toBeCloseTo(0.7);
expect(computeMix({ ...base, muffled: true }).cutoffHz).toBe(700);
```
- [ ] **Step 2:** FAIL · **Step 3:** `mix.ts`, `synth.ts`, `engine.ts` 구현, 듣기 페이지 연결
- [ ] **Step 4:** `npm test` PASS. `npm run dev` 를 띄우고 Playwright로 `?jam=1` 접속 → "시작" 클릭 → 2초 뒤 `AudioContext.state === 'running'`, 콘솔 오류 0건, `engine.now()` 가 증가함을 확인(이 확인을 `scripts/smoke.mjs` 의 첫 구간으로 작성; `window.__rm.engine` 노출)
- [ ] **Step 5:** 커밋 `feat: web audio synth engine and jam page`

### Task 5: 플레이어 — 이동, 회피, 전환

**Files:** Create `src/core/game/types.ts`, `src/core/game/world.ts`, `src/core/game/player.ts`, `src/core/game/sim.ts` · Test `tests/player.test.ts`

**Interfaces:**
- Consumes: `Tunables`, `BeatGrid`, `judgeDodge`, `Grade`, `Song`, `LayerId`
- Produces:
  - `type Instrument = 'drum' | 'hat' | 'bass'`
  - `interface Input { moveX: number; moveY: number; dodgeAt: number | null; switchDir: -1 | 0 | 1; switchTo: Instrument | null }` — `dodgeAt` 은 누른 순간의 오디오 시간(보정 전)
  - `interface Player { x: number; y: number; faceX: number; faceY: number; hp: number; owned: Instrument[]; equipped: Instrument | null; dash: { t: number; dur: number; vx: number; vy: number; grade: Grade } | null; iframe: number; cooldown: number; respawn: { x: number; y: number } }`
  - `interface World { cols: number; rows: number; tile: number; cells: string[]; rooms: Record<'hub' | 'drum' | 'hat' | 'bass' | 'boss', { x: number; y: number; w: number; h: number; entry: { x: number; y: number } }> }` 와 `tileAt(w, x, y): string`, `isSolid(w, x, y): boolean`, `roomAt(w, x, y): keyof World['rooms'] | null`
  - 타일 문자: `#` 벽, `.` 바닥, `~` 낭떠러지, `D` 보스 문, `d/h/b` 악기, `g` 드럼 방 문짝, `p/q` 하이햇 방 발판 A/B, `w` 베이스 방 파동 구간, `s` 베이스 방 안전 칸, `T` 연습 표적, `P` 시작점
  - `type GameEvent = { type: 'dodge'; grade: Grade; offsetMs: number } | { type: 'collect'; inst: Instrument } | { type: 'respawn'; room: string } | { type: 'hurt'; hp: number } | { type: 'death' } | { type: 'attack'; inst: Instrument; x: number; y: number; tx: number; ty: number; hit: boolean } | { type: 'doorOpen' } | { type: 'bossStart' } | { type: 'phrase'; id: string; repeat: number; advanced: boolean } | { type: 'solved' } | { type: 'bossDefeated' }`
  - `interface GameState { tun: Tunables; song: Song; world: World; player: Player; step: number; time: number; doorOpen: boolean; boss: BossState | null; leadOwner: 'boss' | 'player' | null; dodgeLog: number[]; flags: { god: boolean } }` (`BossState` 는 Task 9에서 정의; 이 작업에서는 `null` 타입 자리만)
  - `createGame(seed: number, tun: Tunables): GameState`
  - `stepGame(s: GameState, input: Input, heardT: number, grid: BeatGrid): GameEvent[]` — 내부에서 `dt = clamp(heardT - s.time, 0, 0.05)` 로 이동을 여러 번 나눠 적분하고, `floor(timeToStep)` 이 지나간 모든 정수 스텝에 대해 `onStep` 을 순서대로 부른다(건너뜀 없음).
  - `movePlayer(s, input, dt)`, `tryDodge(s, input, grid): GameEvent | null`, `switchInstrument(p: Player, dir: -1 | 1): void`, `equip(p: Player, inst: Instrument): void`
- 규칙: 회피 방향은 이동 입력, 없으면 바라보는 방향. 등급별 거리 `dashPerfect/Near/Miss`, 지속 `dashTime`, 무적 `iframePerfect/Near/Miss`. `cooldown > 0` 이면 무시. 회피 중에는 `~` 위를 지날 수 있고, 회피가 끝났을 때 `~` 위면 `respawn` 으로 돌아가며 `respawn` 이벤트. `dodgeLog` 에 offsetMs를 최근 64개 유지.

- [ ] **Step 1: 테스트** — 작은 손수 만든 `World`(벽으로 둘러싼 10×5, 가운데 `~` 2칸)로:

```ts
// 이동과 벽
// 오른쪽 입력 1초(20ms씩) → x가 playerSpeed만큼 증가; 벽 앞에서 멈추고 isSolid 위치에 들어가지 않음
// Review Focus 2: heardT를 한 번에 0.5초 건너뛰어 호출해도 벽을 통과하지 않고, s.step은 지나간 스텝 수만큼 증가하며 onStep 호출 순서가 오름차순(스파이로 확인)
// 회피 등급
// grid {bpm:120,t0:0}; dodgeAt 1.00 → 이벤트 grade 'perfect', 대시 종료 후 이동 거리 ≈ dashPerfect(±2)
// dodgeAt 1.25 → 'miss', 거리 ≈ dashMiss
// 정확 회피로 낭떠러지(폭 chasmWidth)를 건넘; 빗나간 회피는 못 건너고 respawn 이벤트 + 위치가 respawn
// Review Focus 3: 회피 직후 cooldown 안의 두 번째 dodgeAt은 무시(이벤트 없음)
// Review Focus 5: owned [] 에서 switchInstrument → equipped null, 예외 없음; owned ['hat'] 에서 전환 → 'hat' 유지
// owned ['drum','hat','bass'], equipped 'drum' → switch +1 → 'hat', -1 두 번 → 'bass'
```
각 주석 줄을 `it(...)` 하나로 쓴다.
- [ ] **Step 2:** FAIL · **Step 3:** 구현(`world.ts` 에 실제 맵은 아직 넣지 않고 `parseWorld(cells: string[], tile: number): World` 만) · **Step 4:** PASS · **Step 5:** 커밋 `feat: player movement, beat dodge, instrument switching`

### Task 6: 화면, 입력, 프레임 루프 — 걸어 다닐 수 있는 빌드

**Files:** Create `src/input/keyboard.ts`, `src/render/renderer.ts` · Modify `src/main.ts`, `index.html`, `scripts/smoke.mjs`

**Interfaces:**
- Consumes: `AudioEngine`, `createGame`, `stepGame`, `computeMix`, `heardTime`, `Input`, `GameState`, `GameEvent`
- Produces:
  - `class Keyboard { constructor(target: Window, clock: () => number); poll(): Input }` — `poll` 은 누적된 한 번짜리 입력(`dodgeAt`, `switchDir`, `switchTo`)을 돌려주고 비운다. `KeyboardEvent.repeat` 는 무시. `dodgeAt` 은 keydown 순간의 `clock()`.
  - `class Renderer { constructor(canvas: HTMLCanvasElement); draw(s: GameState, beatPhase: number, events: GameEvent[]): void }` — 카메라는 플레이어를 따라감. 정박마다 화면 맥박(배경 명도와 플레이어 크기). 든 악기 색: drum `#ff5a4d`, hat `#ffd23f`, bass `#3fa7ff`. 회피 등급을 플레이어 주변 고리로 0.3초 표시.
  - `main.ts`: "시작" 클릭 → `engine.start()` → `requestAnimationFrame` 루프에서 `stepGame(s, kb.poll(), heardTime(engine.now(), tun), engine.grid)` → `engine.setMix(computeMix(mixStateOf(s)))` → `renderer.draw`. `document.visibilitychange` 에서 숨겨지면 `engine.suspend()` 와 루프 정지, 돌아오면 `resume()`.
  - `mixStateOf(s: GameState): MixState` 를 `src/core/music/mix.ts` 에 추가(테스트 포함: 방 안이면 `previewLayer` 가 그 방의 악기).
  - `window.__rm = { state, engine, tun }` 노출. URL `?seed=N`.

- [ ] **Step 1:** `tests/mix.test.ts` 에 `mixStateOf` 테스트 추가 — 드럼 방 안, 미보유 → `previewLayer === 'drum'`; 보유 후 → `owned` 에 포함. FAIL 확인
- [ ] **Step 2:** 구현
- [ ] **Step 3:** `npm test` PASS. `scripts/smoke.mjs` 확장: 시작 → `KeyD` 0.5초 누름 → `__rm.state.player.x` 증가, `Space` → `dodgeLog.length === 1`, 콘솔 오류 0건, 스크린샷을 scratch 경로에 저장해 눈으로 확인
- [ ] **Step 4:** 커밋 `feat: canvas renderer, keyboard input, frame loop`

### Task 7: 맵과 세 방의 기믹, 악기 수집

**Files:** Create `src/core/game/gimmicks.ts` · Modify `src/core/game/world.ts`(실제 맵 `MAP: string[]`, `buildWorld(): World`), `src/core/game/sim.ts`, `src/render/renderer.ts` · Test `tests/gimmicks.test.ts`, `tests/world.test.ts`

**Interfaces:**
- Consumes: Task 5의 타입, `Song`
- Produces:
  - `gimmickSolid(w: World, song: Song, step: number, x: number, y: number): boolean` — 박자에 따라 막히는 칸인지
  - `gimmickDeadly(w: World, song: Song, stepF: number, x: number, y: number): boolean` — 밟으면 방 입구로 돌아가는 칸인지
  - `stepGimmicks(s: GameState): GameEvent[]` — 수집, 되돌아가기, 문 열림 처리
- 규칙(결정):
  - **드럼 방**: `g` 문짝은 정박마다 번갈아 열리고 닫힌다(짝수 박 열림, 문짝 열마다 한 박씩 어긋남). 닫히는 순간 그 칸에 있으면 되돌아간다. 끝에 폭 `chasmWidth` 의 `~` 한 줄 — 정박 회피(근접 이상)로만 건넌다.
  - **하이햇 방**: `~` 위에 놓인 발판 `p` 는 박의 앞 절반(스텝 % 4 ∈ {0,1}), `q` 는 뒤 절반({2,3})에만 있다. 없는 발판 위에 서 있으면 되돌아간다. 중간에 회피로만 건너는 틈 하나.
  - **베이스 방**: `bass` 겹의 음이 울리는 동안(`step ∈ [note.step, note.step+note.len)`) `w` 칸은 치명적이고 `s` 칸은 안전하다. 음 사이의 쉼에 다음 `s` 로 옮겨 간다. 끝에 회피로만 건너는 틈 하나. 생성기는 베이스 방이 풀리도록 마디마다 쉼을 4스텝 이상 남긴다(`song.test.ts` 에 단언 추가).
  - 방 안의 실패는 `rooms[room].entry` 로 되돌아가며 체력은 줄지 않는다.
  - `d/h/b` 칸에 닿으면 수집: `owned` 에 추가, 첫 악기는 자동으로 듦, `collect` 이벤트. 셋을 다 모으면 `doorOpen = true`, `doorOpen` 이벤트, `D` 칸이 통과 가능해진다.
  - 맵 배치: 가운데 `hub`, 왼쪽·위·오른쪽에 세 방, 아래에 보스 문과 `boss` 방. `hub` 의 보스 문 옆에 `T`. 타일 32px, 전체 60×44칸 안팎.

- [ ] **Step 1: 테스트**

```ts
// world: buildWorld() 에 P 하나, d/h/b/D/T 각 하나 이상; 모든 줄 길이 같음
// world: P에서 너비 우선 탐색(#만 벽, 기믹 칸은 통과 가능으로 취급) → d, h, b, T, boss 방 안쪽 칸에 모두 도달
// world: D를 벽으로 취급하면 boss 방에 도달 불가
// drum: 문짝 칸에서 step 0(박0)엔 gimmickSolid false, step 4(박1)엔 true; 옆 열은 반대
// hat: p 칸은 step%4∈{0,1}에 안전, {2,3}에 gimmickDeadly; q는 반대
// bass: song의 bass 음이 울리는 스텝에 w 칸 deadly, s 칸은 항상 안전, 쉼 스텝엔 w도 안전
// collect: 플레이어를 d 칸으로 옮기고 stepGame → collect 이벤트, owned ['drum'], equipped 'drum'
// door: 셋을 차례로 모으면 doorOpen 이벤트가 정확히 한 번, isSolid(D) false
// 순서 무관: bass→hat→drum 순서로 모아도 같은 결과
// 방 실패: 하이햇 방에서 없는 발판 위 → respawn 이벤트, 위치 = rooms.hat.entry, hp 그대로
```
- [ ] **Step 2:** FAIL · **Step 3:** 구현 + 렌더러에 기믹 칸 그리기(문짝/발판은 박에 맞춰 나타나고 사라짐, 베이스 파동은 음 길이만큼 차오름, 악기는 그 악기 색의 도형)
- [ ] **Step 4:** `npm test` PASS. 개발 서버에서 직접 세 방을 한 번씩 풀어 보고(Playwright 키 입력 또는 `__rm` 로 위치 이동 후 스크린샷) 화면이 규칙과 맞는지 확인
- [ ] **Step 5:** 커밋 `feat: map, three rhythm rooms, instrument collection`

### Task 8: 악기별 자동 공격과 연습 표적

**Files:** Create `src/core/game/attack.ts` · Modify `src/core/game/sim.ts`, `src/render/renderer.ts` · Test `tests/attack.test.ts`

**Interfaces:**
- Consumes: `GameState`, `Song`, `Instrument`, `Tunables`
- Produces:
  - `interface Target { x: number; y: number; r: number; takeDamage(amount: number, inst: Instrument): void }`
  - `interface AttackModule { onStep(s: GameState, absStep: number, targets: Target[]): GameEvent[] }`
  - `autoAttack: AttackModule` — `GameState` 에 `attack: AttackModule` 필드를 두고 `createGame` 이 `autoAttack` 을 넣는다(갈아끼우는 자리).
- 규칙: 든 악기가 없거나 표적이 없으면 아무 일도 없다. 가장 가까운 표적 하나를 향한다. drum은 정박 스텝마다 `dmgDrum`, 사거리 `rangeDrum`. hat은 `% 4 === 2` 스텝마다 `dmgHat`, 사거리 `rangeHat`. bass는 `bass` 겹의 음이 울리는 모든 스텝에 `dmgBass`, 사거리 `rangeBass`. 사거리 밖이면 `attack` 이벤트의 `hit: false`(헛침도 보인다). 연습 표적 `T` 는 피해를 받아도 죽지 않는다.

- [ ] **Step 1: 테스트**

```ts
// Review Focus 5: equipped null → 32스텝 동안 이벤트 0개
// drum, 표적 거리 50 → 32스텝에 attack 8번(정박), 누적 피해 8*dmgDrum
// drum, 표적 거리 200 → attack 이벤트는 있으나 hit false, 피해 0
// hat, 거리 300 → 32스텝에 8번(엇박), 피해 8*dmgHat
// bass → 피해 = (song.layers.bass 의 len 합) * dmgBass
// 표적 둘 → 가까운 쪽만 피해
```
- [ ] **Step 2:** FAIL · **Step 3:** 구현 + 렌더러(drum 충격 고리, hat 탄 선, bass 줄기) · **Step 4:** PASS · **Step 5:** 커밋 `feat: per-instrument auto attack and practice target`

### Task 9: 보스전 — 지휘자, 패턴, 기승전결, 화성

**Files:** Create `src/core/game/bossPatterns.ts`, `src/core/game/conductor.ts`, `src/core/game/boss.ts` · Modify `src/core/game/types.ts`, `src/core/game/sim.ts`, `src/core/music/mix.ts`, `src/audio/engine.ts`, `src/render/renderer.ts`, `src/main.ts` · Test `tests/conductor.test.ts`, `tests/boss.test.ts`

**Interfaces:**
- Consumes: 앞선 모든 core 타입
- Produces:
  - `type Section = 'gi' | 'seung' | 'jeon' | 'gyeol'`, `type Texture = 'call' | 'tutti' | 'resolve'`
  - `type Shape = { kind: 'circle'; at: 'player' | 'boss' | { x: number; y: number }; r: number } | { kind: 'ring'; rIn: number; rOut: number } | { kind: 'line'; angle: number; width: number } | { kind: 'zone'; x: number; y: number; w: number; h: number; holdSteps: number }` — 좌표는 보스 방 중심 기준. `at: 'player'` 는 예고가 시작될 때의 플레이어 위치로 고정된다.
  - `interface AttackSpec { hitStep: number; telegraph: number; shape: Shape; layer: LayerId }` — `hitStep % 4 === 0`, `telegraph` 는 스텝 수(≥ 4)
  - `interface BossPattern { id: string; section: Section; texture: Texture; bars: 2 | 4; attacks: AttackSpec[]; openBars: number[]; weakTo: Instrument | null; layers: LayerId[]; advance: { hpBelow?: number; solved?: boolean } }` — `openBars` 는 빈틈이 열리는 마디(`call` 에서만 의미), `layers` 는 이 악구에서 강조되는 겹
  - `BOSS_PATTERNS: BossPattern[]` — 5개, 순서대로:
    1. `gi-solo` gi/call/4마디: 주선율만. 느린 `circle@player` 타격이 1·2마디 정박에, 3·4마디는 빈틈. `hpBelow 0.85`
    2. `seung-drum` seung/call/4마디: drum 겹. `ring` 이 정박마다 퍼짐, 약점 hat. `hpBelow 0.65`
    3. `seung-hat` seung/tutti/2마디: hat 겹. 엇박 예고 후 정박에 `line` 부채꼴, 약점 drum. `hpBelow 0.45`
    4. `jeon-resolve` jeon/resolve/4마디: 보스 보호막(피해 0). 바닥에 악기 표시가 붙은 공명판 셋. 맞는 악기를 든 채 공명판 위에서 한 마디(16스텝)를 끊김 없이 버티면 그 판이 잠긴다. 그동안 bass 겹의 `zone` 장판이 판을 번갈아 덮는다. 셋이 다 잠기면 `solved`. `advance: { solved: true }`
    5. `gyeol-tutti` gyeol/tutti/4마디: 모든 겹의 타격이 겹침, 약점 없음. `hpBelow 0`
  - `class Conductor { constructor(patterns: BossPattern[]); get current(): BossPattern; get repeat(): number; get index(): number; phraseEnd(ctx: { hpFrac: number; solved: boolean }): { advanced: boolean; done: boolean } }`
  - `interface BossState { x: number; y: number; r: number; hp: number; conductor: Conductor; phraseStart: number; active: { spec: AttackSpec; startStep: number; hitAbs: number; origin: { x: number; y: number } }[]; zones: { shape: Shape; untilStep: number }[]; pads: { x: number; y: number; inst: Instrument; progress: number; locked: boolean }[]; shield: boolean; harmony: number; muffleUntil: number; defeated: boolean }`
  - `enterBoss(s: GameState): GameEvent[]`, `stepBoss(s: GameState, absStep: number): GameEvent[]`, `hitTest(shape: Shape, origin, bossPos, px, py): boolean`, `damageMult(p: BossPattern, bar: number, inst: Instrument, tun: Tunables): number`
- 규칙(결정):
  - 플레이어가 보스 방에 들어서면 다음 마디 경계에서 시작한다(`bossStart`, `leadOwner = 'boss'`, `mix.leadOn`).
  - 악구가 끝나는 마디 경계에서 `phraseEnd`. 넘어가지 못하면 같은 악구를 다시 돌고 `engine.setVariation(repeat)`; 넘어가면 `oneShot('fill')` 과 `phrase` 이벤트(`advanced: true`). 박자는 끊기지 않는다.
  - 타격 판정: `hitAbs` 스텝에 플레이어가 모양 안에 있고 `iframe <= 0` 이면 `hurt`. 피격 후 `hitInvuln` 초 무적.
  - 피해 배율 `damageMult`: `weakTo` 와 같으면 `weakMult`, 다르면 `otherMult`, `weakTo` 가 null이면 1. `call` 악구는 여기에 `openBars` 안이면 `callOpenMult`, 밖이면 `callClosedMult` 를 곱한다. `shield` 면 0.
  - 화성: 예고 중인 타격의 `hitAbs` 를 근접 이상 회피의 무적으로 넘기면 `harmony + 1`(상한 `harmonyMax`). 피격되면 `harmony = 0`, `muffleUntil = step + muffleBars * 16`. `mixStateOf` 가 `harmony`, `muffled`, `intensity = conductor.index / 4` 를 채운다.
  - 죽음(`hp 0`): `death` 이벤트, 플레이어는 보스 문 앞으로, 체력 회복, `boss = null`(다시 들어가면 처음부터), `leadOwner = null`.
  - 격파: `gyeol-tutti` 에서 `hp <= 0` → `bossDefeated`, `defeated = true`, 타격 중단, `leadOwner = 'player'`, 모든 겹 + lead + pad 가 가득 찬 채 곡이 계속 흐른다(`oneShot('victory')`).

- [ ] **Step 1: 테스트**

```ts
// 데이터
expect(BOSS_PATTERNS.flatMap(p => p.attacks).every(a => a.hitStep % 4 === 0 && a.telegraph >= 4)).toBe(true);
expect(new Set(BOSS_PATTERNS.map(p => p.section))).toEqual(new Set(['gi','seung','jeon','gyeol']));
expect(new Set(BOSS_PATTERNS.map(p => p.texture))).toEqual(new Set(['call','tutti','resolve']));
expect(BOSS_PATTERNS.every(p => p.attacks.every(a => a.hitStep < p.bars * 16))).toBe(true);
// 지휘자
const c = new Conductor(BOSS_PATTERNS);
expect(c.phraseEnd({ hpFrac: 0.95, solved: false })).toEqual({ advanced: false, done: false }); expect(c.repeat).toBe(1); expect(c.current.id).toBe('gi-solo');
expect(c.phraseEnd({ hpFrac: 0.80, solved: false }).advanced).toBe(true); expect(c.current.id).toBe('seung-drum'); expect(c.repeat).toBe(0);
// jeon-resolve 는 hp와 무관하게 solved 로만 넘어감; gyeol 에서 hpFrac 0 → done true
// boss.ts
// damageMult: seung-drum 에서 hat → weakMult*callOpen/Closed, drum → otherMult*...; shield → 0
// 타격: 예고 원 안에 서 있으면 hitAbs 스텝에 hurt, hp 2; 원 밖이면 무사
// 정확 회피의 무적이 hitAbs 를 덮으면 hurt 없음 + harmony 1
// 피격 → harmony 0, mixStateOf(s).muffled true, muffleBars 뒤 false
// 공명판: 맞는 악기로 16스텝 서 있으면 locked; 15스텝에 벗어나면 progress 0; 다른 악기면 진행 없음; 셋 잠기면 solved 이벤트
// 죽음: hp 0 → death, 위치는 보스 문 앞, s.boss null, hp 회복
// 한 바퀴: flags.god = true, 든 악기와 위치를 매 스텝 최선으로 맞추는 간단한 봇으로 stepGame 을 돌리면
//          3000마디 안에 phrase 이벤트가 다섯 악구를 순서대로 지나고 bossDefeated 가 나온다
// 되풀이: 봇이 공격하지 않으면 gi-solo 가 계속 돌고 phrase 이벤트의 repeat 가 1,2,3… 으로 늘며 advanced 는 false
```
- [ ] **Step 2:** FAIL · **Step 3:** 구현. 렌더러: 보스(큰 도형, 마당마다 변 수가 늘어남), 예고 표시(모양이 `telegraph` 동안 박에 맞춰 차오르고 `hitAbs` 에 번쩍임), 빈틈 마디에 보스가 열림, 공명판 진행, 보호막, 체력은 보스 둘레의 호 하나, 플레이어 체력은 점 셋, 화성 단계는 배경 고리 수
- [ ] **Step 4:** `npm test` PASS. `?skip=boss`(악기 셋 보유, 보스 문 앞 시작) 추가 후 개발 서버에서 보스전을 직접 돌려 스크린샷으로 예고·타격·넘어감을 확인
- [ ] **Step 5:** 커밋 `feat: boss ensemble fight with conductor, four sections, harmony state`

### Task 10: 조절판, 디버그 표시, 지연 보정

**Files:** Create `src/ui/panel.ts`, `src/ui/calibrate.ts`, `src/render/debug.ts` · Modify `src/main.ts`, `index.html`, `src/core/judge.ts` · Test `tests/judge.test.ts`

**Interfaces:**
- Produces:
  - `estimateInputOffset(offsetsMs: number[]): number` (`judge.ts`) — 가장 크게 벗어난 값 하나씩(양 끝)을 버린 평균, 반올림. 값이 4개 미만이면 0.
  - `mountPanel(tun: Tunables, onChange: (key: keyof Tunables, value: number) => void): { toggle(): void }` — `Tunables` 의 모든 숫자 필드를 입력칸으로. `Tab` 으로 토글. `bpm` 이 바뀌면 `engine.setBpm`. "기본값으로" 와 "JSON 복사" 버튼. 값은 `localStorage('rm.tunables')` 에 저장하고 부팅 때 불러온다.
  - `drawDebug(ctx, s: GameState, grid: BeatGrid, heardT: number, fps: number): void` — `` ` `` 로 토글. 박 위상 막대(판정 창 표시), 최근 회피 오차 점 분포(`dodgeLog`), 평균/표준편차 ms, 현재 악구 id·되풀이 수·마당, 화성 단계, fps, 출력 지연 ms.
  - `runCalibration(engine: AudioEngine, kb: Keyboard): Promise<number>` — tick만 울리며 Space 12번을 받아 `estimateInputOffset` 결과를 돌려준다. 시작 화면의 "박자 맞추기" 버튼과 `C` 키로 연다. 결과는 `inputOffsetMs` 에 넣는다.
  - 부팅 때 `audioOffsetMs` 가 저장돼 있지 않으면 `engine.outputLatencyMs()` 로 채운다.

- [ ] **Step 1: 테스트** — `estimateInputOffset([40,42,38,41,200,-90])` → `40`; `[10,20]` → `0`; `[30,30,30,30]` → `30`
- [ ] **Step 2:** FAIL · **Step 3:** 구현 · **Step 4:** `npm test` PASS, 스모크에 `Tab`/`` ` `` 토글 후 요소 존재 확인 추가
- [ ] **Step 5:** 커밋 `feat: tunables panel, debug overlay, latency calibration`

### Task 11: 한 바퀴 점검과 건네기

**Files:** Modify `scripts/smoke.mjs` · Create `README.md`, `docs/tuning-notes.md`

- [ ] **Step 1:** `scripts/smoke.mjs` 완성 — `npm run build` 결과물(`vite preview`)을 대상으로: 시작 → 걷기 → 회피 → `?skip=boss` 로 보스 방 진입 → 10초 뒤 `__rm.state.boss !== null` 이고 `phrase` 이벤트가 한 번 이상 → 콘솔 오류 0건. 5분 드리프트 점검: `page.evaluate` 로 60초 간격 5회, `engine.grid` 로 계산한 스텝과 스케줄러가 마지막으로 예약한 스텝의 차가 `lookahead` 범위 안인지 확인.
- [ ] **Step 2:** `npm test && npm run build && npm run smoke` 모두 통과
- [ ] **Step 3:** 처음부터 끝까지 사람 손으로(또는 Playwright 키 입력으로) 한 바퀴를 돌며 스크린샷을 남기고, 막히는 곳·너무 어려운 곳의 수치를 조절해 기본값에 반영
- [ ] **Step 4:** `README.md`(실행법 `npm install`, `npm run dev`, 조작, 조절판/디버그/보정 키, URL 옵션)와 `docs/tuning-notes.md`(고닷 이식 때 가져갈 규칙과 수치의 자리: 현재 기본값 표, 아직 손대지 않은 값 표시) 작성
- [ ] **Step 5:** 커밋 `docs: readme and tuning notes; chore: full-loop smoke test`, 푸시
