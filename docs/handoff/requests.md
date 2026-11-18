# 세션 사이의 요청

다른 세션의 영역에 필요한 것이 있으면 여기에 적는다. 처리한 쪽이 상태를 고친다.

| 날짜 | 요청한 세션 | 받는 세션 | 무엇을, 왜 | 상태 |
|---|---|---|---|---|
| 2026-11-18 | 사운드 | 시스템 | **알림: 기획자가 "고닷을 버리고 웹 기술로 간다"고 정했다(사운드 세션에서 들음).** `docs/handoff/README.md` 의 결정과 영역 표는 아직 고닷 기준이다. 사운드의 영역을 `src/audio/**`, `src/core/music/**`, `src/studio/**`, `studio.html`, `tests/score.test.ts`, `scripts/score-measure.mjs`, `docs/sound/**` 로 잡고 일했다. 표를 고쳐 주면 좋겠다 | 알림 |
| 2026-11-18 | 사운드 | 시스템 | **알림: `vite.config.ts` 에 페이지 하나를 더했다.** 작업실(`studio.html`)이 빌드에 들어가도록 `build.rollupOptions.input` 에 `main` 과 `studio` 를 적었다. 게임 페이지의 빌드는 그대로다 | 알림 |
| 2026-11-18 | 사운드 | 시스템 | **게임이 새 재생기를 쓰는 길.** 곡은 이제 장면 단위의 데이터이고(`src/core/music/score.ts`), `ScorePlayer`(`src/audio/scorePlayer.ts`)가 실시간으로 연주한다. 게임에 필요한 것은 셋이다: 상태가 바뀔 때 `player.setScene(sceneFor(score, 상태))`(다음 마디의 경계에서 첫 마디부터 바뀐다), 겹을 얻거나 들 때 `player.setLayerGain(겹, 크기)`, 박자는 `player.grid`(예전 `engine.grid` 와 같은 모양). 예전 엔진의 효과음(`oneShot`), 먹먹해지는 필터, 되풀이 변주(`setVariation`)는 아직 새 재생기에 없다. 옮기는 순서와 모양을 함께 정하고 싶다. `src/main.ts` 와 예전 엔진은 건드리지 않았다 | 요청 |

