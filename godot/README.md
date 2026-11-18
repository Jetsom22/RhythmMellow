# RhythmMellow — Godot

출시용 구현. Godot 4.7, GDScript. 웹으로도 내보내서 브라우저에서 해 볼 수 있다.

- 해 보기: https://jetsom22.github.io/RhythmMellow/godot/
- 설계: `../docs/superpowers/specs/2026-11-18-stage-system-design.md`
- 웹 프로토타입(`../src`)은 규칙의 정답지로 남긴다. 같은 씨앗이면 두 쪽이 같은 곡을 만든다.

## 지금 있는 것 — 실험 1: 고닷이 박을 지키는가

| 파일 | 하는 일 |
|---|---|
| `core/beat_clock.gd` | 게임의 유일한 시계. 박자표는 데이터로 받고, 타격의 격자와 회피의 격자를 따로 갖는다 |
| `core/rng.gd`, `core/song.gd` | 씨앗에서 곡 만들기. 웹과 결과가 같다 |
| `audio/synth.gd` | 겹마다 루프를 미리 구워 둔다 |
| `audio/mixer.gd` | 구운 루프들을 한꺼번에 틀고 겹을 켜고 끈다 |
| `main.gd` | 실험 화면: 박을 보여 주고, 누른 박을 판정한다 |
| `tools/run_tests.gd` | 화면 없이 도는 검사 |

## 소리를 미리 굽는 이유

웹에서 고닷의 저지연 재생("sample")은 실시간으로 만든 소리를 틀 수 없고, GDScript로 실시간 합성을 하면 느리다.
곡은 씨앗에서 전부 정해지므로, 스테이지를 불러올 때 겹마다 루프를 한 번 구워 두고 보통의 반복 재생으로 튼다.
그러면 웹과 PC 모두에서 지연이 짧다. 굽는 데는 여섯 겹에 0.3초쯤 걸린다.

## 실행

```bash
godot --headless --path godot --import
```

```bash
godot --headless --path godot -s res://tools/run_tests.gd
```

```bash
godot --headless --path godot --export-release Web ../dist/godot/index.html
```

웹 내보내기에는 4.7.2의 웹 템플릿이 필요하다. `npm run build` 는 `dist` 를 비우므로, 고닷 내보내기는 그 뒤에 한다.
