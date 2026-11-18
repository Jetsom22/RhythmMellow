# 세션 사이의 요청

다른 세션의 영역에 필요한 것이 있으면 여기에 적는다. 처리한 쪽이 상태를 고친다.

| 날짜 | 요청한 세션 | 받는 세션 | 무엇을, 왜 | 상태 |
|---|---|---|---|---|
| 2026-11-18 | 사운드 | 시스템 | **작업실로 들어가는 길.** `godot/main.gd` 의 `_ready` 맨 앞에서, 웹이고 주소에 `studio` 가 있으면 `get_tree().change_scene_to_file.call_deferred("res://studio/studio.tscn")` 하고 돌아간다. 판별은 `bool(JavaScriptBridge.eval("new URLSearchParams(location.search).has('studio')", true))`. 기획자가 Pages에서 작업실(`docs/sound/studio.md`)을 열 길이 이것뿐이다. 이 네 줄을 넣은 빌드로 브라우저에서 동작을 확인했다 | 요청 |
| 2026-11-18 | 사운드 | 시스템 | **배포 전 검사에 하나 추가.** `.github/workflows/pages.yml` 에서 `run_tests.gd` 다음에 `godot --headless --path godot -s res://studio/check.gd` 를 돌린다(17초쯤). 곡 데이터의 모든 장면이 깨끗하게 구워지는지 본다 | 요청 |
| 2026-11-18 | 사운드 | 시스템 | **게임이 곡 데이터를 읽는 길.** 곡은 이제 장면 단위다(`godot/core/score.gd`). 게임 상태에서 장면 이름을 얻고(`Score.scene_for`), 겹마다 `Score.bake(score, scene, layer)` 로 루프를 얻는다. 필요한 것: (가) 장면마다 길이가 다른 루프를 받는 것, (나) **마디의 경계에서, 새 장면의 첫 마디부터** 갈아 끼우는 것, (다) 한 번만 연주하고 다음 장면으로 넘어가는 장면. 지금 `replaceLoop` 은 곧바로, 전체 시계의 자리에서 바꾼다. 굽는 시간은 겹 하나에 1초 안팎이라 다음 장면은 미리 구워 두어야 한다. 모양은 함께 정하고 싶다 | 요청 |
| 2026-11-18 | 사운드 | 시스템 | **알림: 웹 프로토타입과의 일치.** `Song.generate` 는 건드리지 않아서 예전 일치는 그대로다. 새 곡 데이터(`Score`)는 악보마다 난수의 흐름이 따로라 같은 씨앗이어도 웹 프로토타입과 다른 음이 나온다. 또 `Mix.biquad` 와 `Mix.room` 이 루프 끝부분만 미리 돌도록 바꿔서 실험 화면의 굽는 시간이 2.9초에서 2.0초가 됐다. `Mix.duck` 에 인자가 하나 늘었다(기본값은 예전과 같다) | 알림 |
