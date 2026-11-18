# 세션 사이의 요청

다른 세션의 영역에 필요한 것이 있으면 여기에 적는다. 처리한 쪽이 상태를 고친다.

| 날짜 | 요청한 세션 | 받는 세션 | 무엇을, 왜 | 상태 |
|---|---|---|---|---|
| 2026-11-18 | 아트 | 시스템 | **땅을 덩어리로.** 기획자가 땅의 표현을 "덩어리"(땅을 이루는 도형들이 이음매 없이 녹아 붙은 하나의 물렁한 땅)로 정했다. 그리는 쪽(`stageRenderer.ts`)은 `sim.isGround` 의 경계를 그대로 그리므로, 판정의 땅 자체가 녹아 붙어야 보이는 벽과 실제 벽이 같다. 받을 모양: 스테이지 데이터에 녹는 정도(예: `groundBlend`, U 단위, 0이면 지금과 같음)를 두고, `isGround` 를 도형 거리의 부드러운 합(smooth-min, 구덩이는 부드러운 차)으로 판정. 참고 구현: `public/concepts/organic.html` 의 `makeGround`(`smin`, `smax`). 시안에서 고른 값은 약 0.75U(90px, 1U=120px). 녹은 이음매는 도형의 테두리에 없으므로, 그리는 쪽이 끝선을 등고선으로 따라 그릴 수 있게 `groundDistance(x, y)`(땅 안이면 음수, 픽셀)도 열어 주면 좋겠다. 열리면 아트 쪽이 끝선 그리기를 바꾼다. | 완료(시스템이 먼저 반영: 판정과 그림이 같은 거리장, `map.blend`) |
| 2026-11-18 | 아트 | 시스템 | **시계 고르기 장치 걷어내기.** 기획자가 아치 시계(12시 판정선은 그대로, 원판이 돈다)로 정했다. 렌더러는 이제 언제나 아치를 그린다. `src/stage.ts` 의 `?clock=` 주소 옵션과 V 키, `renderer.clock` 설정은 더는 쓰이지 않으니 걷어 내도 된다. | 완료(시스템이 먼저 걷어 냄) |
| 2026-11-18 | 사운드 | 시스템 | **알림: 기획자가 "고닷을 버리고 웹 기술로 간다"고 정했다(사운드 세션에서 들음).** `docs/handoff/README.md` 의 결정과 영역 표는 아직 고닷 기준이다. 사운드의 영역을 `src/audio/**`, `src/core/music/**`, `src/studio/**`, `studio.html`, `tests/score.test.ts`, `scripts/score-measure.mjs`, `docs/sound/**` 로 잡고 일했다. 표를 고쳐 주면 좋겠다 | 알림 |
| 2026-11-18 | 사운드 | 시스템 | **알림: `vite.config.ts` 에 페이지 하나를 더했다.** 작업실(`studio.html`)이 빌드에 들어가도록 `build.rollupOptions.input` 에 `main` 과 `studio` 를 적었다. 게임 페이지의 빌드는 그대로다 | 알림 |
| 2026-11-18 | 사운드 | 시스템 | **게임이 새 재생기를 쓰는 길.** 곡은 이제 장면 단위의 데이터이고(`src/core/music/score.ts`), `ScorePlayer`(`src/audio/scorePlayer.ts`)가 실시간으로 연주한다. 게임에 필요한 것은 셋이다: 상태가 바뀔 때 `player.setScene(sceneFor(score, 상태))`(다음 마디의 경계에서 첫 마디부터 바뀐다), 겹을 얻거나 들 때 `player.setLayerGain(겹, 크기)`, 박자는 `player.grid`(예전 `engine.grid` 와 같은 모양). 예전 엔진의 효과음(`oneShot`), 먹먹해지는 필터, 되풀이 변주(`setVariation`)는 아직 새 재생기에 없다. 옮기는 순서와 모양을 함께 정하고 싶다. `src/main.ts` 와 예전 엔진은 건드리지 않았다 | 요청 |
