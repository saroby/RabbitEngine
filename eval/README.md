# eval — 도발 시나리오 평가셋

`eval/scenarios/*.json` 은 buildTurn 의 결정론 출력(블록·디렉티브·system)을 검사하는 시나리오다. `npm test` 가 `test/eval-scenarios.test.js` 로 이 파일들을 자동 검증한다 — 조립 로직이 맞는지만 본다.

실제 응답 품질(캐릭터가 도발에 그럴듯하게 반응하는지)은 결정론 테스트로 잡을 수 없다. `scripts/eval-judge.js` 가 각 시나리오를 실제 LLM 에 태우고, 같은 LLM 을 심사위원 삼아 `judge.rubric` 5항목을 0~2점으로 채점하고 `judge.stateDelta` 로 장면 추출 결과가 허용 범위 안인지 본다.

## 실행

```sh
OPENAI_API_KEY=sk-... node scripts/eval-judge.js --model gpt-4o
node scripts/eval-judge.js --provider anthropic --model claude-sonnet-5 --variant no-state
node scripts/eval-judge.js --model gpt-4o --baseline eval/results/2026-09-19-gpt-4o.json
```

키가 없으면(`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`) 종료 코드 2 로 멈춘다. 수동 실행 전용이며 `npm test` 에는 포함하지 않는다. `--variant full|no-directive|no-state` 는 post_history(디렉티브) 또는 scene_state 블록을 빼고 렌더해 절제 실험을 한다. 결과는 `eval/results/`(git 밖)에 JSON 으로 남는다.

## 시나리오 형식

```json
{ "id": "violence-punch", "rating": "adult", "dialect": "asterisk-script",
  "cards": [{ "name": "유리", "description": "…", "behavior": "선택: 행동 기준" }],
  "indicatorDefs": [], "sceneState": null,
  "history": [{ "role": "assistant", "text": "…" }],
  "userInput": "*주먹으로 때린다*\n뭘 봐",
  "expect": { "directiveIncludes": [], "directiveExcludes": [], "systemIncludes": [], "blocks": { "scene_state": false } },
  "judge": { "stateDelta": { "tension": ["hostile", "tense"], "bodyAddAny": { "유리": ["멍|뺨|아픔"] }, "forbid": [] }, "rubric": ["…5항목"] } }
```

`stateDelta.tension` 은 허용 목록이고 `bodyAddAny` 는 이름별 정규식 중 하나라도 맞으면 통과다 — 단일 정답이 아니라 허용 결과와 금지 모순을 평가한다. `sceneState` 가 있으면 `scene/state.js` 의 전체 스키마(`version`·`revision`·`characters` 등)를 채운다.
